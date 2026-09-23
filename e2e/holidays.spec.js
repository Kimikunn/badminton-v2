import { test, expect } from '@playwright/test'

/**
 * Holidays — 订场日历（Vant Calendar）的法定节假日 / 调休补班 / 不可用标记
 *
 * 每个用例自行安装固定时钟（不同用例需要不同的「今天」）：
 * - T1 时钟 2026-10-01：10/1–7 休（国庆节）、10/10 班（调休补班）、10/8 普通日；
 *   点 10/1 → DaySheet「国庆节 / 法定假日」；月摘要「休 1–7 国庆节 · 班 10」
 * - T2 时钟 2026-09-10：09-25 休（中秋节）；测试库不可用日 09-16/09-18 落在可见月且在未来
 *   → 红底 + X、点击仍开 DaySheet；监控胶囊不截断/不越出格子
 * - T3 时钟 2026-10-01：把日历滚到 2026-11 → 该月无休/班标记，月摘要消失（可见月跟踪生效）
 * - T4 时钟 2026-10-01：滚到 2027-01 → 超出 chinese-days 数据范围，无标记
 *
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test e2e/holidays.spec.js
 */

const OCT = new Date('2026-10-01T12:00:00+08:00')
// 09-10 而不是 09-22：测试库不可用日是 09-16/09-18，只有「今天」早于它们时才是可点击的未来日（AC2）
const SEP = new Date('2026-09-10T12:00:00+08:00')

async function openCalendar(page, now) {
  await page.clock.install({ time: now })
  await page.goto('/venues', { waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: '日历' }).click()
}

const day = (page, key) => page.locator(`.van-calendar__day:has([data-date="${key}"])`)

/** 把日历滚动容器滚到目标日期所在月的顶部（不同于页面滚动，月份区块是懒渲染的外层锚点） */
async function scrollToMonth(page, key) {
  await page.locator('.van-calendar__body').evaluate((el, dateKey) => {
    const cell = el.querySelector(`[data-date="${dateKey}"]`)
    const month = cell.closest('.van-calendar__month')
    el.scrollTop = month.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
  }, key)
}

test.describe('Calendar holidays', () => {
  test('T1 十月网格：1–7 休、10 班、摘要与 DaySheet（法定假日）', async ({ page }) => {
    await openCalendar(page, OCT)

    for (let d = 1; d <= 7; d++) {
      await expect(day(page, `2026-10-0${d}`)).toContainText('休')
    }
    await expect(day(page, '2026-10-10')).toContainText('班')
    await expect(day(page, '2026-10-08')).not.toContainText('休')

    // 月摘要对应首屏可见月（10 月），固定结构「休 <日期> <名称> · 班 <日期>」
    const summary = page.locator('.holiday-summary')
    await expect(summary).toContainText('休 1–7 国庆节')
    await expect(summary).toContainText('班 10')

    await page.locator('[data-date="2026-10-01"]').click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('法定假日')
    await expect(sheet.locator('.holiday-chip')).toHaveText('休')
  })

  test('T1b 点击调休补班日 → DaySheet（班/调休补班）', async ({ page }) => {
    await openCalendar(page, OCT)

    await page.locator('[data-date="2026-10-10"]').click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('调休补班')
    await expect(sheet.locator('.holiday-chip')).toHaveText('班')
  })

  test('T2 九月：中秋节标记 + 不可用日红底 X 且可开 DaySheet + 胶囊几何', async ({ page }) => {
    await openCalendar(page, SEP)

    await expect(day(page, '2026-09-25')).toContainText('休')

    // 不可用日：红底 + X，点击仍要上抛 select-day（DaySheet 里可取消标记）。
    // 只取「今天及以后」的不可用日：过去日按 R3 忽略点击（与旧日历一致）
    const key = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.van-calendar__day.day-unavail [data-date]')]
      return cells.find(c => c.getAttribute('data-date') >= '2026-09-10')?.getAttribute('data-date') || null
    })
    test.skip(!key, '测试库当前可见月没有可点击（今天及以后）的不可用日')
    const unavail = page.locator(`.van-calendar__day.day-unavail:has([data-date="${key}"])`)
    const bg = await unavail.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg, `不可用日 ${key} 应有红底`).not.toBe('rgba(0, 0, 0, 0)')
    await expect(unavail.locator('.day-x')).toBeVisible()

    await page.locator(`[data-date="${key}"]`).click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('已标记为不可用')

    // 监控胶囊：可见胶囊全部不截断、不越出日格子
    const pills = page.locator('.van-calendar__day .monitor-pill')
    const pillCount = await pills.count()
    test.skip(pillCount === 0, '测试库当前可见月没有监控数据')
    for (let i = 0; i < pillCount; i++) {
      const pill = pills.nth(i)
      await expect(pill).toBeVisible()
      const text = (await pill.textContent()).trim()
      const state = await pill.evaluate(el => {
        const cell = el.closest('.van-calendar__day')
        const cr = cell.getBoundingClientRect(), pr = el.getBoundingClientRect()
        return {
          inside: pr.left >= cr.left + 1 && pr.right <= cr.right - 1 && pr.top >= cr.top + 1 && pr.bottom <= cr.bottom - 1,
          truncated: el.scrollWidth > el.clientWidth + 1,
        }
      })
      expect(state.truncated, `pill 被截断：${text}`).toBe(false)
      expect(state.inside, `pill 越出格子：${text}`).toBe(true)
    }
  })

  test('T3 滚动到 2026-11：无休/班标记，月摘要消失', async ({ page }) => {
    await openCalendar(page, OCT)

    // 首屏是 10 月（有摘要），滚动后应换成 11 月（无休/班 → 摘要行消失）
    await expect(page.locator('.holiday-summary')).toContainText('休 1–7 国庆节')
    await scrollToMonth(page, '2026-11-01')

    const nov = page.locator('.van-calendar__month').filter({ has: page.locator('[data-date="2026-11-01"]') })
    await expect(nov).not.toContainText('休')
    await expect(nov).not.toContainText('班')
    await expect(page.locator('.holiday-summary')).toHaveCount(0)
  })

  test('T4 滚动到 2027-01（数据范围外）：无休/班标记，月摘要消失', async ({ page }) => {
    await openCalendar(page, OCT)
    await scrollToMonth(page, '2027-01-05')

    const jan = page.locator('.van-calendar__month').filter({ has: page.locator('[data-date="2027-01-05"]') })
    await expect(jan).not.toContainText('休')
    await expect(page.locator('.holiday-summary')).toHaveCount(0)
  })
})
