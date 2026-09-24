<script setup>
/**
 * BookingCalendar — 订场月历（自绘固定单月，ADR 0003）
 *
 * 骨架自绘：一次只渲染一个月，‹›箭头切月（不支持滚动）。月份区间：
 * 上限 = 今天所在月 +6；下限 = 最早订场记录所在月（无记录则今天所在月），到边禁用箭头。
 * 视觉语言（research/mockup-v3.html 定稿）：
 * - 监控 = 底部多段色条（每条监控一根 4px 段，段序 = BADGE_PRIORITY 优先级序；
 *   两态契约 2026-09-23：只有监控中深蓝 / 待放票浅蓝，瞬态（已锁到）不生成段；
 *   已暂停/已过期不生成段；不可用日与过去日无条）；
 * - 填色 = 今天实心 accent 蓝（优先）/ 不可用 danger 红淡底+数字划线 / 订场 success 绿淡底；
 *   过去日整格 opacity .35 淡化且不可点；
 * - 休/班 = 数字右上 8px 小字（复用 HolidayBadge xs，字形语义沿用 HOLIDAY_TYPE_MARKS）。
 * 日期数字永远 flex 几何居中：色条/休班/图例全部绝对定位或独立行，不进数字排版流。
 * 网格恒 6 行 42 格（R13）：首行空位渲染上月末尾日期、尾部空位渲染下月开头日期（day-adj，纯视觉淡化）。
 *
 * @props {Array} records - 订场记录（date/startTime/endTime），用于绿底与当月总小时
 * @props {Set<string>} unavailableDateSet - 不可用日期（YYYY-MM-DD）
 * @props {Map<string, string[]>} monitorStatusByDate - 每天监控状态数组（段序=优先级序）
 *
 * @events select-day - 点击今天及以后某天（不可用日同样上抛，由 DaySheet 处理）
 */
import { ref, computed } from 'vue'
import { holidayFor } from '@/utils/holiday'
import HolidayBadge from '@/components/venue/HolidayBadge.vue'
import CalendarInfoBar from '@/components/venue/CalendarInfoBar.vue'

const props = defineProps({
  records: { type: Array, default: () => [] },
  unavailableDateSet: { type: Set, default: () => new Set() },
  monitorStatusByDate: { type: Map, default: () => new Map() },
})

const emit = defineEmits(['select-day'])

