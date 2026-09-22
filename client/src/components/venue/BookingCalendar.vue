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
import { MONITOR_CELL_LABELS } from '@/stores/intent'
import { holidayFor } from '@/utils/holiday'
import HolidayBadge from '@/components/venue/HolidayBadge.vue'

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
      holiday: holidayFor(key),
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

/* 本月节日摘要：格子只显示 休/班 角标，节日名在这里给一次（点某天看 DaySheet 详情）
   固定顺序：先全部「休」（按日期），再全部「班」——不随月份变 */
const holidaySummary = computed(() => {
  const runs = { holiday: [], workday: [] }
  for (const cell of days.value) {
    if (!cell || !cell.holiday) continue
    const { type, name } = cell.holiday
    const last = runs[type][runs[type].length - 1]
    const sameBlock = last && last.end === cell.day - 1 && (type !== 'holiday' || last.name === name)
    if (sameBlock) last.end = cell.day
    else runs[type].push({ start: cell.day, end: cell.day, name })
  }
  const span = r => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)
  return [
    ...runs.holiday.map(r => `休 ${span(r)} ${r.name}`),
    ...runs.workday.map(r => `班 ${span(r)}`),
  ].join(' · ')
})

// 图例只解释两个**日期维度**的标记（订场圆点 / 不可用 X）；监控状态不列进来
// （2026-09-17 用户定：格子上的监控徽标自己会说话，图例里堆状态只是噪音）
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
        :data-date="cell?.key"
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
            <!-- 休/班 角标：固定左上角（参考苹果日历：格子不放节日名，名字见月摘要与 DaySheet；过去日随格子变淡） -->
            <HolidayBadge
              v-if="cell.holiday"
              :type="cell.holiday.type"
              size="xs"
              class="holiday-mark"
              :class="{ 'opacity-50': cell.isPast }"
            />
            <!-- 日期数字：固定居中，位置与角标/圆点/徽标无关 → 整月所有格子同一基线 -->
            <span class="day-num-fixed leading-none">{{ cell.day }}</span>
            <!-- 订场圆点：数字下方固定位置；有监控徽标时让位（徽标信息优先级更高） -->
            <span v-if="cell.bookings.length && !(cell.monitor && !cell.isPast)" class="day-dots">
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

    <!-- Info bar：只列日期维度的标记（订场圆点 / 不可用）+ 当月总时长 -->
    <div v-if="bookingMap.size || unavailableDateSet.size" class="flex items-center justify-between text-xs text-fg-muted px-1">
      <div class="flex items-center gap-3">
        <span v-if="bookingMap.size" class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-accent" /> 有订场</span>
        <span v-if="unavailableDateSet.size" class="flex items-center gap-1.5"><X :size="10" class="text-danger" /> 不可用</span>
      </div>
      <span v-if="monthTotalHours" class="font-medium text-fg-secondary">{{ monthTotalHours }}h</span>
    </div>

    <!-- 本月节日摘要：格子只显示 休/班 角标，节日名在这里给一次（点某天看 DaySheet 详情） -->
    <div v-if="holidaySummary" class="holiday-summary text-2xs text-fg-muted px-1">{{ month }}月：{{ holidaySummary }}</div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

.day-cell {
  @apply aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-colors;
}

.day-normal {
  @apply w-full h-full rounded-lg;
}

/* 日期数字：固定居中（绝对定位），不随角标/圆点/徽标移动 → 整月同一基线 */
.day-num-fixed {
  @apply absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2;
}

/* 订场圆点：数字行盒下方固定 2px */
.day-dots {
  @apply absolute left-1/2 -translate-x-1/2 flex gap-0.5;
  top: calc(50% + 9px);
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

/* 休/班 角标：只负责定位；字形/配色由 HolidayBadge 组件统一 */
.holiday-mark {
  @apply absolute top-0 left-0 px-[1px];
}

/* 监控徽标：固定贴格子底部居中，不挤动数字与圆点 */
.monitor-pill {
  @apply absolute bottom-0 left-1/2 -translate-x-1/2 max-w-full truncate rounded-full px-[3px] text-[9px] font-medium leading-[11px];
}
/* 条数角标：多条才显示，右上角；限高 11px 避免与居中的两位数字行盒相碰 */
.monitor-count {
  @apply absolute top-0 right-0 min-w-[11px] h-[11px] px-[3px] rounded-full bg-fg text-fg-inverse text-[8px] font-semibold leading-[11px] flex items-center justify-center;
}
</style>
