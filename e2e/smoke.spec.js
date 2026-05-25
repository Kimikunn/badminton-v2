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
      // Allow PWA registration errors
      const realErrors = errors.filter(e => !e.includes('registerSW') && !e.includes('service-worker'))
      expect(realErrors).toHaveLength(0)
    })
  }
})
