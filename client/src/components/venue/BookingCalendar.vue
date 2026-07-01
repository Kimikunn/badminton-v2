<script setup>
/**
 * BookingCalendar — Month grid showing booking records as dots + unavailable day marks
 */
import { ref, computed } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import Sheet from '@/components/ui/Sheet.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  records: { type: Array, default: () => [] },
  getPlayerName: { type: Function, required: true },
  getPlayerAvatar: { type: Function, default: () => '' },
  unavailableDateSet: { type: Set, default: () => new Set() },
  getUnavailableForDate: { type: Function, default: () => null },
})

const emit = defineEmits(['create-booking', 'mark-unavailable', 'unmark-unavailable'])

const { confirm: confirmAction } = useConfirm()

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const selectedDate = ref(null)

const DAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const todayKey = computed(() => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)

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

const selectedBookings = computed(() => {
  if (!selectedDate.value) return []
  return bookingMap.value.get(selectedDate.value) || []
})

const selectedUnavailable = computed(() => {
  if (!selectedDate.value) return null
  return props.getUnavailableForDate(selectedDate.value)
})

const isSelectedPast = computed(() => selectedDate.value && selectedDate.value < todayKey.value)

async function handleMarkUnavailable(date) {
  if (selectedBookings.value.length) {
    const ok = await confirmAction({
      title: '标记不可用',
      message: `当天有 ${selectedBookings.value.length} 条订场记录，标记不可用将同时删除，确认？`,
      confirmText: '确认标记',
      variant: 'danger',
    })
    if (!ok) return
  }
  emit('mark-unavailable', date)
  selectedDate.value = null
}

function handleUnmark() {
  if (selectedUnavailable.value) {
    emit('unmark-unavailable', selectedUnavailable.value.id)
    selectedDate.value = null
  }
}
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
          <!-- Unavailable overlay: X mark -->
          <div v-if="cell.isUnavailable" class="day-unavail" :class="{ 'cursor-pointer active:scale-95': !cell.isPast }" @click="!cell.isPast && (selectedDate = cell.key)">
            <X :size="16" class="x-mark" />
            <span class="day-num muted">{{ cell.day }}</span>
          </div>

          <!-- Normal day -->
          <div
            v-else
            class="day-normal"
            :class="{
              'text-accent font-semibold': cell.bookings.length,
              'past-cell': cell.isPast && !cell.bookings.length,
              'past-dots': cell.isPast && cell.bookings.length,
              'future-cell': !cell.bookings.length && !cell.isPast,
              'ring-2 ring-accent': cell.isToday,
              'hover:bg-surface-hover': !cell.isPast,
            }"
            @click="!cell.isPast && (selectedDate = cell.key)"
          >
            <span class="leading-none">{{ cell.day }}</span>
            <span v-if="cell.bookings.length" class="flex gap-0.5 mt-0.5">
              <span
                v-for="(b, j) in cell.bookings.slice(0, 3)"
                :key="j"
                class="w-1.5 h-1.5 rounded-full shrink-0 bg-accent"
              />
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- Info bar -->
    <div v-if="bookingMap.size || unavailableDateSet.size" class="flex items-center justify-between text-xs text-fg-muted px-1">
      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-accent" /> 有订场</span>
        <span class="flex items-center gap-1.5"><X :size="10" class="text-danger" /> 不可用</span>
      </div>
      <span v-if="monthTotalHours" class="font-medium text-fg-secondary">{{ monthTotalHours }}h</span>
    </div>

    <!-- Day detail sheet -->
    <Sheet :show="!!selectedDate && !isSelectedPast" :title="selectedDate || ''" @close="selectedDate = null">
      <div class="flex flex-col gap-2">
        <!-- Unavailable state -->
        <div v-if="selectedUnavailable" class="text-center py-4 text-sm">
          <X :size="28" class="text-danger mx-auto mb-2" />
          <p class="text-fg-secondary">已标记为不可用</p>
          <button
            class="mt-3 w-full py-2.5 rounded-lg bg-surface-hover text-fg-secondary text-sm font-medium active:opacity-80 transition-opacity"
            @click="handleUnmark"
          >取消标记</button>
        </div>

        <template v-else>
          <!-- Bookings -->
          <div v-if="selectedBookings.length" class="flex flex-col">
            <div
              v-for="r in selectedBookings"
              :key="r.id"
              class="flex items-center gap-3 py-2.5 border-b border-line-light last:border-b-0"
            >
              <Avatar :name="getPlayerName(r.playerId)" :src="getPlayerAvatar(r.playerId)" size="sm" />
              <div class="flex-1 min-w-0">
                <span class="block text-sm font-medium text-fg">{{ getPlayerName(r.playerId) }}</span>
                <span class="block text-xs text-fg-muted">{{ r.venueName || '—' }} · {{ r.startTime }}-{{ r.endTime }}</span>
              </div>
              <span class="text-sm font-semibold text-accent shrink-0">¥{{ r.cost }}</span>
            </div>
          </div>
          <div v-else class="text-center py-6 text-fg-muted text-sm">暂无订场</div>

          <!-- Actions -->
          <button
            v-if="selectedDate >= todayKey"
            class="mt-1 w-full py-2.5 rounded-lg bg-accent text-white text-sm font-semibold active:opacity-80 transition-opacity"
            @click="emit('create-booking', selectedDate); selectedDate = null"
          >新增订场</button>
          <button
            v-if="selectedDate >= todayKey"
            class="w-full py-2.5 rounded-lg border border-danger text-danger text-sm font-medium active:opacity-80 transition-opacity"
            @click="handleMarkUnavailable(selectedDate)"
          >标记不可用</button>
        </template>
      </div>
    </Sheet>
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
</style>
