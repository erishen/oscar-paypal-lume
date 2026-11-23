import { test, expect } from '@playwright/test'
import { login } from './helpers'

// APIRequestContext 的写操作在本环境偶发 ECONNRESET；页面内 fetch 共享 UI cookie，稳定。
async function apiFetch(page, method, path, body) {
  return await page.evaluate(async ({ method, path, body }) => {
    const opts = { method, headers: {} }
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    try {
      const r = await fetch(path, opts)
      const text = await r.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
      return { status: r.status, data }
    } catch (e) {
      return { status: 0, data: { message: String(e) } }
    }
  }, { method, path, body })
}

async function clearBasket(page) {
  const b = await apiFetch(page, 'GET', '/api/basket/')
  for (const it of b.data.items || []) {
    await apiFetch(page, 'DELETE', `/api/basket/${it.product_id}`)
  }
}

// 扩展功能 UI 回归：账户/地址/找回、愿望单/评价/券、后台新模块。
test.describe('Oscar 扩展功能', () => {
  test('注册 → 地址簿 → 演示口令找回 → 用新口令登录', async ({ page }) => {
    const uname = 'u' + Date.now().toString(36)
    const email = uname + '@example.com'
    const firstPass = 'Testpass123'
    const newPass = 'Newpass123'

    await page.goto('/#/register')
    await page.locator('input[autocomplete="username"]').fill(uname)
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[autocomplete="new-password"]').nth(0).fill(firstPass)
    await page.locator('input[autocomplete="new-password"]').nth(1).fill(firstPass)
    await page.getByRole('button', { name: '注册并登录' }).click()
    await expect(page.locator('.user-chip')).toHaveText(uname)

    await page.getByRole('link', { name: '我的账户' }).click()
    await page.locator('.account-tabs').getByText('地址簿').click()
    await page.getByRole('button', { name: '新增地址' }).click()
    const form = page.locator('.account-body .card').first()
    await form.locator('input').nth(0).fill('Ex')
    await form.locator('input').nth(1).fill('Test')
    await form.locator('input').nth(2).fill('1 Main St')
    await form.locator('input').nth(3).fill('Shenzhen')
    await form.locator('input').nth(4).fill('518000')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('.account-body')).toContainText('1 Main St')

    await page.goto('/#/reset')
    await page.locator('input[type="email"]').fill(email)
    await page.getByRole('button', { name: '生成重置令牌' }).click()
    const banner = page.locator('.banner.ok').filter({ hasText: '重置令牌' })
    await expect(banner).toBeVisible()
    const token = (await banner.innerText()).match(/[0-9a-f]{32}/)[0]
    await page.getByRole('button', { name: '确认重置 →' }).click()
    await page.locator('input').first().fill(token)
    await page.locator('input[type="password"]').fill(newPass)
    await page.getByRole('button', { name: '确认重置' }).last().click()
    await page.waitForURL(/#\/login$/)

    await page.locator('input[autocomplete="username"]').fill(uname)
    await page.locator('input[type="password"]').fill(newPass)
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page.locator('.user-chip')).toHaveText(uname)
  })

  test('愿望单 / 评价 / 优惠券在 UI 上生效', async ({ page }) => {
    await login(page)
    await clearBasket(page)

    // 选一件有库存、admin 还没评价过的商品
    const list = await apiFetch(page, 'GET', '/api/products/?limit=50')
    let product = null
    for (const p of list.data.results || []) {
      if (p.stock <= 0) continue
      const rv = await apiFetch(page, 'GET', `/api/products/${p.slug}/reviews`)
      if (!(rv.data.reviews || []).some(r => r.author === 'admin')) { product = p; break }
    }
    expect(product, '至少有一件可评价商品').toBeTruthy()

    await page.goto(`/#/product/${encodeURIComponent(product.slug)}`)
    await expect(page.locator('h1')).toHaveText(product.name)
    await page.getByRole('button', { name: '加入愿望单' }).click()
    await expect(page.getByRole('button', { name: '移出愿望单' })).toBeVisible()

    await page.getByRole('button', { name: '写评价' }).click()
    const reviewForm = page.locator('.card').filter({ has: page.getByRole('button', { name: '提交评价' }) })
    await reviewForm.locator('input').fill('E2E review')
    await reviewForm.locator('textarea').fill('Works with PayPal sandbox.')
    await reviewForm.getByRole('button', { name: '提交评价' }).click()
    await expect(page.getByText('评价已提交')).toBeVisible()
    await expect(page.getByText('E2E review')).toBeVisible()

    await page.goto('/#/account')
    await page.locator('.account-tabs').getByText('我的愿望单').click()
    await expect(page.locator('.account-body')).toContainText(product.name)

    // 券：DEMO10 九折，购物篮总额应低于小计
    await apiFetch(page, 'POST', '/api/basket/', { product_id: product.id, quantity: 1 })
    await page.goto('/#/basket')
    await expect(page.locator('.line-item')).toHaveCount(1)
    await page.locator('input[placeholder*="DEMO10"]').fill('DEMO10')
    await page.getByRole('button', { name: '使用', exact: true }).click()
    await expect(page.getByText('优惠券已使用')).toBeVisible()
    const subtotal = Number((await page.locator('.summary .row').nth(1).locator('span').nth(1).innerText()).replace(/[^\d.]/g, ''))
    const total = Number((await page.locator('.summary .row.total span').nth(1).innerText()).replace(/[^\d.]/g, ''))
    expect(total, '折后总额应小于小计').toBeLessThan(subtotal)

    await apiFetch(page, 'DELETE', '/api/basket/voucher')
    await clearBasket(page)
  })

  test('后台新增模块均可渲染', async ({ page }) => {
    await login(page)
    await page.goto('/#/admin')
    const chips = page.locator('.chips').last()
    for (const [label, text] of [
      ['用户', 'admin'],
      ['优惠券', 'DEMO10'],
      ['评价', '通过'],
      ['报表', '成交额']
    ]) {
      await chips.getByText(label, { exact: true }).click()
      await expect(page.locator('body')).toContainText(text)
    }
    // 内容页数据在 input value 里，innerText 看不到
    await chips.getByText('内容页', { exact: true }).click()
    await expect(page.locator('input[disabled]')).toHaveValue('/about/')
  })
})
