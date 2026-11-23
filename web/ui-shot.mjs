import { chromium } from '@playwright/test'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto('http://127.0.0.1:18101/#/', { waitUntil: 'networkidle' })
await p.screenshot({ path: '/tmp/ui-home.png', fullPage: false })
// 登录页
await p.goto('http://127.0.0.1:18101/#/login', { waitUntil: 'networkidle' })
await p.screenshot({ path: '/tmp/ui-login.png' })
// 登录后 basket + account
await p.fill('input[autocomplete="username"]', 'admin')
await p.fill('input[type="password"]', 'admin123456')
await p.click('button:has-text("登录")')
await p.waitForTimeout(1200)
await p.goto('http://127.0.0.1:18101/#/account', { waitUntil: 'networkidle' })
await p.waitForTimeout(600)
await p.screenshot({ path: '/tmp/ui-account.png' })
await b.close()
