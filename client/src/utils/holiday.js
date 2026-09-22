import { getDayDetail } from 'chinese-days'

// chinese-days 的中文名不统一（有的带「节」：中秋/清明/端午）→ 统一为通用名，UI 各处用词一致
const NAME_MAP = { 清明: '清明节', 端午: '端午节', 中秋: '中秋节' }

/** 休/班 的界面文案（DaySheet 等详情处使用；字形由 HolidayBadge 组件统一渲染） */
export const HOLIDAY_TYPE_LABELS = { holiday: '法定假日', workday: '调休补班' }

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
