import { test, expect } from '@playwright/test'

/**
 * Smoke test — core pages load and render without errors
 * Run: npx playwright test e2e/smoke.spec.js
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'matches', path: '/matches' },
  { name: 'rankings', path: '/rankings' },
  { name: 'venues', path: '/venues' },
]

test.describe('Smoke tests', () => {
  for (const pg of PAGES) {
    test(`${pg.name} loads`, async ({ page }) => {
      await page.goto(pg.path, { waitUntil: 'networkidle' })
      await expect(page.locator('#app')).toBeVisible()
      // No console errors (except known PWA warnings)
      const errors = []
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text())
      })
      await page.waitForTimeout(1000)
      // No horizontal scroll (mobile viewport fit)
      const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      expect(noHorizontalScroll).toBe(true)
      // Install guide must never appear (removed feature)
      await page.waitForTimeout(6000)
      await expect(page.getByText('添加到主屏幕')).toHaveCount(0)
      // Allow PWA registration errors
      const realErrors = errors.filter(e => !e.includes('registerSW') && !e.includes('service-worker'))
      expect(realErrors).toHaveLength(0)
    })
  }

  test('safe-bottom plumbing: --safe-bottom-min override reaches TabBar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('#app')).toBeVisible()
    const paddingBefore = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.safe-bottom')).paddingBottom
    )
    expect(paddingBefore).toBe('0px')
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom-min', '16px'))
    const paddingAfter = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.safe-bottom')).paddingBottom
    )
    expect(paddingAfter).toBe('16px')
  })
})
