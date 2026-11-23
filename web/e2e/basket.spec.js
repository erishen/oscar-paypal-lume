import { test, expect } from '@playwright/test'
import { login, clearBasket } from './helpers'

test.describe('购物篮 UI', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await clearBasket(page.request)
    await page.reload()
  })

  test('加购 / 改数量 / 删除与后端一致', async ({ page }) => {
    await page.goto('/#/')
    const card = page.locator('.grid .card').filter({
      has: page.locator('button:not([disabled])')
    }).first()
    await expect(card).toBeVisible()
    const name = (await card.locator('.name').textContent()).trim()

    await card.getByRole('button', { name: '加入购物篮' }).click()
    await expect(page.locator('.basket-count')).toHaveText('1')

    await page.goto('/#/basket')
    await expect(page.locator('.line-item')).toHaveCount(1)
    await expect(page.locator('.line-item .li-name')).toHaveText(name)

    // 这两个按钮曾经因为 product_id 映射错误而点了没反应（返回的是 basket_items.id）。
    await page.locator('.line-item .qty button').nth(1).click()
    await expect(page.locator('.line-item .qty span')).toHaveText('2')
    await expect(page.locator('.basket-count')).toHaveText('2')

    await page.locator('.line-item .qty button').nth(0).click()
    await expect(page.locator('.line-item .qty span')).toHaveText('1')

    await page.getByRole('button', { name: '移除', exact: true }).click()
    await expect(page.getByText('购物篮是空的')).toBeVisible()
    await expect(page.locator('.basket-count')).toHaveCount(0)
  })
})
