<script setup>
/**
 * BookingCalendar — 月历格子：订场圆点 + 不可用 X 覆盖 + 监控徽标（纯展示）
 *
 * 一天两个正交维度（design §4.0）：monitorStatusByDate = 监控状态聚合（维度一），
 * unavailableDateSet = 日期标记（维度二）。不可用日走 X 分支，与徽标二选一，不叠加。
 *
 * @props {Array} records - 订场记录（date/startTime/endTime），用于圆点与当月总小时
 * @props {Set<string>} unavailableDateSet - 不可用日期（YYYY-MM-DD）
 * @props {Map<string, {status, count}>} monitorStatusByDate - 每天折叠后的监控徽标
 *
 * @events select-day - 点击今天及以后某天（不可用日同样上抛，由 DaySheet 处理）
 */
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { MONITOR_CELL_LABELS, BADGE_PRIORITY } from '@/stores/intent'

const props = defineProps({
  records: { type: Array, default: () => [] },
  unavailableDateSet: { type: Set, default: () => new Set() },
  monitorStatusByDate: { type: Map, default: () => new Map() },
})

const emit = defineEmits(['select-day'])

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)

const DAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

// 徽标配色，与 Badge 的 variant 一一对应（配色约定见 design §4.4）
const MONITOR_PILL_CLASS = {
  awaiting_verify: 'bg-warning-subtle text-warning',
  fulfilled: 'bg-success-subtle text-success',
  watching: 'bg-accent-subtle text-accent',
  pending_release: 'bg-badge-blue-bg text-badge-blue',
  waiting: 'bg-badge-blue-bg text-badge-blue',
  paused: 'bg-surface-hover text-fg-muted',
}

const todayKey = computed(() => dateKey(today))

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

