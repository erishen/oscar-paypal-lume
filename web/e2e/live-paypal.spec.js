import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// live-paypal.spec.js —— 真链路 E2E（真实调 api-m.sandbox.paypal.com）
//
// 覆盖：本站登录 → 加购 → 真实下单（PayPal create order）→ PayPal sandbox
//       支付（两种模式）→ 回跳 → 真实 capture（订单转 paid / 扣库存）
//       → admin 真实退款（订单转 refunded / 回补库存）。
//
// 支付模式（PAYPAL_LOGIN）：
//   1) 默认——访客卡支付（guest checkout，无需账号），用 sandbox 公开测试卡：
//        Visa 4111111111111111 / 12/28 / 123
//      可用 PAYPAL_TEST_CARD / PAYPAL_TEST_EXP / PAYPAL_TEST_CVV 覆盖。
//   2) PAYPAL_LOGIN=1——真实 buyer 账号登录 approve（自带绑定测试卡/余额，
//      不用填卡表单）：需 BUYER_EMAIL / BUYER_PASS 环境变量。
//      凭据由 scripts/buyer-creds.sh 从本机 Chrome Keychain 临时解密，
//      不写入仓库、不打印。
//
// （sandbox 只模拟扣款，不产生真实资金流。）
//
// 默认不跑（会真调 PayPal、偶尔 sandbox 抖动）；显式开启：
//   E2E_LIVE=1 make test-e2e-live                 # 访客卡模式
//   E2E_LIVE=1 PAYPAL_LOGIN=1 make test-e2e-live  # buyer 账号模式（需先 source 凭据）
// ---------------------------------------------------------------------------

const live = process.env.E2E_LIVE === '1'
const describeLive = live ? test.describe : test.describe.skip
const buyerMode = process.env.PAYPAL_LOGIN === '1'

// PayPal sandbox 公开测试卡（developer.paypal.com 文档口径）
const CARD = {
  number: process.env.PAYPAL_TEST_CARD || '4111111111111111',
  exp: process.env.PAYPAL_TEST_EXP || '12/28',
  cvv: process.env.PAYPAL_TEST_CVV || '123'
}

// 在页面上下文里 fetch，天然带上 UI 登录写入的 cookie
// （page.request 的 APIRequestContext 不共享 UI 登录态，会 401）
async function apiJSON(page, method, path, data) {
  return await page.evaluate(async ({ method, path, data }) => {
    const opts = { method, headers: {} }
    if (data !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(data)
    }
    const r = await fetch(path, opts)
    const text = await r.text()
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
    return { status: r.status, body }
  }, { method, path, data })
}

