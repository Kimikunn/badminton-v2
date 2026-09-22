import { test, expect } from '@playwright/test'

/**
 * Holidays — 订场日历 / 单日面板的法定节假日与调休补班标记
 *
 * 固定时钟在 2026-10-01（国庆节，法定假日）：
 * - 2026-10-01 休（国庆节）、2026-10-10 班（调休补班）、2026-10-08 普通日无标记
 * - 2027-01-05 超出 chinese-days 数据范围 → 无标记（AC5）
 *
 * Run: npx playwright test e2e/holidays.spec.js
 */

const TODAY = new Date('2026-10-01T12:00:00+08:00')

async function openCalendar(page) {
  await page.goto('/venues', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '日历' }).click()
}

test.describe('Calendar holidays', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: TODAY })
  })

  test('holiday / makeup workday / normal day cells', async ({ page }) => {
    await openCalendar(page)

    const nationalDay = page.locator('[data-date="2026-10-01"]')
    await expect(nationalDay.locator('.holiday-tag')).toContainText('国庆节')
    await expect(nationalDay.locator('.holiday-tag')).toContainText('休')

    const makeupWorkday = page.locator('[data-date="2026-10-10"]')
    await expect(makeupWorkday.locator('.holiday-tag')).toContainText('国庆节')
    await expect(makeupWorkday.locator('.holiday-tag')).toContainText('班')

    await expect(page.locator('[data-date="2026-10-08"] .holiday-tag')).toHaveCount(0)
  })

  test('DaySheet shows legal holiday info', async ({ page }) => {
    await openCalendar(page)
    await page.locator('[data-date="2026-10-01"]').click()

    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('法定假日')
    await expect(sheet.locator('.holiday-chip')).toHaveText('休')
  })

  test('DaySheet shows makeup workday info', async ({ page }) => {
    await openCalendar(page)
    await page.locator('[data-date="2026-10-10"]').click()

    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('调休补班')
    await expect(sheet.locator('.holiday-chip')).toHaveText('班')
  })

  test('out-of-range date has no holiday marker (AC5)', async ({ page }) => {
    await openCalendar(page)

    const nextMonth = page.locator('button:has(.lucide-chevron-right)')
    await nextMonth.click()
    await nextMonth.click()
    await nextMonth.click()

    const outOfRange = page.locator('[data-date="2027-01-05"]')
    await expect(outOfRange).toBeVisible()
    await expect(outOfRange.locator('.holiday-tag')).toHaveCount(0)
  })
})
