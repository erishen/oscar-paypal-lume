import { test, expect } from '@playwright/test'

// 登录来源回跳：未登录加购 → 登录 → 回到原商品页；显式登录仍落购物篮。
test('登录后回到触发登录的页面，且来源只消费一次', async ({ page, request }) => {
  const list = await request.get('/api/products/?limit=50')
  expect(list.ok()).toBeTruthy()
  const product = (await list.json()).results.find(p => p.stock > 0)
  expect(product, '至少有一件有库存的商品').toBeTruthy()

  await page.goto(`/#/product/${encodeURIComponent(product.slug)}`)
  await expect(page.locator('h1')).toHaveText(product.name)

  // 未登录加购 → 401 → 记录当前商品地址并跳登录
  // 详情页下方「同类图书」也有加购按钮，限定主商品区域
  await page.locator('.detail .qty-row button.btn').click()
  await page.waitForURL(/#\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('oscar_next'))).toBe(
    `/product/${product.slug}`
  )

  await page.locator('input[autocomplete="username"]').fill('admin')
  await page.locator('input[type="password"]').fill('admin123456')
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(new RegExp(`#/product/${product.slug}$`))
  await expect(page.locator('h1')).toHaveText(product.name)

  // 来源已消费：显式从头部点登录，登录后仍落默认 /basket
  await page.getByRole('button', { name: '退出' }).click()
  await page.getByRole('link', { name: '登录' }).click()
  await page.waitForURL(/#\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('oscar_next'))).toBeNull()
  await page.locator('input[autocomplete="username"]').fill('admin')
  await page.locator('input[type="password"]').fill('admin123456')
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/#\/basket$/)
})