describeLive('真实 PayPal sandbox 全链路（下单→卡支付→capture→退款）', () => {
  test.setTimeout(180_000)

  test('真实扣款与真实退款，订单状态与库存双向一致', async ({ page }) => {
    const api = page
    const base = (await page.context()._options.baseURL) || ''
    const key = 'live' + Date.now().toString(36)

    // 1) 本站登录（浏览器上下文里有 cookie）
    await page.goto('/#/login')
    await page.locator('input[autocomplete="username"]').fill('admin')
    await page.locator('input[type="password"]').fill('admin123456')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page.locator('.user-chip')).toHaveText('admin')
    await page.waitForURL(/#\/basket$/)

    // 2) 清篮 + 加购，记下商品与初始库存
    const basket = await apiJSON(api, 'GET', '/api/basket/')
    for (const it of basket.body.items || []) {
      await apiJSON(api, 'DELETE', `/api/basket/${it.product_id}`)
    }
    // 选一件有库存的商品（stock>0），否则库存扣减/回补断言无意义
    const list = await apiJSON(api, 'GET', '/api/products/?limit=50')
    const product = (list.body.results || []).find(p => p.stock > 0)
    expect(product, '至少有一件 stock>0 的商品').toBeTruthy()
    const qty = 1
    await apiJSON(api, 'POST', '/api/basket/', { product_id: product.id, quantity: qty })
    const stockBefore = product.stock
    const expectTotal = product.price_cents * qty

    // 3) 真实下单：PayPal create order（真调 sandbox）
    const origin = page.url().split('#')[0]
    const returnUrl = `${origin}#/checkout/done?key=${key}`
    const cancelUrl = `${origin}#/basket`
    // PayPal sandbox 偶发 5xx / 限流，create 带重试（最多 3 次，退避 2s/4s）
    let created = null
    let finalKey = key
    for (let attempt = 1; attempt <= 3; attempt++) {
      const k = attempt === 1 ? key : `${key}r${attempt}`
      created = await apiJSON(api, 'POST', '/api/orders/', {
        key: k, return_url: returnUrl.replace(key, k), cancel_url: cancelUrl,
        email: 'buyer@example.com' // 订单追踪用（对齐 Oscar 订单 email 字段）
      })
      if (created.status === 201) { finalKey = k; break }
      console.log(`[live] create attempt ${attempt} failed: ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`)
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000))
    }
    expect(created.status, `create order 应为 201，实际 ${created.status}`).toBe(201)
    const approveUrl = created.body.approve_url
    expect(approveUrl, '应返回 approve_url').toBeTruthy()
    expect(approveUrl).toContain('sandbox.paypal.com')
    const orderId = created.body.order_id
    console.log(`[live] order_id=${orderId} total_cents=${created.body.total_cents}`)

    // 4) PayPal sandbox 支付：同一浏览器上下文打开 approve 页（保留本站 cookie）
    const pp = await page.context().newPage()
    await pp.goto(approveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await pp.waitForTimeout(2500)
    // 关 cookie 提示
    try { await pp.getByRole('button', { name: /我接受|接受|Accept/ }).click({ timeout: 3000 }) } catch {}

    if (buyerMode) {
      // ---- buyer 账号登录模式：登录 → 确认页 → 点「完成购物」 ----
      // buyer 账号自带绑定的测试卡和 PayPal 余额，无需填卡表单。
      const email = process.env.BUYER_EMAIL
      const pass = process.env.BUYER_PASS
      expect(email && pass, 'buyer 模式需要 BUYER_EMAIL / BUYER_PASS').toBeTruthy()

      await pp.locator('#email').fill(email)
      await pp.getByRole('button', { name: /下一步|Next/i }).first().click({ timeout: 10_000 })
      await pp.waitForTimeout(2000)
      await pp.locator('#password').fill(pass)
      await pp.getByRole('button', { name: /^登录$|Log In/i }).first().click({ timeout: 10_000 })
      // 等确认页加载：出现金额与「完成购物」按钮
      const finishBtn = pp.getByRole('button', { name: /完成购物|Complete purchase|Pay Now/i })
      await finishBtn.first().waitFor({ timeout: 30_000 })
      console.log('[live] buyer login OK, approve page:', (await pp.locator('body').innerText()).slice(0, 120).replace(/\s+/g, ' '))
      await finishBtn.first().click({ timeout: 20_000 })
    } else {
      // ---- 访客卡支付模式（guest checkout，无需账号） ----
      // 点「使用借记卡或信用卡付款」
      const cardBtn = pp.getByRole('button', { name: /借记卡或信用卡|debit or credit|credit card/i })
      await cardBtn.first().click({ timeout: 15_000 })
      await pp.waitForURL(/checkoutweb\/signup/, { timeout: 20_000 }).catch(() => {})
      await pp.waitForTimeout(2500)

      // ⚠️ 不要改 #country：切国家会触发整页重载、丢失 guest checkout token，
      // 付款后会被弹到 signin 页。保持默认国家（中国），用中国格式邮编即可。

      // 填卡表单。PayPal 的 mask 输入是 React 受控组件：
      // - locator.fill 会被 mask 清空
      // - locator.pressSequentially 在 expiry 上不生效
      // 有效方式：原生 setter 一次性写入完整格式化值再触发 input/change/blur。
      await pp.locator('#email').fill('buyer@example.com')
      const cardFmt = CARD.number.replace(/(\d{4})(?=\d)/g, '$1 ') // "4111 1111 1111 1111"
      const expFmt = CARD.exp.replace('/', ' / ')                  // "12 / 28"
      for (const [sel, val] of [['#cardNumber', cardFmt], ['#cardExpiry', expFmt], ['#cardCvv', CARD.cvv]]) {
        await pp.evaluate(({ sel, val }) => {
          const el = document.querySelector(sel)
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          setter.call(el, val)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('blur', { bubbles: true }))
        }, { sel, val })
      }
      await pp.locator('#email').click() // 让最后一个字段失焦提交
      // 断言三个 mask 字段完整填好（有效期要 4 位数字=月+年，避免 "08 /" 这种半截值）
      for (const [sel, minDigits] of [['#cardNumber', 16], ['#cardExpiry', 4], ['#cardCvv', 3]]) {
        const v = await pp.locator(sel).inputValue()
        expect(v.replace(/\D/g, '').length >= minDigits, `${sel} 应至少 ${minDigits} 位数字，实际 "${v}"`).toBe(true)
      }
      await pp.locator('#firstName').fill('Test')
      await pp.locator('#lastName').fill('Buyer')
      await pp.locator('#billingCity').fill('Shenzhen')
      await pp.locator('#billingLine1').fill('1 Main St')
      await pp.locator('#billingPostalCode').fill('518000') // 中国邮编 6 位
      const stateSel = pp.locator('#billingState')
      if (await stateSel.count() && await stateSel.isVisible()) {
        const opts = await stateSel.locator('option').evaluateAll(els => els.map(e => e.value).filter(Boolean))
        if (opts.length > 0) await stateSel.selectOption(opts[0])
      }
      await pp.locator('#phone').fill('13800138000')
      const guestRadio = pp.locator('#onboardOptionGuest')
      if (await guestRadio.count()) {
        await guestRadio.click({ force: true }).catch(() => {})
        if (!await guestRadio.isChecked()) {
          await pp.getByText(/我现在不需要账户|don't need an account/i).first().click().catch(() => {})
        }
      }

      // 点「立即付款」并等待回跳本站
      const payBtn = pp.getByRole('button', { name: /立即付款|Pay Now|确认并付款/i })
      await payBtn.first().click({ timeout: 20_000 })
    }

    // 等回跳本站（两种模式共用）
    await pp.waitForURL(new RegExp(`#/checkout/done\\?key=${finalKey}`), { timeout: 60_000 })
    const doneUrl = pp.url()
    console.log('[live] returned to:', doneUrl.split('#')[0])

    // 5) 回跳页自动 complete：真实 capture（订单 paid / 扣库存 / 清篮）
    await expect(pp.getByText('支付完成')).toBeVisible({ timeout: 40_000 })
    const paid = await apiJSON(api, 'GET', `/api/orders/${orderId}`)
    expect(paid.status).toBe(200)
    expect(paid.body.status, 'capture 后订单应为 paid').toBe('paid')
    expect(paid.body.paypal_capture_id, '应保存 capture id').toBeTruthy()
    const captureId = paid.body.paypal_capture_id
    console.log(`[live] capture_id=${captureId}`)

    // 匿名订单追踪：order_no + 下单邮箱（无需登录）
    const tracked = await apiJSON(api, 'POST', '/api/orders/track', {
      order_no: created.body.order_no, email: 'buyer@example.com'
    })
    expect(tracked.status, `订单追踪应 200，实际 ${tracked.status}`).toBe(200)
    expect(tracked.body.status).toBe('paid')
    expect(tracked.body.order_no).toBe(created.body.order_no)
    const wrongMail = await apiJSON(api, 'POST', '/api/orders/track', {
      order_no: created.body.order_no, email: 'nobody@example.com'
    })
    expect(wrongMail.status, '错误邮箱不得查到订单').toBe(404)

    // 库存已扣
    const afterPay = await apiJSON(api, 'GET', `/api/products/${product.slug}`)
    expect(afterPay.body.stock, '支付后库存应减少').toBe(stockBefore - qty)
    // 购物篮已清
    const basketAfter = await apiJSON(api, 'GET', '/api/basket/')
    expect(basketAfter.body.item_count, '支付后购物篮应清空').toBe(0)
    await pp.close()

    // 6) 管理后台 UI 部分退款：填金额 → 点退款（真调 PayPal）→ 订单仍 paid
    const partial = Math.floor(expectTotal / 2)
    const adminOrder = await apiJSON(api, 'GET', `/api/admin/orders/${orderId}`)
    expect(adminOrder.status).toBe(200)
    await page.goto('/#/admin?tab=orders')
    await expect(page.getByText('管理后台')).toBeVisible()
    const row = page.locator('div.table > div').filter({ hasText: '#' + adminOrder.body.order_no }).first()
    await expect(row).toBeVisible({ timeout: 15_000 })

    const refundResp = page.waitForResponse(
      (r) => r.url().includes(`/api/admin/orders/${orderId}/refund`) && r.request().method() === 'POST'
    )
    await row.locator('input.money-input').fill((partial / 100).toFixed(2))
    await row.getByRole('button', { name: '退款', exact: true }).click()
    const resp = await refundResp
    const p1 = await resp.json()
    expect(resp.status(), `部分退款应 200，实际 ${resp.status()}: ${JSON.stringify(p1)}`).toBe(200)
    expect(p1.status).toBe('paid')
    expect(p1.partial).toBe(true)
    expect(p1.refunded_cents).toBe(partial)
    expect(p1.remaining_cents).toBe(expectTotal - partial)
    await expect(row.getByText('退款成功')).toBeVisible()
    await expect(row.locator('.badge')).toHaveText('已支付')
    const mid = await apiJSON(api, 'GET', `/api/orders/${orderId}`)
    expect(mid.body.refunded_cents, '订单应累计已退金额').toBe(partial)
    const afterPartial = await apiJSON(api, 'GET', `/api/products/${product.slug}`)
    expect(afterPartial.body.stock, '部分退款不回补库存').toBe(stockBefore - qty)

    // 6b) 同金额重复退款：本地 key 去重，200 already，不重复记账
    const p1Again = await apiJSON(api, 'POST', `/api/admin/orders/${orderId}/refund`, { amount_cents: partial })
    expect(p1Again.status).toBe(200)
    expect(p1Again.body.already).toBe(true)

    // 6c) 退剩余：真调 PayPal refund capture，全额退完转 refunded + 库存回补
    const refund = await apiJSON(api, 'POST', `/api/admin/orders/${orderId}/refund`, { amount_cents: expectTotal - partial })
    expect(refund.status, `真实退款应 200，实际 ${refund.status}: ${JSON.stringify(refund.body)}`).toBe(200)
    expect(refund.body.status).toBe('refunded')
    expect(refund.body.refunded_cents).toBe(expectTotal)
    expect(refund.body.capture_id).toBe(captureId)

    // 订单转 refunded + 库存回补
    const refunded = await apiJSON(api, 'GET', `/api/orders/${orderId}`)
    expect(refunded.body.status).toBe('refunded')
    expect(refunded.body.refunded_cents).toBe(expectTotal)
    const afterRefund = await apiJSON(api, 'GET', `/api/products/${product.slug}`)
    expect(afterRefund.body.stock, '全额退款后库存应回补').toBe(stockBefore)

    // 7) 退款幂等：再次退款仍 200 already
    const again = await apiJSON(api, 'POST', `/api/admin/orders/${orderId}/refund`, {})
    expect(again.status).toBe(200)
    expect(again.body.already).toBe(true)

    console.log('[live] PASS: 真实下单 → 卡支付 → capture → 部分退款 → 退余款 → 幂等，全链路通过')
  })
})
