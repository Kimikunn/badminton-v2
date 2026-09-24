import { test, expect } from '@playwright/test'

/**
 * Holidays — 订场日历（自绘固定单月，mockup v3）的节假日 / 不可用 / 色条 / 填色 / 数字对齐
 *
 * 每个用例自行安装固定时钟（不同用例需要不同的「今天」）；监控/订场期望由
 * /api/intents、/api/bookings/records 的实时数据派生（page.clock 只固定浏览器端，
 * 服务端状态推导始终用真实时间，所以期望必须动态计算，而不是写死）。
 *
 * - AC1 固定单月：默认今天月；‹›切月；最早订场记录月 ‹ disabled、今天+6 月 › disabled
 * - AC2 休/班：时钟 2026-10-01 → 10/1–7 休（右上小字）、10/10 班、普通日无标记；
 *   点节假日开 DaySheet
 * - AC3 色条：活跃监控 → 段数/配色匹配（两态契约 2026-09-23：awaiting_verify 期望蓝条而非黄条、
 *   fulfilled 不生成段）；已暂停日无条；不可用日无条
 * - AC4 填色：今天蓝底、订场绿底（过去日淡化为整格 opacity）、不可用红底+数字划线
 * - AC5 数字对齐：同一行所有格子（带/不带色条、带/不带休班）的数字 y 坐标一致
 * - AC8 视图切换器：SegmentedControl（列表/日历）在订场记录标题行右侧；
 *   切到日历后列表内垃圾桶 computed visibility 立即 hidden（第八轮半：防 transition-all 拖尾）
 * - AC9 列表视图（第八轮修订）：全量展示所有记录、无展开/收起按钮；
 *   两分支 grid 叠放，容器高度 = 日历自然高度，列表分支 overflow-y auto + min-height 0 常开内滚
 * - AC14 列表容器（第八轮修订）：overflow-y auto 常开，可滚到底部；无吸底按钮遮挡内容
 * - AC11 两视图等高：列表↔日历切换卡片高度不变（±2px）；日历网格恒 42 格；
 *   日历分支在容器内无滚动（scrollHeight == clientHeight）
 * - AC13 相邻月填充：42 格全有数字；首行上月日期、尾部下月日期；相邻月格无 data-date、不可点
 * - AC7 图例分组固定（第十轮修订）：信息栏恒渲染，左组=日期填色（今天/订场/不可用）、右组=监控色条（监控中/待放票），
 *   任意月份恒 5 项、顺序固定，不随当月语义动态增减；总时长恒显示（第十二轮组件化 CalendarInfoBar），
 *   当月总时长为 0 时也渲染「0h」占位（右端布局不随数据跳动）
 *
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test e2e/holidays.spec.js
 */

const OCT = new Date('2026-10-01T12:00:00+08:00')
// 09-10 而不是 09-22：测试库不可用日是 09-16/09-18，只有「今天」早于它们时才是可点击的未来日
const SEP = new Date('2026-09-10T12:00:00+08:00')

// 服务端 status → 格子色条段类（两态契约 2026-09-23：与 BookingCalendar 的 MONITOR_BAR_CLASS 一致——
// awaiting_verify 映射为 watching 蓝条；fulfilled 为瞬态不生成段，推送负责支付引导）
const SEG_CLASS = {
  watching: 'bar-watching',
  pending_release: 'bar-waiting',
  waiting: 'bar-waiting',
}
// 聚合映射（与 stores/intent.js aggregateDayBars 一致）：awaiting_verify → watching；
// expired/paused/fulfilled 不生成段
const AGG_MAP = { awaiting_verify: 'watching' }
const EXCLUDED = ['expired', 'paused', 'fulfilled']
// 段序 = BADGE_PRIORITY 优先级序（排序只影响段顺序，数组保持完整镜像）
const PRIORITY = ['awaiting_verify', 'fulfilled', 'watching', 'pending_release', 'waiting']

async function openCalendar(page, now) {
  await page.clock.install({ time: now })
  await page.goto('/venues', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '日历', exact: true }).click()
}

const day = (page, key) => page.locator(`.cal-day[data-date="${key}"]`)
const monthTitle = page => page.locator('.month-title')
const prevBtn = page => page.getByRole('button', { name: '上一月' })
const nextBtn = page => page.getByRole('button', { name: '下一月' })