// 色条配色（两态契约 2026-09-23：awaiting_verify 已在聚合层映射为 watching；
// fulfilled 为瞬态不生成段，推送负责支付引导，故不出现在映射——色值全部走现有 token）：
// 监控中=badge-blue 深蓝 / 待放票（含等待放票）=accent 浅蓝（2026-09-23 用户定：两蓝拉开深浅）
const MONITOR_BAR_CLASS = {
  watching: 'bar-watching',
  pending_release: 'bar-waiting',
  waiting: 'bar-waiting',
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const today = new Date()
today.setHours(0, 0, 0, 0)
const todayKey = dateKey(today)

const bookingMap = computed(() => {
  const m = new Map()
  for (const r of props.records) {
    if (!r.date) continue
    const arr = m.get(r.date) || []
    arr.push(r)
    m.set(r.date, arr)
  }
  return m
})

// 月份区间：minMonth=最早订场记录月（无 records 则今天所在月）；maxMonth=今天+6 月
const minMonth = computed(() => {
  if (!bookingMap.value.size) return { year: today.getFullYear(), month: today.getMonth() + 1 }
  const earliest = [...bookingMap.value.keys()].sort()[0]
  return { year: +earliest.slice(0, 4), month: +earliest.slice(5, 7) }
})

const maxMonth = computed(() => {
  const d = new Date(today.getFullYear(), today.getMonth() + 6, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
})

// 当前显示月；首屏 = 今天所在月
const cur = ref({ year: today.getFullYear(), month: today.getMonth() + 1 })

const monthIndex = m => m.year * 12 + (m.month - 1)
const atMin = computed(() => monthIndex(cur.value) <= monthIndex(minMonth.value))
const atMax = computed(() => monthIndex(cur.value) >= monthIndex(maxMonth.value))

function navMonth(delta) {
  const d = new Date(cur.value.year, cur.value.month - 1 + delta, 1)
  const next = { year: d.getFullYear(), month: d.getMonth() + 1 }
  if (monthIndex(next) < monthIndex(minMonth.value)) return
  if (monthIndex(next) > monthIndex(maxMonth.value)) return
  cur.value = next
}

// 当前显示月每天的领域信息：格子渲染与图例共用，避免每格重复查表
const metaByKey = computed(() => {
  const map = new Map()
  const { year, month } = cur.value
  const days = new Date(year, month, 0).getDate()
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isToday = key === todayKey
    const isPast = key < todayKey
    const unavailable = props.unavailableDateSet.has(key)
    map.set(key, {
      key,
      day: d,
      unavailable,
      holiday: holidayFor(key),
      bookings: bookingMap.value.get(key) || [],
      bars: unavailable || isPast ? [] : (props.monitorStatusByDate.get(key) || []),
      isToday,
      isPast,
    })
  }
  return map
})

const monthDays = computed(() => [...metaByKey.value.values()])

// 当月 1 号在周一开头网格里的前置空位数
const leadCount = computed(() => (new Date(cur.value.year, cur.value.month - 1, 1).getDay() + 6) % 7)

// 固定 6 行 42 格：首行空位补上月日期、尾部空位补下月日期（Apple 日历做法），高度恒定、切月不变高
const tailCount = computed(() => 42 - leadCount.value - monthDays.value.length)

// 上月最后 leadCount 天的「日」数字（升序；跨年由 Date 构造自动处理，如 1 月 → 去年 12 月）
const prevLeadDays = computed(() => {
  const d = new Date(cur.value.year, cur.value.month - 1, 0).getDate()
  return Array.from({ length: leadCount.value }, (_, i) => d - leadCount.value + i + 1)
})

// 下月开头 tailCount 天的「日」数字（升序；跨年由 Date 构造自动处理，如 12 月 → 次年 1 月）
const nextTailDays = computed(() => Array.from({ length: tailCount.value }, (_, i) => i + 1))

function cellClass(meta) {
  return {
    'day-today': meta.isToday,
    'day-unavail': meta.unavailable,
    'day-book': meta.bookings.length > 0,
    'day-past': meta.isPast,
  }
}

// 点今天及以后 → select-day（不可用日也上抛，DaySheet 里可取消标记）；过去日不可点
function onSelect(meta) {
  if (meta.isPast) return
  emit('select-day', meta.key)
}

const monthTotalHours = computed(() => {
  const prefix = `${cur.value.year}-${String(cur.value.month).padStart(2, '0')}`
  let total = 0
  for (const r of props.records) {
    if (!r.date || !r.date.startsWith(prefix)) continue
    const sh = parseInt((r.startTime || '').split(':')[0], 10)
    const eh = parseInt((r.endTime || '').split(':')[0], 10)
    if (sh >= 0 && eh > sh) total += eh - sh
  }
  return total
})

// 图例固定（2026-09-23，UI 逐月一致）：不再按当月数据筛选。
// 左组=日期填色（今天/订场/不可用），右组=监控色条（监控中/待放票）；2026-09-23 用户定：订场介绍在左、监控介绍在右
// 第十二轮：信息栏抽成 CalendarInfoBar（左组 sw 色块、右组 barleg 色条），总时长恒显示（0h 占位）
const legendLeft = [
  { cls: 'leg-today', label: '今天' },
  { cls: 'leg-book', label: '订场' },
  { cls: 'leg-unavail', label: '不可用' },
]
const legendRight = [
  { cls: 'bar-watching', label: '监控中' },
  { cls: 'bar-waiting', label: '待放票' },
]
</script>

<template>
  <div class="venue-calendar flex flex-col">
    <div class="cal-head">
      <div class="month-title">{{ cur.month }}月 <small>{{ cur.year }}</small></div>
      <div class="month-nav">
        <button type="button" aria-label="上一月" :disabled="atMin" @click="navMonth(-1)">‹</button>
        <button type="button" aria-label="下一月" :disabled="atMax" @click="navMonth(1)">›</button>
      </div>
    </div>

    <div class="weekdays">
      <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
    </div>

    <div class="cal-grid">
      <div v-for="(d, i) in prevLeadDays" :key="'lead-' + i" class="cal-day day-adj">
        <span class="num">{{ d }}</span>
      </div>
      <div
        v-for="meta in monthDays"
        :key="meta.key"
        class="cal-day"
        :class="cellClass(meta)"
        :data-date="meta.key"
        @click="onSelect(meta)"
      >
        <span class="num">{{ meta.day }}</span>
        <HolidayBadge v-if="meta.holiday" :type="meta.holiday.type" size="xs" class="holi-mark" />
        <span v-if="meta.bars.length" class="bars">
          <i v-for="(s, i) in meta.bars" :key="i" :class="MONITOR_BAR_CLASS[s]" />
        </span>
      </div>
      <div v-for="(d, i) in nextTailDays" :key="'tail-' + i" class="cal-day day-adj">
        <span class="num">{{ d }}</span>
      </div>
    </div>

    <CalendarInfoBar :left="legendLeft" :right="legendRight" :hours="monthTotalHours" />
  </div>
</template>

<style scoped>
/* 月份头：标题 + ‹›箭头（到边界 disabled） */
.cal-head { display: flex; align-items: center; justify-content: space-between; padding: 0 2px 10px; }
.month-title { font-size: 17px; font-weight: 700; color: var(--color-fg); }
.month-title small { font-size: 12px; font-weight: 500; color: var(--color-fg-muted); margin-left: 4px; }
.month-nav { display: flex; gap: 8px; }
.month-nav button {
  width: 32px; height: 32px; border-radius: 9999px; border: 1px solid var(--color-line);
  background: var(--color-surface); color: var(--color-fg-secondary); font-size: 15px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.month-nav button:disabled { opacity: 0.3; }

/* 星期行 */
.weekdays { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.weekdays span { text-align: center; font-size: 10px; color: var(--color-fg-muted); padding: 4px 0; }

/* 网格 */
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px 0; }
.cal-day {
  position: relative; height: 52px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; overflow: hidden;
}
.cal-day:active { filter: brightness(0.96); }

/* 填色（类优先级：today > unavail > book，按此顺序声明） */
.day-book { background: var(--color-success-subtle); }
.day-unavail { background: var(--color-danger-subtle); }
.day-today { background: var(--color-accent); }
.day-past { opacity: 0.35; pointer-events: none; }
/* 相邻月填充格：过去日同款淡化，纯视觉（无 data-date、无领域标记、不可点） */
.day-adj { opacity: 0.35; pointer-events: none; }

/* 日期数字：永远 flex 居中（标记不进排版流） */
.num { font-size: 15px; line-height: 1; font-weight: 500; color: var(--color-fg); }
.day-today .num { color: var(--color-fg-inverse); font-weight: 700; }
.day-unavail .num { color: var(--color-danger); text-decoration: line-through; text-decoration-thickness: 1.5px; }

/* 监控色条：absolute 贴底并排，不影响数字位置 */
.bars { position: absolute; left: 20%; right: 20%; bottom: 7px; display: flex; gap: 2px; height: 4px; border-radius: 2px; overflow: hidden; }
.bars i { flex: 1; border-radius: 2px; }
/* 两态契约 2026-09-23：监控中（watching）=badge-blue 深蓝 / 待放票（pending_release/waiting）=浅蓝；瞬态不生成段。
   单一事实来源：--cal-bar-waiting 定义在 .venue-calendar 根（含 .dark 变体，2026-09-23 用户定「比 accent 明显更浅」），
   格内 .bars i 与子组件 CalendarInfoBar 的 barleg 图例共同引用同名 var */
.venue-calendar { --cal-bar-waiting: oklch(0.78 0.13 225); }
.dark .venue-calendar { --cal-bar-waiting: oklch(0.85 0.10 215); }
.bar-watching { background: var(--color-badge-blue); }
.bar-waiting { background: var(--cal-bar-waiting); }

/* 休/班：数字右上小字（HolidayBadge xs 提供 8px 字形与配色，这里只定位） */
.holi-mark { position: absolute; top: 3px; right: 4px; }
</style>
