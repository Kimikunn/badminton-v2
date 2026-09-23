<script setup>
/**
 * BookingCalendar — 订场月历（Vant 4 Calendar 包装）
 *
 * 骨架（月份区间 / 中文星期 / 网格 / 触控滚动）全部交给 Vant Calendar；本组件只做三件事：
 * 1. formatter 把领域状态写进日格子（不可用 → disabled + 红底；今天/过去 → 加类）；
 * 2. 三个插槽渲染标记：#text 日期数字带 data-date（e2e 锚点 + 今天色环钩子），
 *    #top-info 休/班 或 不可用 X（+ 多条监控角标），#bottom-info 监控胶囊或订场圆点；
 * 3. IntersectionObserver 跟踪滚动容器里可见比例最大的月份，驱动下方月摘要。
 *    （Vant 的 monthShow 只对「首次进入视口」的月份触发，回滚不再发，不能用于跟踪当前月。）
 *
 * @props {Array} records - 订场记录（date/startTime/endTime），用于圆点与当月总小时
 * @props {Set<string>} unavailableDateSet - 不可用日期（YYYY-MM-DD）
 * @props {Map<string, {status, count}>} monitorStatusByDate - 每天折叠后的监控徽标
 *
 * @events select-day - 点击今天及以后某天（不可用日同样上抛，由 DaySheet 处理）
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Calendar } from 'vant'
import 'vant/lib/calendar/style/index'
import { X } from 'lucide-vue-next'
import { holidayFor, monthHolidaySummary } from '@/utils/holiday'
import { MONITOR_CELL_LABELS } from '@/stores/intent'
import HolidayBadge from '@/components/venue/HolidayBadge.vue'

const props = defineProps({
  records: { type: Array, default: () => [] },
  unavailableDateSet: { type: Set, default: () => new Set() },
  monitorStatusByDate: { type: Map, default: () => new Map() },
})

const emit = defineEmits(['select-day'])

// 格子版监控配色（语义与 store 的 MONITOR_BADGE_VARIANT 一一对应）
const MONITOR_PILL_CLASS = {
  awaiting_verify: 'bg-warning-subtle text-warning',
  fulfilled: 'bg-success-subtle text-success',
  watching: 'bg-accent-subtle text-accent',
  pending_release: 'bg-badge-blue-bg text-badge-blue',
  waiting: 'bg-badge-blue-bg text-badge-blue',
  paused: 'bg-surface-hover text-fg-muted',
}

const calendarRef = ref(null)
const rootEl = ref(null)

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const today = new Date()
today.setHours(0, 0, 0, 0)
const todayKey = dateKey(today)

// 日历区间：本月 1 号 → 6 个月后的月末。
// 起点取「本月 1 号」而不是 Vant 默认的「今天」：当月已过去的日子要由 .day-past 淡化，
// 不能被 Vant 当越界 disabled（否则和不可用日的红字混淆），测试库里的不可用日也才渲染得出来。
const minDate = new Date(today.getFullYear(), today.getMonth(), 1)
const maxDate = new Date(today.getFullYear(), today.getMonth() + 7, 0)

// 当前可见月（IntersectionObserver 跟踪）；初值 = 今天所在月，与首屏一致
const currentMonth = ref({ year: today.getFullYear(), month: today.getMonth() + 1 })

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

// 日历区间内每天的领域信息：formatter 与插槽共用，避免每个格子重复查表/重复算节假日
const metaByKey = computed(() => {
  const map = new Map()
  const monitorMap = props.monitorStatusByDate
  const cursor = new Date(minDate)
  while (cursor <= maxDate) {
    const key = dateKey(cursor)
    map.set(key, {
      unavailable: props.unavailableDateSet.has(key),
      holiday: holidayFor(key),
      bookings: bookingMap.value.get(key) || [],
      monitor: monitorMap.get(key) || null,
      isToday: key === todayKey,
      isPast: key < todayKey,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return map
})

// Vant 逐日定制：只改 type/className；领域信息挂到 item.meta 上供插槽读取（Vant 原样透传）
function formatter(item) {
  const meta = metaByKey.value.get(dateKey(item.date))
  if (!meta) return item
  if (meta.unavailable) return { ...item, meta, type: 'disabled', className: 'day-unavail' }
  if (meta.isToday) return { ...item, meta, className: 'day-today' }
  if (meta.isPast) return { ...item, meta, className: 'day-past' }
  return { ...item, meta }
}

// 点今天及以后 → select-day（不可用日也上抛，DaySheet 里可取消标记）；过去日忽略。
// Vant 的 select 给 Date，clickDisabledDate 给日对象，这里统一取 date。
function onSelect(payload) {
  const date = payload instanceof Date ? payload : payload?.date
  if (!date) return
  const key = dateKey(date)
  if (key < todayKey) return
  emit('select-day', key)
  // 本日历不是「选择日期」而是「打开某天面板」：清掉 Vant 的选中态，避免留下一个高亮方块
  calendarRef.value?.reset(null)
}

// --- 当前可见月跟踪：监听日历滚动容器里各月份区块的可见比例 ---
let observer = null
const ratios = new Map()

function setupMonthObserver() {
  const body = rootEl.value?.querySelector('.van-calendar__body')
  if (!body || typeof IntersectionObserver === 'undefined') return
  const months = body.querySelectorAll('.van-calendar__month')
  if (!months.length) return

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio)
    let bestEl = null
    let bestRatio = 0
    for (const [el, ratio] of ratios) {
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestEl = el
      }
    }
    const key = bestEl?.querySelector('[data-date]')?.getAttribute('data-date')
    if (key) currentMonth.value = { year: +key.slice(0, 4), month: +key.slice(5, 7) }
  }, { root: body, threshold: Array.from({ length: 21 }, (_, i) => i / 20) })

  for (const month of months) {
    ratios.set(month, 0)
    observer.observe(month)
  }
}

onMounted(() => {
  // 等 Vant 首屏渲染完成后再挂 IO（此时月份区块高度已就位）
  requestAnimationFrame(setupMonthObserver)
})

onBeforeUnmount(() => observer?.disconnect())

const monthTotalHours = computed(() => {
  const prefix = `${currentMonth.value.year}-${String(currentMonth.value.month).padStart(2, '0')}`
  let total = 0
  for (const r of props.records) {
    if (!r.date || !r.date.startsWith(prefix)) continue
    const sh = parseInt((r.startTime || '').split(':')[0], 10)
    const eh = parseInt((r.endTime || '').split(':')[0], 10)
    if (sh >= 0 && eh > sh) total += eh - sh
  }
  return total
})

// 当前可见月的节日摘要（格子只显示 休/班 角标，节日名在这里给一次；点某天看 DaySheet 详情）
const holidaySummary = computed(() => monthHolidaySummary(currentMonth.value.year, currentMonth.value.month))

// 图例只解释两个**日期维度**的标记（订场圆点 / 不可用 X）；监控状态不列进来
// （2026-09-17 用户定：格子上的监控徽标自己会说话，图例里堆状态只是噪音）
</script>

<template>
  <div ref="rootEl" class="venue-calendar flex flex-col gap-3 h-full">
    <Calendar
      ref="calendarRef"
      class="flex-1 min-h-0"
      :poppable="false"
      type="single"
      :show-confirm="false"
      :show-title="false"
      :show-subtitle="false"
      :show-mark="false"
      :default-date="null"
      :allow-same-day="true"
      :first-day-of-week="1"
      :row-height="64"
      :min-date="minDate"
      :max-date="maxDate"
      :lazy-render="false"
      :formatter="formatter"
      @select="onSelect"
      @click-disabled-date="onSelect"
    >
      <!-- 日期数字：data-date 是 e2e 锚点，也是今天色环的样式钩子 -->
      <template #text="item">
        <span class="day-number" :data-date="dateKey(item.date)">{{ item.text }}</span>
      </template>

      <!-- 上排：休/班 徽标；不可用日换成 X；多条监控在右上角标条数 -->
      <template #top-info="item">
        <X v-if="item.meta?.unavailable" :size="12" class="day-x" />
        <template v-else>
          <HolidayBadge v-if="item.meta?.holiday" :type="item.meta.holiday.type" size="xs" class="holiday-mark" />
          <span
            v-if="item.meta?.monitor && item.meta.monitor.count > 1 && !item.meta.isPast"
            class="monitor-count"
          >{{ item.meta.monitor.count }}</span>
        </template>
      </template>

      <!-- 下排：监控胶囊优先；没有（或过去日不显示）监控时退回订场圆点 -->
      <template #bottom-info="item">
        <span
          v-if="item.meta && !item.meta.unavailable && !item.meta.isPast && item.meta.monitor"
          class="monitor-pill"
          :class="MONITOR_PILL_CLASS[item.meta.monitor.status]"
        >{{ MONITOR_CELL_LABELS[item.meta.monitor.status] }}</span>
        <span v-else-if="item.meta && !item.meta.unavailable && item.meta.bookings.length" class="day-dots">
          <span v-for="(b, j) in item.meta.bookings.slice(0, 3)" :key="j" class="day-dot" />
        </span>
      </template>
    </Calendar>

    <!-- Info bar：只列日期维度的标记（订场圆点 / 不可用）+ 当月总时长（与日历网格左缘对齐，字号与摘要一致） -->
    <div v-if="bookingMap.size || unavailableDateSet.size" class="flex items-center justify-between text-2xs text-fg-muted">
      <div class="flex items-center gap-3">
        <span v-if="bookingMap.size" class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-accent" /> 有订场</span>
        <span v-if="unavailableDateSet.size" class="flex items-center gap-1.5"><X :size="10" class="text-danger" /> 不可用</span>
      </div>
      <span v-if="monthTotalHours" class="font-medium text-fg-secondary">{{ monthTotalHours }}h</span>
    </div>

    <!-- 当前可见月节日摘要：格子只显示 休/班 角标，节日名在这里给一次（点某天看 DaySheet 详情） -->
    <div v-if="holidaySummary" class="holiday-summary text-2xs text-fg-muted">{{ currentMonth.month }}月：{{ holidaySummary }}</div>
  </div>
</template>

<style scoped>
/* Vant Calendar 变量映射到项目 token（自定义属性会继承进 .van-calendar 子树） */
.venue-calendar {
  --van-calendar-background: transparent;
  --van-calendar-header-shadow: none;
  --van-text-color: var(--color-fg);
  --van-text-color-2: var(--color-fg-secondary);
  --van-text-color-3: var(--color-fg-muted);
  --van-calendar-day-disabled-color: oklch(0.55 0.22 25 / 0.45);
}

