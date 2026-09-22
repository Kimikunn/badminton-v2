<script setup>
/**
 * BookingCalendar — 月历（月头 + 网格 + 图例/节日摘要）
 *
 * 单日方块的全部状态（今天/不可用/休班角标/订场圆点/监控徽标）在 DayCell.vue；
 * 本组件只负责月份、数据装配（订场记录 / 不可用集合 / 监控聚合）与月度摘要。
 *
 * @props {Array} records - 订场记录（date/startTime/endTime），用于圆点与当月总小时
 * @props {Set<string>} unavailableDateSet - 不可用日期（YYYY-MM-DD）
 * @props {Map<string, {status, count}>} monitorStatusByDate - 每天折叠后的监控徽标
 *
 * @events select-day - 点击今天及以后某天（不可用日同样上抛，由 DaySheet 处理）
 */
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { holidayFor, HOLIDAY_TYPE_MARKS } from '@/utils/holiday'
import DayCell from '@/components/venue/DayCell.vue'

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

// 本月节日摘要：格子只显示 休/班 角标，节日名在这里给一次（点某天看 DaySheet 详情）
// 固定顺序：先全部「休」（按日期），再全部「班」——不随月份变
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
    ...runs.holiday.map(r => `${HOLIDAY_TYPE_MARKS.holiday} ${span(r)} ${r.name}`),
    ...runs.workday.map(r => `${HOLIDAY_TYPE_MARKS.workday} ${span(r)}`),
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

    <!-- Day grid：每个日期一个方块（状态在 DayCell 内） -->
    <div class="grid grid-cols-7 gap-1.5">
      <template v-for="(cell, i) in days" :key="i">
        <DayCell v-if="cell" :cell="cell" @select="emit('select-day', $event)" />
        <div v-else aria-hidden="true"></div>
      </template>
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
