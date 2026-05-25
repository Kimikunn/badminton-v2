import { test } from '@playwright/test'

/**
 * Screenshot capture — takes full-page screenshots for visual review
 * Run: npx playwright test e2e/screenshots.spec.js
 * Screenshots saved to e2e/screenshots/
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'matches', path: '/matches' },
  { name: 'rankings', path: '/rankings' },
  { name: 'venues', path: '/venues' },
]

test.describe('Screenshots', () => {
  for (const pg of PAGES) {
    test(`${pg.name}`, async ({ page }, testInfo) => {
      const mode = testInfo.project.name
      await page.goto(pg.path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(2000)
      await page.screenshot({
        path: `e2e/screenshots/${pg.name}-${mode}.png`,
        fullPage: true,
      })
    })
  }

  test('all season rankings', async ({ page }, testInfo) => {
    const mode = testInfo.project.name
    await page.goto('/rankings', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const tabs = page.locator('.tab, .tabs button')
    const tabCount = await tabs.count()

    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(1500)
      const label = (await tabs.nth(i).textContent())?.trim()?.replace(/\s+/g, '-') || `s${i}`
      await page.screenshot({
        path: `e2e/screenshots/rankings-${label}-${mode}.png`,
        fullPage: true,
      })
    }
  })
})