/** 用箭头把日历导航到 YYYY-MM 所在月（自绘日历无滚动，箭头是唯一切月方式） */
async function gotoMonth(page, ym) {
  const [ty, tm] = ym.split('-').map(Number)
  for (let i = 0; i < 24; i++) {
    const text = await monthTitle(page).textContent()
    const m = text.match(/(\d{1,2})月\s*(\d{4})/)
    if (m && +m[2] === ty && +m[1] === tm) return true
    const curIdx = +m[2] * 12 + +m[1]
    const goNext = ty * 12 + tm > curIdx
    const btn = goNext ? nextBtn(page) : prevBtn(page)
    if (!(await btn.isEnabled())) return false
    await btn.click()
  }
  return false
}

/** 当天参与色条的活跃监控状态数组（两态聚合后、按优先级排序），来自服务端实时派生的 status */
async function activeBarsByDate(page) {
  const res = await (await page.request.get('/api/intents')).json()
  const byDate = new Map()
  for (const it of res.data || []) {
    if (!it.date || EXCLUDED.includes(it.status)) continue
    const list = byDate.get(it.date) || []
    list.push(AGG_MAP[it.status] || it.status)
    byDate.set(it.date, list)
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))
  }
  return byDate
}

async function bookingDates(page) {
  const res = await (await page.request.get('/api/bookings/records')).json()
  return (res.data || []).map(r => r.date).filter(Boolean)
}

