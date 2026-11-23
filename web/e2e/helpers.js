import { expect } from '@playwright/test'

// 走真实登录页，确保 cookie 会话是浏览器上下文里的那一份。
export async function login(page, username = 'admin', password = 'admin123456') {
  await page.goto('/#/login')
  await page.locator('input[autocomplete="username"]').fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('登录成功')).toBeVisible()
  await expect(page.locator('.user-chip')).toHaveText(username)
  // Login.vue 有 400ms 的 setTimeout 跳 /basket；等它走完，避免覆盖后续导航。
  await page.waitForURL(/#\/basket$/)
}

// 通过页面同上下文的 API 请求清空购物篮，保证用例之间不互相污染。
export async function clearBasket(request) {
  // 券挂在 basket 上，不清会让 DEMO10 折扣串到后续金额用例
  try { await request.delete('/api/basket/voucher') } catch {}
  const res = await request.get('/api/basket/')
  expect(res.ok(), 'clearBasket: GET /api/basket/ 应成功').toBeTruthy()
  const data = await res.json()
  for (const item of data.items || []) {
    await request.delete(`/api/basket/${item.product_id}`)
  }
  const after = await request.get('/api/basket/')
  const rest = await after.json()
  expect(rest.item_count, 'clearBasket: 购物篮应清空').toBe(0)
}

// 用 API 加购，避免 E2E 依赖首页商品排序；返回商品信息供金额断言使用。
export async function addFirstProduct(request, quantity = 1) {
  const list = await request.get('/api/products/?limit=1')
  expect(list.ok(), 'addFirstProduct: 目录应可访问').toBeTruthy()
  const product = (await list.json()).results[0]
  expect(product, 'addFirstProduct: 至少要有 1 件商品').toBeTruthy()
  const added = await request.post('/api/basket/', {
    data: { product_id: product.id, quantity }
  })
  expect(added.ok(), 'addFirstProduct: 加购应成功').toBeTruthy()
  return product
}