.dark .venue-calendar {
  --van-calendar-day-disabled-color: oklch(0.72 0.16 25 / 0.5);
}

/* 日历高度由外层 .record-view 容器决定（列表/日历同高），这里填满剩余空间即可 */
.venue-calendar :deep(.van-calendar) {
  height: 100%;
}

/* 不可用：红底方块（沿用旧 X 方块语义）；X 在 top-info */
.venue-calendar :deep(.van-calendar__day.day-unavail) {
  background: var(--color-danger-subtle);
  border-radius: 8px;
}

/* 过去日：整格淡化（不走 Vant disabled，否则数字灰会被误读成不可用） */
.venue-calendar :deep(.van-calendar__day.day-past) {
  opacity: 0.45;
}

/* 日期数字：固定圆形盒，保证整月同一基线 */
.day-number {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  border-radius: 9999px;
  line-height: 1;
}

/* 今天：Vant 原生选中态语言——实心 accent 圆 + 反白数字（不再用描边色环） */
.day-today .day-number {
  background: var(--color-accent);
  color: var(--color-fg-inverse);
  font-weight: 600;
}

.day-x {
  display: block;
  margin: 0 auto;
  color: var(--color-danger);
  opacity: 0.7;
}

/* 休/班 徽标：限宽居中（否则作为 flex 项会撑满整宽，盒与右上角监控条数角标重叠报警） */
.holiday-mark {
  width: max-content;
  margin-inline: auto;
}

/* 订场圆点（无监控时）：数字行下方 */
.day-dots {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.day-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--color-accent);
}

/* 监控胶囊：贴底内缩，3 字标签不截断、不越出格子 */
.monitor-pill {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 1px 4px;
  border-radius: 9999px;
  font-size: 9px;
  line-height: 10px;
  font-weight: 500;
}

/* 多条监控角标：右上角 */
.monitor-count {
  position: absolute;
  top: -4px;
  right: 4px;
  min-width: 12px;
  height: 12px;
  padding: 0 3px;
  border-radius: 9999px;
  background: var(--color-fg);
  color: var(--color-fg-inverse);
  font-size: 8px;
  font-weight: 600;
  line-height: 12px;
  text-align: center;
}
</style>
