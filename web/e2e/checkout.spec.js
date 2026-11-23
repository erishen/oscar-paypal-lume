import { test, expect } from '@playwright/test'
import { login, clearBasket, addFirstProduct } from './helpers'

test.describe('结算页', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await clearBasket(page.request)
  })

  test('总额按美元显示，不把分当美元', async ({ page }) => {
    const product = await addFirstProduct(page.request, 2)
    await page.goto('/#/checkout')

    const expected = '$' + ((product.price_cents * 2) / 100).toFixed(2)
    await expect(page.locator('.summary .row.total span').last()).toHaveText(expected)
  })

  test('checkout/done 用 key 与 token 对账并渲染支付成功', async ({ page }) => {
    let completeUrl = ''
    await page.route('**/api/orders/complete?*', async (route) => {
      completeUrl = route.request().url()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'paid',
          total: 5.99,
          order_no: 'O-E2E-1',
          currency: 'USD'
        })
      })
    })

    await page.goto('/#/checkout/done?key=e2e-key&token=fake-token')

    await expect(page.getByText('支付完成')).toBeVisible()
    await expect(page.getByText('$5.99 USD', { exact: false })).toBeVisible()
    expect(completeUrl).toContain('key=e2e-key')
    expect(completeUrl).toContain('token=fake-token')
  })
})
