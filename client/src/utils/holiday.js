import { getDayDetail } from 'chinese-days'

// chinese-days 的中文名不统一（有的带「节」：中秋/清明/端午）→ 统一为通用名，UI 各处用词一致
const NAME_MAP = { 清明: '清明节', 端午: '端午节', 中秋: '中秋节' }

/** 休/班 的界面文案（DaySheet 等详情处使用；字形由 HolidayBadge 组件统一渲染） */
export const HOLIDAY_TYPE_LABELS = { holiday: '法定假日', workday: '调休补班' }

/** 休/班 的字形（HolidayBadge 与月摘要共用，避免多处写「休」「班」字面量） */
export const HOLIDAY_TYPE_MARKS = { holiday: '休', workday: '班' }

/**
 * 中国法定节假日 / 调休补班查询（离线，数据随 chinese-days 包内置）。
 *
 * 语义（research/chinese-days-api.md 实测）：
 * - 法定放假 → type 'holiday'（日历/DaySheet 显示「休」）
 * - 调休补班 → type 'workday'（显示「班」）
 * - 普通日（含普通周末）与超出数据范围（2027+）→ null，不显示任何标记
 *
 * 判定必须用 name 是否含逗号：普通日 name 是英文星期名（如 'Thursday'），
 * 节日条目是 'National Day,国庆节,3'，不依赖 isHoliday()（它对所有周末也返回 true）。
 *
 * @param {string} dateKey YYYY-MM-DD（直接透传日历日期串，不经 Date 对象，避免时区偏移）
 * @returns {{ name: string, type: 'holiday' | 'workday' } | null}
 */
export function holidayFor(dateKey) {
  if (!dateKey) return null
  const detail = getDayDetail(dateKey)
  if (!detail.name.includes(',')) return null
  const raw = detail.name.split(',')[1]
  return { name: NAME_MAP[raw] || raw, type: detail.work ? 'workday' : 'holiday' }
}

/**
 * 某个月的休/班摘要（月历下方一行）。固定顺序：先全部「休」（按日期），再全部「班」。
 * 连续的同类型日期合并成区间；休的多个节日不合并（名称不同则另起一段）。
 *
 * 例：2026-10 → '休 1–7 国庆节 · 班 10'
 *
 * @param {number} year 年（如 2026）
 * @param {number} month 月（1-12）
 * @returns {string} 该月没有休/班时为 ''
 */
export function monthHolidaySummary(year, month) {
  const totalDays = new Date(year, month, 0).getDate()
  const runs = { holiday: [], workday: [] }

  for (let day = 1; day <= totalDays; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const info = holidayFor(key)
    if (!info) continue
    const list = runs[info.type]
    const last = list[list.length - 1]
    const sameBlock = last && last.end === day - 1 && (info.type !== 'holiday' || last.name === info.name)
    if (sameBlock) last.end = day
    else list.push({ start: day, end: day, name: info.name })
  }

  const span = run => (run.start === run.end ? `${run.start}` : `${run.start}–${run.end}`)
  return [
    ...runs.holiday.map(run => `${HOLIDAY_TYPE_MARKS.holiday} ${span(run)} ${run.name}`),
    ...runs.workday.map(run => `${HOLIDAY_TYPE_MARKS.workday} ${span(run)}`),
  ].join(' · ')
}