const days = computed(() => {
  const firstDay = new Date(year.value, month.value - 1, 1)
  const lastDay = new Date(year.value, month.value, 0)
  const totalDays = lastDay.getDate()
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1

  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)

  for (let d = 1; d <= totalDays; d++) {
    const key = `${year.value}-${String(month.value).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({
      day: d,
      key,
      bookings: bookingMap.value.get(key) || [],
      isToday: key === todayKey.value,
      isPast: key < todayKey.value,
      isUnavailable: props.unavailableDateSet.has(key),
      monitor: props.monitorStatusByDate.get(key) || null,
    })
  }
  return cells
})

function prevMonth() {
  if (month.value === 1) { year.value--; month.value = 12 }
  else month.value--
}

function nextMonth() {
  if (month.value === 12) { year.value++; month.value = 1 }
  else month.value++
}

function goToday() {
  year.value = today.getFullYear()
  month.value = today.getMonth() + 1
}

const monthTotalHours = computed(() => {
  const prefix = `${year.value}-${String(month.value).padStart(2, '0')}`
  let total = 0
  for (const r of props.records) {
    if (!r.date || !r.date.startsWith(prefix)) continue
    const sh = parseInt((r.startTime || '').split(':')[0], 10)
    const eh = parseInt((r.endTime || '').split(':')[0], 10)
    if (sh >= 0 && eh > sh) total += eh - sh
  }
  return total
})

// 图例：只列出“当月真正出现”的监控状态（按聚合优先级排序，与格子折叠规则同源），
// 不堆静态长列表；过去日不渲染徽标 → 不计入，保证图例与格子实际所见一致
const monthMonitorStates = computed(() => {
  const present = new Set(days.value.filter(c => c && !c.isPast && c.monitor).map(c => c.monitor.status))
  return BADGE_PRIORITY.filter(s => present.has(s))
})

const legendVisible = computed(() =>
  bookingMap.value.size > 0 || props.unavailableDateSet.size > 0 || monthMonitorStates.value.length > 0
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Month header -->
    <div class="flex items-center justify-between px-1">
      <button class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-fg-secondary active:scale-90 transition-transform" @click="prevMonth">
        <ChevronLeft :size="18" />
      </button>
      <button class="text-base font-semibold text-fg px-3 py-1 rounded-lg active:bg-surface-hover" @click="goToday">
        {{ year }}年{{ MONTH_NAMES[month - 1] }}
      </button>
      <button class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-fg-secondary active:scale-90 transition-transform" @click="nextMonth">
        <ChevronRight :size="18" />
      </button>
    </div>

    <!-- Day-of-week headers -->
    <div class="grid grid-cols-7 text-center">
      <span v-for="d in DAY_HEADERS" :key="d" class="text-xs font-medium text-fg-muted py-1">{{ d }}</span>
    </div>

    <!-- Day grid -->
    <div class="grid grid-cols-7 gap-1">
      <div
        v-for="(cell, i) in days"
        :key="i"
        class="day-cell"
        :class="cell ? {
          'cursor-pointer active:scale-95': !cell.isPast && !cell.isUnavailable,
          'cursor-default': cell.isUnavailable,
        } : ''"
      >
        <template v-if="cell">
          <!-- 维度二：不可用日 X 覆盖（与监控徽标二选一，不叠加） -->
          <div v-if="cell.isUnavailable" class="day-unavail" :class="{ 'cursor-pointer active:scale-95': !cell.isPast }" @click="!cell.isPast && emit('select-day', cell.key)">
            <X :size="16" class="x-mark" />
            <span class="day-num muted">{{ cell.day }}</span>
          </div>

          <!-- Normal day -->
          <div
            v-else
            class="day-normal relative"
            :class="{
              'text-accent font-semibold': cell.bookings.length,
              'past-cell': cell.isPast && !cell.bookings.length,
              'past-dots': cell.isPast && cell.bookings.length,
              'future-cell': !cell.bookings.length && !cell.isPast,
              'ring-2 ring-accent': cell.isToday,
              'hover:bg-surface-hover': !cell.isPast,
            }"
            @click="!cell.isPast && emit('select-day', cell.key)"
          >
            <!-- 维度一：当天监控条数（>1 才显示）；过去日不渲染 -->
            <span v-if="!cell.isPast && cell.monitor && cell.monitor.count > 1" class="monitor-count">{{ cell.monitor.count }}</span>
            <span class="leading-none">{{ cell.day }}</span>
            <span v-if="cell.bookings.length" class="flex gap-0.5 mt-0.5">
              <span
                v-for="(b, j) in cell.bookings.slice(0, 3)"
                :key="j"
                class="w-1.5 h-1.5 rounded-full shrink-0 bg-accent"
              />
            </span>
            <!-- 维度一：当天监控聚合徽标（优先级折叠后的状态）；过去日不渲染 -->
            <span
              v-if="!cell.isPast && cell.monitor"
              class="monitor-pill"
              :class="MONITOR_PILL_CLASS[cell.monitor.status]"
            >{{ MONITOR_CELL_LABELS[cell.monitor.status] }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- Info bar / 图例：订场圆点、不可用 X、监控徽标（只列当月出现的状态）+ 当月总时长 -->
    <div v-if="legendVisible" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted px-1">
      <span v-if="bookingMap.size" class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-accent" /> 有订场</span>
      <span v-if="unavailableDateSet.size" class="flex items-center gap-1.5"><X :size="10" class="text-danger" /> 不可用</span>
      <span v-for="s in monthMonitorStates" :key="s" class="flex items-center gap-1.5">
        <span class="monitor-pill legend-pill" :class="MONITOR_PILL_CLASS[s]">{{ MONITOR_CELL_LABELS[s] }}</span>
      </span>
      <span v-if="monthTotalHours" class="ml-auto font-medium text-fg-secondary">{{ monthTotalHours }}h</span>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

.day-cell {
  @apply aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-colors;
}

.day-normal {
  @apply w-full h-full rounded-lg flex flex-col items-center justify-center;
}

.past-cell {
  color: oklch(0.55 0.01 220 / 0.25);
}
.future-cell {
  color: oklch(0.55 0.01 220 / 0.65);
}

/* Unavailable day */
.day-unavail {
  @apply w-full h-full rounded-lg flex flex-col items-center justify-center relative;
  background: var(--color-danger-subtle);
  border: 1px solid oklch(0.55 0.22 25 / 0.2);
}
.x-mark {
  @apply absolute;
  color: var(--color-danger);
  opacity: 0.6;
}
.day-num.muted {
  @apply text-sm;
  color: oklch(0.55 0.22 25 / 0.4);
}

/* 图例里的徽标：跟格子同一套配色，但字号提到 11px 保证可读（格子只有 40px 上下） */
.legend-pill {
  @apply mt-0 px-1.5 text-[11px] leading-4;
}

/* 监控徽标：格子只有 40px 上下，用 9px 字 + 紧凑内边距；超长时省略而不是撑破格子 */
.monitor-pill {
  @apply mt-0.5 max-w-full truncate rounded-full px-[3px] text-[9px] font-medium leading-[13px];
}
/* 条数角标：多条才显示，放在格子右上角，不跟状态文字抢宽度 */
.monitor-count {
  @apply absolute top-0 right-0 min-w-3 h-3 px-[3px] rounded-full bg-fg text-fg-inverse text-[8px] font-semibold leading-3 flex items-center justify-center;
}
</style>
