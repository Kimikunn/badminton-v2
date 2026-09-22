import { getDayDetail } from 'chinese-days'

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
  return { name: detail.name.split(',')[1], type: detail.work ? 'workday' : 'holiday' }
}