test.describe('Calendar holidays v3', () => {
  test('AC8/AC9/AC14 视图切换器在标题行右侧；列表全量展示 + 常开内滚', async ({ page }) => {
    await page.clock.install({ time: SEP })
    await page.goto('/venues', { waitUntil: 'networkidle' })

    const card = page.locator('.liquid-card').first()
    const title = card.locator('h3', { hasText: '订场记录' })
    const calBtn = card.getByRole('button', { name: '日历', exact: true })
    const listBtn = card.getByRole('button', { name: '列表', exact: true })
    await expect(title).toBeVisible()
    await expect(calBtn).toBeVisible()
    await expect(listBtn).toBeVisible()

    // AC8：切换器在标题行右侧：与 h3 同一行（垂直中线一致、x 在标题右侧）
    const titleBox = await title.boundingBox()
    const calBox = await calBtn.boundingBox()
    expect(Math.abs((titleBox.y + titleBox.height / 2) - (calBox.y + calBox.height / 2))).toBeLessThanOrEqual(10)
    expect(calBox.x).toBeGreaterThan(titleBox.x + titleBox.width)

    const records = await bookingDates(page)

    // AC9/AC14：无展开/收起按钮（全文 count 0）
    await expect(page.getByText('展开全部')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '收起', exact: true })).toHaveCount(0)

    const rows = card.locator('.py-2.border-b')
    const body = card.locator('.record-body')
    const listBody = card.locator('.record-list')
    const calEl = card.locator('.venue-calendar')
    await expect(body).toBeVisible()
    await expect(listBody).toBeVisible()

    // 容器高度 = 日历自然高度（两分支 grid 叠放，非激活分支 visibility 隐藏仍占布局）
    const calH = await calEl.evaluate(el => el.getBoundingClientRect().height)
    const bodyH = await body.evaluate(el => el.getBoundingClientRect().height)
    expect(Math.abs(bodyH - calH), `容器 ${bodyH}px 应等于日历自然高度 ${calH}px`).toBeLessThanOrEqual(1)

    // 关键：日历分支在容器内无滚动（scrollHeight == clientHeight；列表态下日历隐藏仍占布局可测）
    const calScroll = await calEl.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight }))
    expect(
      Math.abs(calScroll.sh - calScroll.ch),
      `日历 scrollHeight ${calScroll.sh} vs clientHeight ${calScroll.ch}，日历不应内滚`
    ).toBeLessThanOrEqual(1)

    // AC14：列表分支 overflow-y auto + min-height 0 常开内滚，可滚到底部（无吸底按钮遮挡内容）
    expect(
      await listBody.evaluate(el => getComputedStyle(el).overflowY),
      '列表分支 overflow-y 应为 auto（常开内滚）'
    ).toBe('auto')
    expect(
      await listBody.evaluate(el => getComputedStyle(el).minHeight),
      '列表分支 min-height 应为 0（grid 内滚动必需）'
    ).toBe('0px')
    await listBody.evaluate(el => { el.scrollTop = el.scrollHeight })
    const st = await listBody.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
    expect(st.top, `scrollTop ${st.top} 应等于可滚动上限 ${st.max}`).toBe(st.max)

    // AC9：全量行数 = /api 派生记录数（records ≤7 时全量与预览无差别，此断言 skip）
    test.skip(records.length <= 7, `测试库当前订场记录 ${records.length} 条，不足以验证全量展示`)
    await expect(rows).toHaveCount(records.length)

    // AC8：点「日历」切日历视图，点「列表」切回（日历常渲染，列表态下隐藏）
    // 垃圾桶即时消失：切到日历后立即（不 sleep）取列表内 .icon-btn 的 computed visibility
    // 应已是 hidden（transition-all 会让 visibility 被 0.12s 过渡拖住 → 垃圾桶叠在日历上慢慢消失）
    await calBtn.click()
    if (records.length) {
      const trashVis = await page.evaluate(
        () => getComputedStyle(document.querySelector('.record-list .icon-btn')).visibility
      )
      expect(trashVis, `切日历后垃圾桶 visibility 应立即 hidden，实际 ${trashVis}`).toBe('hidden')
    }
    await expect(page.locator('.cal-grid')).toBeVisible()
    await listBtn.click()
    await expect(page.locator('.cal-grid')).not.toBeVisible()
    if (records.length) await expect(rows.first()).toBeVisible()
  })

  test('AC11 两视图等高：切换卡片外框高度差 ≤2px；日历网格恒 42 格', async ({ page }) => {
    await page.clock.install({ time: SEP })
    await page.goto('/venues', { waitUntil: 'networkidle' })

    const card = page.locator('.liquid-card').first()
    const calBtn = card.getByRole('button', { name: '日历', exact: true })
    const listBtn = card.getByRole('button', { name: '列表', exact: true })

    const grid = page.locator('.cal-grid')
    const body = card.locator('.record-body')
    const calEl = card.locator('.venue-calendar')
    await listBtn.click()
    if (await body.count()) {
      const listCardH = (await card.boundingBox()).height
      await calBtn.click()
      await expect(grid).toBeVisible()
      const calCardH = (await card.boundingBox()).height
      expect(Math.abs(calCardH - listCardH), `列表 ${listCardH}px vs 日历 ${calCardH}px`).toBeLessThanOrEqual(2)

      // 关键：日历分支在容器内无滚动，容器高度 = 日历自然高度
      const cs = await calEl.evaluate(el => ({
        sh: el.scrollHeight, ch: el.clientHeight, h: el.getBoundingClientRect().height,
      }))
      expect(
        Math.abs(cs.sh - cs.ch),
        `日历 scrollHeight ${cs.sh} vs clientHeight ${cs.ch}，日历不应内滚`
      ).toBeLessThanOrEqual(1)
      const bodyH = await body.evaluate(el => el.getBoundingClientRect().height)
      expect(Math.abs(bodyH - cs.h), `容器 ${bodyH}px 应等于日历自然高度 ${cs.h}px`).toBeLessThanOrEqual(1)

      // 网格子元素恒 42（相邻月填充格 + 当月天数），切月不变
      const cells = await grid.evaluate(el => el.children.length)
      expect(cells, `网格子元素应恒 42，实际 ${cells}`).toBe(42)
      await nextBtn(page).click()
      const next = await grid.evaluate(el => el.children.length)
      expect(next, `切月后网格子元素应仍恒 42，实际 ${next}`).toBe(42)
    } else {
      test.skip(true, '测试库无订场记录，列表视图为 EmptyState 无法对比等高')
    }
  })

  test('AC13 相邻月填充：42 格全有数字、首行上月/尾部下月日期、相邻月格不可点无 data-date', async ({ page }) => {
    await openCalendar(page, SEP)

    const state = await page.evaluate(() => {
      const g = document.querySelector('.cal-grid')
      const cells = [...g.children]
      return {
        total: cells.length,
        nums: cells.map(c => c.querySelector('.num')?.textContent || null),
        adj: cells.map(c => c.classList.contains('day-adj')),
        dataDates: cells.map(c => c.getAttribute('data-date')),
      }
    })

    expect(state.total, `网格子元素应恒 42，实际 ${state.total}`).toBe(42)
    expect(state.nums.every(n => n && /^\d+$/.test(n)), '42 格全部渲染日期数字').toBe(true)

    // 2026-09：9-01 周二 → 首行 1 个上月格（8 月 30/31 → 实际 31）；30 天 + 1 lead → 尾部 42-31=11 格为 10 月 1..11
    const lead = state.adj.indexOf(false)
    expect(state.nums.slice(0, lead).map(Number), '首行上月日期（升序）').toEqual(
      Array.from({ length: lead }, (_, i) => 31 - lead + i + 1)
    )
    expect(state.nums.slice(30 + lead).map(Number), '尾部下月日期应为 10 月 1..N').toEqual(
      Array.from({ length: 42 - lead - 30 }, (_, i) => i + 1)
    )

    // 相邻月格：无 data-date、无领域标记（休/班/色条）、淡化且不可点
    for (let i = 0; i < state.total; i++) {
      if (!state.adj[i]) continue
      expect(state.dataDates[i], `第 ${i + 1} 格为相邻月格不应有 data-date`).toBeNull()
    }
    expect((await page.locator('.cal-grid .cal-day.day-adj .holi-mark').count()), '相邻月格无休/班标记').toBe(0)
    expect((await page.locator('.cal-grid .cal-day.day-adj .bars').count()), '相邻月格无色条').toBe(0)
    const adjCell = page.locator('.cal-grid .cal-day.day-adj').first()
    expect(await adjCell.evaluate(el => Number(getComputedStyle(el).opacity)), '相邻月格淡化').toBeLessThan(0.5)
    expect(await adjCell.evaluate(el => getComputedStyle(el).pointerEvents), '相邻月格不可点').toBe('none')
  })

  test('AC13 相邻月填充跨年：12 月尾格 = 次年 1 月日期、上月格 = 11 月', async ({ page }) => {
    await openCalendar(page, OCT)
    // 2027-04 是上限（时钟 2026-10 → +6 月），2026-12 在区间内
    expect(await gotoMonth(page, '2026-12'), '应能导航到 2026-12').toBe(true)

    const state = await page.evaluate(() => {
      const g = document.querySelector('.cal-grid')
      const cells = [...g.children]
      return {
        total: cells.length,
        nums: cells.map(c => c.querySelector('.num')?.textContent || null),
        adj: cells.map(c => c.classList.contains('day-adj')),
      }
    })

    expect(state.total).toBe(42)
    // 2026-12-01 周二 → lead=1（11 月 30 日）；31 天 + 1 lead → 尾部 10 格 = 1 月 1..10
    expect(state.nums[0], '12 月首行上月格应为 11 月 30 日').toBe('30')
    expect(state.nums.slice(1 + 31).map(Number), '12 月尾格应为次年 1 月 1..10（跨年）').toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1)
    )
    expect(state.adj.filter(Boolean).length, '相邻月格总数 = 42-31').toBe(11)
  })

  test('AC2 十月：休/班 右上小字、普通日无标记、节假日开 DaySheet', async ({ page }) => {
    await openCalendar(page, OCT)

    for (let d = 1; d <= 7; d++) {
      await expect(day(page, `2026-10-0${d}`).locator('.holi-mark')).toHaveText('休')
      await expect(day(page, `2026-10-0${d}`).locator('.holi-mark')).toHaveClass(/text-danger/)
    }
    await expect(day(page, '2026-10-10').locator('.holi-mark')).toHaveText('班')
    await expect(day(page, '2026-10-10').locator('.holi-mark')).toHaveClass(/text-fg-muted/)

    for (const key of ['2026-10-08', '2026-10-12', '2026-10-20']) {
      await expect(day(page, key).locator('.holi-mark')).toHaveCount(0)
    }

    await page.locator('[data-date="2026-10-01"]').click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('法定假日')
    await expect(sheet.locator('.holiday-chip')).toHaveText('休')
  })

  test('AC2 点击调休补班日 → DaySheet（班/调休补班）', async ({ page }) => {
    await openCalendar(page, OCT)

    await page.locator('[data-date="2026-10-10"]').click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('国庆节')
    await expect(sheet).toContainText('调休补班')
    await expect(sheet.locator('.holiday-chip')).toHaveText('班')
  })

  test('AC3/AC4 九月：中秋休标记 + 不可用日红底划线、无色条、可开 DaySheet', async ({ page }) => {
    await openCalendar(page, SEP)

    await expect(day(page, '2026-09-25').locator('.holi-mark')).toHaveText('休')

    // 不可用日：红淡底 + 数字划线，无色条；点击仍上抛 select-day（DaySheet 里可取消标记）
    const key = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cal-day.day-unavail[data-date]')]
      return cells.find(c => c.getAttribute('data-date') >= '2026-09-10')?.getAttribute('data-date') || null
    })
    test.skip(!key, '测试库当前可见月没有可点击（今天及以后）的不可用日')
    const unavail = day(page, key)
    await expect(unavail).toHaveClass(/day-unavail/)
    const bg = await unavail.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg, `不可用日 ${key} 应有红底`).not.toBe('rgba(0, 0, 0, 0)')
    const num = unavail.locator('.num')
    const deco = await num.evaluate(el => getComputedStyle(el).textDecorationLine)
    expect(deco, `不可用日 ${key} 数字应有划线`).toContain('line-through')
    await expect(unavail.locator('.bars')).toHaveCount(0)

    await page.locator(`[data-date="${key}"]`).click()
    const sheet = page.locator('.liquid-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('已标记为不可用')
  })

  test('AC1 固定单月：默认今天月、箭头切月、两端边界 disabled', async ({ page }) => {
    await openCalendar(page, OCT)

    await expect(monthTitle(page)).toContainText('10月')
    await expect(monthTitle(page)).toContainText('2026')
    await expect(day(page, '2026-10-15')).toBeVisible()
    await expect(day(page, '2026-09-15')).toHaveCount(0)
    await expect(day(page, '2026-11-15')).toHaveCount(0)

    await nextBtn(page).click()
    await expect(monthTitle(page)).toContainText('11月')
    await prevBtn(page).click()
    await expect(monthTitle(page)).toContainText('10月')

    // 回看下限 = 最早订场记录所在月（无记录则今天所在月）→ ‹ disabled
    const dates = (await bookingDates(page)).sort()
    const minKey = dates[0] ? dates[0].slice(0, 7) : '2026-10'
    const [minY, minM] = minKey.split('-').map(Number)
    expect(await gotoMonth(page, minKey), `应能导航到 ${minKey}`).toBe(true)
    await expect(prevBtn(page)).toBeDisabled()
    await expect(monthTitle(page)).toContainText(`${minM}月`)
    await expect(monthTitle(page)).toContainText(`${minY}`)

    // 上限 = 今天所在月 +6（时钟 2026-10 → 2027-04）→ › disabled，且 ‹ 仍可用
    expect(await gotoMonth(page, '2027-04'), '应能导航到 2027-04').toBe(true)
    await expect(nextBtn(page)).toBeDisabled()
    await expect(prevBtn(page)).toBeEnabled()
  })

  test('AC3 色条：活跃监控段数/配色匹配', async ({ page }) => {
    await openCalendar(page, OCT)

    const barsByDate = await activeBarsByDate(page)
    const active = [...barsByDate.entries()].filter(([date]) => date.startsWith('2026-10'))
    test.skip(active.length === 0, '测试库 10 月当前没有活跃监控（服务端按真实时间派生状态）')

    for (const [date, statuses] of active) {
      const segments = day(page, date).locator('.bars i')
      await expect(segments, `${date} 段数应为 ${statuses.length}`).toHaveCount(statuses.length)
      for (let i = 0; i < statuses.length; i++) {
        await expect(segments.nth(i)).toHaveClass(new RegExp(SEG_CLASS[statuses[i]]))
      }
    }
  })

  test('AC3 已暂停日：当天只有 paused 监控 → 无色条段', async ({ page }) => {
    await openCalendar(page, SEP)

    const barsByDate = await activeBarsByDate(page)
    const res = await (await page.request.get('/api/intents')).json()
    const pausedOnly = [...new Set((res.data || []).filter(it => it.date?.startsWith('2026-09')).map(it => it.date))]
      .filter(date => !(barsByDate.get(date) || []).length)
    test.skip(pausedOnly.length === 0, '测试库 9 月当前没有「仅已暂停监控」的日期')
    for (const date of pausedOnly) {
      await expect(day(page, date).locator('.bars'), `${date} 已暂停不应有色条`).toHaveCount(0)
    }
  })

  test('AC4 填色：今天蓝底、订场绿底（过去日整格淡化）、今天优先于订场', async ({ page }) => {
    // 时钟 2026-09-10：今天=09-10（测试库当天也有订场记录 → 今天蓝底优先）
    await openCalendar(page, SEP)

    // 今天：实心 accent 蓝底 + day-today 类
    const today = day(page, '2026-09-10')
    await expect(today).toHaveClass(/day-today/)
    const todayBg = await today.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(todayBg, '今天格子应有实心蓝底').not.toBe('rgba(0, 0, 0, 0)')
    const todayColor = await today.locator('.num').evaluate(el => getComputedStyle(el).color)
    expect(todayColor, '今天数字应反白').not.toBe('rgba(0, 0, 0, 0)')

    // 订场记录：未来日绿底类；过去日 day-book + day-past（整格 opacity .35 自然变淡）
    const records = (await bookingDates(page)).filter(d => d.startsWith('2026-09'))
    test.skip(records.length === 0, '测试库 9 月当前没有订场记录')
    for (const date of records) {
      const cell = day(page, date)
      await expect(cell).toHaveClass(/day-book/)
      if (date < '2026-09-10') {
        await expect(cell).toHaveClass(/day-past/)
        const opacity = await cell.evaluate(el => Number(getComputedStyle(el).opacity))
        expect(opacity, `${date} 过去日应整格淡化`).toBeLessThan(0.5)
      } else if (date > '2026-09-10') {
        await expect(cell).not.toHaveClass(/day-past/)
        const bg = await cell.evaluate(el => getComputedStyle(el).backgroundColor)
        expect(bg, `${date} 订场日应有绿淡底`).not.toBe('rgba(0, 0, 0, 0)')
      }
    }
  })

  test('AC7 图例分组固定：左组日期填色、右组监控色条，任意月份恒定、信息栏恒渲染', async ({ page }) => {
    await openCalendar(page, OCT)

    // 分组与顺序（与 BookingCalendar 的 legendLeft/legendRight 常量一致）
    const LEFT = ['今天', '订场', '不可用']
    const RIGHT = ['监控中', '待放票']
    const readGroup = async (nth) =>
      (await page.locator(`.infobar .items:nth-of-type(${nth}) .item`).allTextContents()).map(t => t.trim())

    await expect(page.locator('.infobar')).toBeVisible()
    expect(await readGroup(1), '左组应为日期填色三项（顺序固定）').toEqual(LEFT)
    expect(await readGroup(2), '右组应为监控色条两项（顺序固定）').toEqual(RIGHT)

    // 切到下一月（11 月）再切回来：图例不随当月语义增减，恒定同序
    await nextBtn(page).click()
    await expect(page.locator('.infobar')).toBeVisible()
    expect(await readGroup(1), '切月后左组仍恒定同序').toEqual(LEFT)
    expect(await readGroup(2), '切月后右组仍恒定同序').toEqual(RIGHT)

    // 第十二轮：总时长恒显示（0h 占位）——11 月（测试库无订场记录）也渲染「0h」，右端布局不跳动
    const hoursEl = page.locator('.infobar .hours')
    await expect(hoursEl, '0h 月份总时长仍应渲染（恒显示）').toBeVisible()
    await expect(hoursEl).toHaveText('0h')

    // 图例元素形态：左组 3 个色块 sw（今天/订场/不可用），右组 2 个色条 barleg（监控中/待放票）
    expect(await page.locator('.infobar .items .item .sw').count(), '色块应为 3 个').toBe(3)
    expect(await page.locator('.infobar .items .item .barleg').count(), '色条应为 2 个').toBe(2)
  })

  test('AC5 数字对齐：同一行所有格子的数字 y 坐标一致（含色条/休班组合）', async ({ page }) => {
    await openCalendar(page, OCT)

    const rows = await page.evaluate(() => {
      const byRow = new Map()
      for (const cell of document.querySelectorAll('.cal-day[data-date]')) {
        const num = cell.querySelector('.num')?.getBoundingClientRect()
        const cr = cell.getBoundingClientRect()
        if (!num || !cr.height) continue
        const rowKey = Math.round(cr.top)
        if (!byRow.has(rowKey)) byRow.set(rowKey, [])
        byRow.get(rowKey).push({
          date: cell.getAttribute('data-date'),
          top: num.top,
          hasBars: !!cell.querySelector('.bars'),
        })
      }
      return [...byRow.values()].filter(cells => cells.length >= 2)
    })

    for (const cells of rows) {
      const tops = cells.map(c => c.top)
      const spread = Math.max(...tops) - Math.min(...tops)
      expect(spread, `同行数字 y 偏移应为 0：${JSON.stringify(cells)}`).toBeLessThanOrEqual(1)
    }
  })
})
