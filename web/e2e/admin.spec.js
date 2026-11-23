import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('管理后台', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('订单状态筛选返回 200 且列表可渲染', async ({ page }) => {
    await page.goto('/#/admin')
    await expect(page.getByText('管理后台')).toBeVisible()

    // 底部的 tab 切换（概览 / 订单 / 商品）
    await page.locator('.chips').last().getByText('订单', { exact: true }).click()
    await expect(page.locator('.toolbar .chip', { hasText: '待支付' })).toBeVisible()

    // 这个请求以前带尾斜杠返回 422，UI 上表现为筛选后列表空白。
    const pendingResponse = page.waitForResponse(
      (r) => r.url().includes('/api/admin/orders?status=pending') && r.request().method() === 'GET'
    )
    await page.locator('.toolbar .chip', { hasText: '待支付' }).click()
    const response = await pendingResponse

    expect(response.status()).toBe(200)
    await expect(page.locator('.toolbar .chip', { hasText: '待支付' })).toHaveClass(/active/)
    await expect(page.locator('.banner.err')).toHaveCount(0)
  })

  test('商品改价保存后前端与后端一致', async ({ page }) => {
    // page.request 共享浏览器登录 cookie；request fixture 不共享
    const request = page.request
    const adminList = await request.get('/api/admin/products')
    expect(adminList.ok()).toBeTruthy()
    const original = (await adminList.json()).products[0]
    expect(original, '至少有一件商品').toBeTruthy()
    const changedCents = original.price_cents + 100

    try {
      await page.goto('/#/admin?tab=products')
      await expect(page.locator('table')).toBeVisible()
      const row = page.locator('tbody tr').filter({ hasText: original.sku }).first()
      await expect(row).toBeVisible()

      const saved = page.waitForResponse(
        (r) => r.url().includes(`/api/admin/products/${original.id}`) && r.request().method() === 'PATCH'
      )
      await row.locator('input.money-input').first().fill((changedCents / 100).toFixed(2))
      await row.getByRole('button', { name: '保存' }).click()
      expect((await saved).status(), '改价 PATCH 应 200').toBe(200)

      await expect(row.locator('input.money-input').first()).toHaveValue((changedCents / 100).toFixed(2))
      const detail = await request.get(`/api/products/${original.slug}`)
      expect((await detail.json()).price_cents, '后端价格应更新').toBe(changedCents)
    } finally {
      // 不把测试改动留在演示库里，避免影响后续金额相关用例
      // 页面内 fetch 共享 UI cookie；APIRequestContext 的 PATCH 在本环境偶发 ECONNRESET
      await expect.poll(async () => page.evaluate(async ({ id, cents }) => {
        try {
          const res = await fetch(`/api/admin/products/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price_cents: cents })
          })
          return res.status
        } catch {
          return 0
        }
      }, { id: original.id, cents: original.price_cents })).toBe(200)
    }
  })
})
