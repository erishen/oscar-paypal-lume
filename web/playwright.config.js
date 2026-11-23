import { defineConfig } from '@playwright/test'

// 直接用本机 Chrome，避免下载 Playwright 自带浏览器。
// 默认打 Docker 容器 18101；可用 E2E_BASE_URL 覆盖。
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:18101'

export default defineConfig({
  testDir: './e2e',
  // 输出放到系统临时目录：避免每次启动自动清理项目内 test-results 时
  // 触发沙箱的批量删除保护（trace/screenshot 会快速累积几百个文件）。
  outputDir: '/tmp/oscar-lume-playwright-results',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--no-proxy-server'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
