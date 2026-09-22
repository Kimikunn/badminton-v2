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

    // 格子只放 休/班 角标（参考苹果日历），不放节日名
    await expect(page.locator('[data-date="2026-10-01"] .holiday-mark')).toHaveText('休')
    await expect(page.locator('[data-date="2026-10-10"] .holiday-mark')).toHaveText('班')
    await expect(page.locator('[data-date="2026-10-08"] .holiday-mark')).toHaveCount(0)

    // 节日名在月摘要里给一次：固定结构「休 <日期> <名称>」在前、「班 <日期>」在后
    const summary = page.locator('.holiday-summary')
    await expect(summary).toContainText('休 1–7 国庆节')
    await expect(summary).toContainText('班 10')

    // 所有格子的日期数字同一基线（允许 0.1px 子像素舍入，不能有像素级漂移）
    const offsets = await page.evaluate(() => [...document.querySelectorAll('[data-date]')]
      .map(c => {
        const n = c.querySelector('.day-number')
        return n ? +(n.getBoundingClientRect().y - c.getBoundingClientRect().y).toFixed(2) : null
      })
      .filter(v => v !== null))
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(0.1)
  })

  test('monitor pill stays inside the day square (no 破圈/截断)', async ({ page }) => {
    await openCalendar(page)

    const pills = page.locator('.day-block .monitor-pill')
    const count = await pills.count()
    test.skip(count === 0, '测试库当前月没有监控数据')

    for (let i = 0; i < count; i++) {
      const pill = pills.nth(i)
      await expect(pill).toBeVisible()
      const text = (await pill.textContent()).trim()
      const state = await pill.evaluate(el => {
        const cell = el.closest('.day-block')
        const cr = cell.getBoundingClientRect(), pr = el.getBoundingClientRect()
        return {
          inside: pr.left >= cr.left + 1 && pr.right <= cr.right - 1 && pr.top >= cr.top + 1 && pr.bottom <= cr.bottom - 1,
          truncated: el.scrollWidth > el.clientWidth + 1,
        }
      })
      expect(state.truncated, `pill 被截断：${text}`).toBe(false)
      expect(state.inside, `pill 越出方块：${text}`).toBe(true)
    }
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
    await expect(outOfRange.locator('.holiday-mark')).toHaveCount(0)
    await expect(page.locator('.holiday-summary')).toHaveCount(0)
  })
})
