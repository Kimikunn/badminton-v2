<script setup>
/**
 * VenueWatchPanel — 订场提醒面板（状态总开关 + 日期卡片/时段点选 + 目标列表 + 推送历史）
 * 嵌入 VenueView 订场页使用；不可用日期由父组件传入（与订场日历共用一份数据）
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useVenueWatchStore } from '@/stores'
import { assembleTargetPayload } from '@/stores/venueWatch'
import { api } from '@/api/client'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Pencil, Trash2, Radar } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  unavailableDateSet: { type: Set, default: () => new Set() }
})

const store = useVenueWatchStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

onMounted(() => { store.init() })

// === 状态与总开关 ===
const savingConfig = ref(false)

// 就绪 = 推送配置 + 小程序登录态均已配置（凭证在服务器 .env）
const isReady = computed(() => !!(store.config?.pushConfigured && store.config?.gymTokenConfigured))

function showReadyHint() {
  if (!isReady.value) toast.show('请在服务器 .env 配置凭证（PUSH_TOKEN / GYM_TOKEN_USER），修改后需重启服务生效', 'error')
}

async function toggleEnabled() {
  if (savingConfig.value) return
  savingConfig.value = true
  try {
    await store.saveConfig({ enabled: !store.config?.enabled })
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
  savingConfig.value = false
}

// === 星期工具 ===
const WEEKDAYS = [
  { value: 0, label: '日' }, { value: 1, label: '一' }, { value: 2, label: '二' },
  { value: 3, label: '三' }, { value: 4, label: '四' }, { value: 5, label: '五' },
  { value: 6, label: '六' }
]

function isWeekly(t) {
  return Array.isArray(t.weekdays) && t.weekdays.length > 0
}

function weekdaysLabel(weekdays) {
  const key = [...weekdays].sort((a, b) => a - b).join(',')
  if (key === '0,1,2,3,4,5,6') return '每天'
  if (key === '1,2,3,4,5') return '工作日'
  if (key === '0,6') return '每周末'
  const sorted = [...weekdays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
  return '每周' + sorted.map(d => WEEKDAYS[d]?.label ?? d).join('、')
}

function targetModeLabel(t) {
  if (isWeekly(t)) return weekdaysLabel(t.weekdays)
  if (!t.date) return '—'
  const d = new Date(t.date + 'T12:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAYS[d.getDay()]?.label ?? ''}`
}

function targetAreaLabel() {
  // 目标场地恒为任意场地
  return '任意场地'
}

// 单日目标落在不可用日期且开了排除（缺省视为开） → 当天轮询会跳过
function isSkippedSingleDay(t) {
  return !isWeekly(t) && t.excludeUnavailable !== false && !!t.date && props.unavailableDateSet.has(t.date)
}

// === 目标表单（日期卡片 + 时段点选） ===
const showTargetSheet = ref(false)
const editingTarget = ref(null)
const targetForm = ref({ date: '', repeat: 'once', customWeekdays: [], excludeUnavailable: true })
const savingTarget = ref(false)

// 重复规律预设（仅此一天 / 每天 / 工作日 / 每周末 / 自定义）
const REPEAT_OPTIONS = [
  { key: 'once', label: '仅此一天' },
  { key: 'daily', label: '每天' },
  { key: 'workday', label: '工作日' },
  { key: 'weekend', label: '每周末' },
  { key: 'custom', label: '自定义' }
]

// 自定义星期 chip 按周一到周日排列（WEEKDAYS 按下标=星期值索引，勿重排）
const CUSTOM_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map(v => WEEKDAYS[v])

const REPEAT_TO_WEEKDAYS = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  workday: [1, 2, 3, 4, 5],
  weekend: [0, 6]
}

function weekdaysToRepeat(weekdays) {
  const key = [...weekdays].sort((a, b) => a - b).join(',')
  if (key === '0,1,2,3,4,5,6') return 'daily'
  if (key === '1,2,3,4,5') return 'workday'
  if (key === '0,6') return 'weekend'
  return 'custom'
}

function toggleCustomWeekday(v) {
  const set = new Set(targetForm.value.customWeekdays)
  if (set.has(v)) set.delete(v)
  else set.add(v)
  targetForm.value.customWeekdays = [...set].sort((a, b) => a - b)
}

// 当日可订数据（聚合为时段列表）
const availabilityAreas = ref([])
const availabilityError = ref('')
const loadingAvailability = ref(false)
const selectedKeys = ref(new Set()) // `${startTime}|${endTime}`

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr() {
  return dateToStr(new Date())
}

// 场馆只放今天起 4 天的票：日期选择即 4 张卡片
const dateCards = computed(() => {
  const cards = []
  for (let i = 0; i < 4; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const date = dateToStr(d)
    cards.push({
      date,
      dayLabel: `周${WEEKDAYS[d.getDay()].label}`,
      dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      isToday: i === 0,
      isUnavailable: props.unavailableDateSet.has(date)
    })
  }
  return cards
})

function selectDate(date) {
  if (targetForm.value.date === date) return
  targetForm.value.date = date
}

function isBookable(item) {
  return !!item && item.status === 'NORMAL' && item.showStatus === 'AVAILABLE'
}

// 时段列表：跨场地按 startTime-endTime 去重聚合，统计可订场地数
const allSlots = computed(() => {
  const map = new Map()
  for (const area of availabilityAreas.value) {
    for (const item of area.items || []) {
      if (!item.startTime || !item.endTime) continue
      const key = `${item.startTime}|${item.endTime}`
      if (!map.has(key)) map.set(key, { key, startTime: item.startTime, endTime: item.endTime, count: 0 })
      if (isBookable(item)) map.get(key).count++
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
})

// 12h 锁定规则：选中"今天"卡片时，距开场不足 12 小时且当前无可订场地（count=0）的行真锁死（不可退、状态不会再变），隐藏；
// 12h 内但仍可订的行保留可选（可能可订到开打前，或支付超时释放）；非今天的卡片不过滤（服务端对每次具体场次执行 12 小时规则）
const timeSlots = computed(() => {
  if (targetForm.value.date !== todayStr()) return allSlots.value
  const lockBefore = Date.now() + 12 * 3600 * 1000
  return allSlots.value.filter(s => {
    if (s.count > 0) return true
    return new Date(`${targetForm.value.date}T${s.startTime}:00`).getTime() >= lockBefore
  })
})

function isSlotSelected(slot) {
  return selectedKeys.value.has(slot.key)
}

function toggleSlot(slot) {
  // 已满（count=0）的场次同样需要监控：开场前 12 小时可退订，退订后即变为可订
  const next = new Set(selectedKeys.value)
  if (next.has(slot.key)) next.delete(slot.key)
  else next.add(slot.key)
  selectedKeys.value = next
}

function slotRowClass(slot) {
  if (isSlotSelected(slot)) return 'bg-accent-subtle text-accent font-medium cursor-pointer'
  return 'text-fg cursor-pointer active:bg-surface-hover'
}

// 已选摘要 + 保存参数（场地恒为任意场地，areaIds 恒为 []）
function computeSelection() {
  const starts = [], ends = []
  for (const key of selectedKeys.value) {
    const [s, e] = key.split('|')
    starts.push(s)
    ends.push(e)
  }
  starts.sort()
  ends.sort()
  return { startTime: starts[0], endTime: ends[ends.length - 1], areaIds: [] }
}

const selectionSummary = computed(() => {
  if (!selectedKeys.value.size) return ''
  const sel = computeSelection()
  return `${selectedKeys.value.size} 个时段 · ${sel.startTime}-${sel.endTime}`
})

async function fetchAvailability(date) {
  availabilityAreas.value = []
  availabilityError.value = ''
  selectedKeys.value = new Set()
  if (!date) return
  loadingAvailability.value = true
  try {
    const res = await api.get('/venue-watch/availability', { date })
    if (res.success) {
      availabilityAreas.value = res.data?.areas || []
    } else {
      availabilityError.value = typeof res.error === 'string' ? res.error : (res.error?.message || '查询可订状态失败')
    }
  } catch (e) {
    availabilityError.value = e.message || '查询可订状态失败，请稍后再试'
  }
  loadingAvailability.value = false
}

watch(() => targetForm.value.date, (date) => {
  if (showTargetSheet.value && date) fetchAvailability(date)
})

// 卡片禁选：仅单日模式下"不可用日期 + 开排除"才禁选；
// 重复规律（每天/工作日/每周末/自定义）下卡片只是拉时段列表的参照日期，仍可点选
function isUnavailableLocked(date) {
  return props.unavailableDateSet.has(date) && targetForm.value.excludeUnavailable && targetForm.value.repeat === 'once'
}

// 单日模式下当前选中卡片变为禁选时，自动取消选中并清空时段列表
watch([() => targetForm.value.excludeUnavailable, () => targetForm.value.repeat], () => {
  if (!showTargetSheet.value) return
  if (targetForm.value.date && isUnavailableLocked(targetForm.value.date)) {
    targetForm.value.date = ''
    availabilityAreas.value = []
    availabilityError.value = ''
    selectedKeys.value = new Set()
  }
})

function openAddTarget() {
  editingTarget.value = null
  targetForm.value = { date: todayStr(), repeat: 'once', customWeekdays: [], excludeUnavailable: true }
  selectedKeys.value = new Set()
  showTargetSheet.value = true
  fetchAvailability(targetForm.value.date)
}

// 编辑每周目标：卡片选中该 weekday 在 4 天窗口内的最近一次发生日（找不到则用今天）
function nearestCardDate(weekday) {
  const card = dateCards.value.find(c => new Date(c.date + 'T12:00:00').getDay() === weekday)
  return card?.date || todayStr()
}

// 编辑：按目标时段窗预选时段（含已满时段，退订后即变为可订）
function preselectFromTarget(t) {
  const keys = new Set()
  for (const slot of timeSlots.value) {
    if (slot.startTime >= t.startTime && slot.startTime < t.endTime) keys.add(slot.key)
  }
  selectedKeys.value = keys
}

async function openEditTarget(t) {
  editingTarget.value = t
  const weekly = isWeekly(t)
  const inWindow = dateCards.value.some(c => c.date === t.date)
  const repeat = weekly ? weekdaysToRepeat(t.weekdays) : 'once'
  const excludeUnavailable = t.excludeUnavailable !== false
  let date = weekly ? nearestCardDate(t.weekdays[0]) : (inWindow ? t.date : todayStr())
  // 单日模式开排除时不可用日期不可选，参照日期回退到今天；重复模式下卡片仅作参照，无需回退
  if (!weekly && excludeUnavailable && props.unavailableDateSet.has(date)) date = todayStr()
  targetForm.value = {
    date,
    repeat,
    customWeekdays: repeat === 'custom' ? [...t.weekdays] : [],
    excludeUnavailable
  }
  selectedKeys.value = new Set()
  showTargetSheet.value = true
  await fetchAvailability(targetForm.value.date)
  preselectFromTarget(t)
}

async function saveTarget() {
  if (loadingAvailability.value) return
  if (availabilityError.value) { toast.show('可订状态查询失败，无法保存', 'error'); return }
  if (!targetForm.value.date) { toast.show('请选择日期', 'error'); return }
  if (!availabilityAreas.value.length) { toast.show('请先选择日期查询场次', 'error'); return }
  if (targetForm.value.repeat === 'custom' && !targetForm.value.customWeekdays.length) { toast.show('请选择重复的星期', 'error'); return }
  if (!selectedKeys.value.size) { toast.show('请点选要监控的时段', 'error'); return }

  const repeat = targetForm.value.repeat
  const sel = computeSelection()
  const input = {
    mode: repeat === 'once' ? 'date' : 'weekly',
    date: targetForm.value.date,
    weekdays: repeat === 'once' ? [] : [...(REPEAT_TO_WEEKDAYS[repeat] || targetForm.value.customWeekdays)],
    startTime: sel.startTime,
    endTime: sel.endTime,
    areaIds: sel.areaIds
  }
  const excludeUnavailable = targetForm.value.excludeUnavailable
  savingTarget.value = true
  try {
    if (editingTarget.value) {
      await store.updateTarget(editingTarget.value.id, { ...assembleTargetPayload(input), excludeUnavailable })
    } else {
      await store.createTarget({ ...input, excludeUnavailable })
    }
    toast.show('已保存', 'success')
    showTargetSheet.value = false
  } catch (e) { toast.show(e.message || '保存失败', 'error') }
  savingTarget.value = false
}

async function toggleTarget(t) {
  if (t.expired) return
  try {
    await store.updateTarget(t.id, { enabled: !t.enabled })
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
}

async function deleteTarget(t) {
  const ok = await confirmAction({
    title: '删除监控目标',
    message: `确认删除「${targetModeLabel(t)} ${t.startTime}-${t.endTime}」的监控目标？`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await store.deleteTarget(t.id)
    toast.show('已删除', 'success')
  } catch (e) { toast.show(e.message || '删除失败', 'error') }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card padding="md">
      <!-- 头部：标题 + 就绪指示灯 + 总开关 -->
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">订场提醒</h3>
        <button class="flex items-center gap-1.5 active:opacity-70" @click="showReadyHint">
          <span class="w-2 h-2 rounded-full" :class="isReady ? 'bg-success' : 'bg-line'"></span>
          <span class="text-2xs" :class="isReady ? 'text-success' : 'text-fg-muted'">{{ isReady ? '已就绪' : '未配置' }}</span>
        </button>
        <button
          class="switch ml-auto"
          :class="{ on: store.config?.enabled }"
          role="switch"
          :aria-checked="!!store.config?.enabled"
          :disabled="savingConfig || !store.config"
          title="总开关"
          @click="toggleEnabled"
        ><span class="switch-dot"></span></button>
      </div>

      <!-- 总开关关闭时目标与历史淡态（逐项开关仍可操作） -->
      <div :class="{ 'opacity-60': store.config && !store.config.enabled }">
      <!-- 监控目标 -->
      <div class="flex items-center justify-between mb-1.5">
        <h4 class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">监控目标</h4>
        <Button variant="ghost" size="sm" @click="openAddTarget">+ 新增</Button>
      </div>
      <EmptyState v-if="!store.targets.length" title="暂无监控目标" description="点选要盯的日期与时段">
        <template #icon><Radar :size="40" class="text-fg-muted" /></template>
      </EmptyState>
      <div v-else class="flex flex-col">
        <div
          v-for="t in store.targets" :key="t.id"
          class="flex items-center gap-2 py-1.5 border-b border-line-light last:border-b-0"
          :class="{ 'opacity-50': t.expired }"
        >
          <div class="flex-1 min-w-0 cursor-pointer active:opacity-70" @click="openEditTarget(t)">
            <div class="flex items-center gap-1.5 flex-wrap">
              <Badge size="sm" :variant="t.expired ? 'muted' : 'accent'">{{ targetModeLabel(t) }}</Badge>
              <Badge v-if="t.expired" size="sm" variant="danger">已过期</Badge>
              <span class="text-2xs text-fg-secondary">{{ t.startTime }}-{{ t.endTime }}</span>
              <span v-if="isWeekly(t) && t.excludeUnavailable" class="text-2xs text-fg-muted">排除不可用日</span>
            </div>
            <span class="block text-2xs text-fg-muted truncate mt-0.5">{{ targetAreaLabel() }}</span>
            <span v-if="isSkippedSingleDay(t)" class="block text-2xs text-fg-muted mt-0.5">该日不可用，已跳过</span>
          </div>
          <button
            class="switch shrink-0"
            :class="{ on: t.enabled }"
            role="switch"
            :aria-checked="!!t.enabled"
            :disabled="t.expired"
            title="启用"
            @click.stop="toggleTarget(t)"
          ><span class="switch-dot"></span></button>
          <button class="icon-btn" @click.stop="openEditTarget(t)" title="编辑">
            <Pencil :size="14" />
          </button>
          <button class="icon-btn !text-danger" @click.stop="deleteTarget(t)" title="删除">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      </div>
    </Card>

    <!-- 目标表单（日期卡片 + 时段点选） -->
    <Sheet :show="showTargetSheet" :title="editingTarget ? '编辑监控目标' : '新增监控目标'" @close="showTargetSheet=false">
      <div class="flex flex-col gap-4">
        <!-- 排除不可用日期开关（决定日期卡片可选性） -->
        <div class="flex items-center justify-between">
          <span class="text-sm text-fg">排除不可用日期</span>
          <button
            class="switch"
            :class="{ on: targetForm.excludeUnavailable }"
            role="switch"
            :aria-checked="targetForm.excludeUnavailable"
            title="排除不可用日期"
            @click="targetForm.excludeUnavailable = !targetForm.excludeUnavailable"
          ><span class="switch-dot"></span></button>
        </div>

        <!-- 日期卡片（今天起 4 天；开排除时不可用日期红色标识并禁选） -->
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="c in dateCards" :key="c.date"
            class="flex flex-col items-center gap-0.5 py-2 rounded-lg border transition-all duration-fast"
            :class="[
              targetForm.date === c.date
                ? 'border-accent bg-accent-subtle'
                : (isUnavailableLocked(c.date) ? 'border-danger bg-danger-subtle' : 'border-line bg-canvas'),
              isUnavailableLocked(c.date)
                ? 'cursor-not-allowed'
                : 'active:scale-95'
            ]"
            :disabled="isUnavailableLocked(c.date)"
            @click="selectDate(c.date)"
          >
            <span
              class="text-sm font-medium"
              :class="targetForm.date === c.date ? 'text-accent' : (isUnavailableLocked(c.date) ? 'text-danger' : 'text-fg')"
            >{{ c.dayLabel }}</span>
            <span
              class="text-2xs"
              :class="targetForm.date === c.date ? 'text-accent' : (isUnavailableLocked(c.date) ? 'text-danger' : 'text-fg-muted')"
            >{{ c.dateLabel }}</span>
            <span class="h-[18px] flex items-center">
              <Badge v-if="isUnavailableLocked(c.date)" size="sm" variant="danger">不可用</Badge>
              <Badge v-else-if="c.isToday" size="sm" :variant="targetForm.date === c.date ? 'accent' : 'muted'">今天</Badge>
            </span>
          </button>
        </div>

        <!-- 时段列表 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">点选时段</label>
          <div v-if="loadingAvailability" class="py-6 text-center text-xs text-fg-muted">正在查询可订场次…</div>
          <div v-else-if="availabilityError" class="flex flex-col items-center gap-2 py-4">
            <span class="text-xs text-danger">{{ availabilityError }}</span>
            <Button variant="ghost" size="sm" @click="fetchAvailability(targetForm.date)">重试</Button>
          </div>
          <div v-else-if="timeSlots.length" class="flex flex-col rounded-lg border border-line-light overflow-hidden">
            <button
              v-for="slot in timeSlots" :key="slot.key"
              class="flex items-center justify-between px-3 py-2.5 border-b border-line-light last:border-b-0 text-sm transition-colors duration-fast"
              :class="slotRowClass(slot)"
              @click="toggleSlot(slot)"
            >
              <span>{{ slot.startTime }}-{{ slot.endTime }}</span>
              <span
                class="text-xs"
                :class="isSlotSelected(slot) ? 'text-accent' : (slot.count ? 'text-success' : 'text-fg-muted')"
              >{{ slot.count ? `${slot.count} 片可订` : '已满' }}</span>
            </button>
          </div>
          <div v-else-if="allSlots.length && !timeSlots.length" class="py-6 text-center text-xs text-fg-muted">4 天内可监控的场次已售罄或锁定，试试其他日期</div>
          <div v-else class="py-6 text-center text-xs text-fg-muted">请选择日期查询场次</div>
        </div>

        <!-- 重复规律 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">重复规律</label>
          <div class="flex gap-1.5 flex-wrap mt-0.5">
            <button
              v-for="opt in REPEAT_OPTIONS" :key="opt.key"
              class="chip"
              :class="{ on: targetForm.repeat === opt.key }"
              @click="targetForm.repeat = opt.key"
            >{{ opt.label }}</button>
          </div>
          <div v-if="targetForm.repeat === 'custom'" class="flex gap-1.5 flex-wrap mt-1.5">
            <button
              v-for="d in CUSTOM_WEEKDAYS" :key="d.value"
              class="chip"
              :class="{ on: targetForm.customWeekdays.includes(d.value) }"
              @click="toggleCustomWeekday(d.value)"
            >周{{ d.label }}</button>
          </div>
        </div>

        <!-- 已选摘要 -->
        <div v-if="selectionSummary" class="flex items-center justify-between px-3 py-2 rounded-lg bg-accent-subtle">
          <span class="text-xs font-medium text-accent">已选：{{ selectionSummary }}</span>
          <button class="text-2xs text-accent active:opacity-70" @click="selectedKeys = new Set()">清空</button>
        </div>

        <Button
          variant="primary" size="md" block
          :loading="savingTarget"
          :disabled="loadingAvailability || !!availabilityError || !selectedKeys.size"
          @click="saveTarget"
        >保存</Button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Shared icon button — matches VenueView */
.icon-btn { @apply w-7 h-7 border-none rounded-full bg-surface-hover text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast active:scale-90; }
.icon-btn:hover { @apply bg-accent-subtle text-accent; }

/* Toggle switch */
.switch { @apply relative w-10 h-6 shrink-0 border-none rounded-full bg-line cursor-pointer transition-colors duration-fast p-0 disabled:opacity-50 disabled:cursor-not-allowed; }
.switch.on { @apply bg-accent; }
.switch-dot { @apply absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-fast; }
.switch.on .switch-dot { transform: translateX(16px); }

/* 单选/多选 chip */
.chip { @apply px-3 py-1.5 rounded-full border border-line bg-canvas text-sm text-fg-secondary cursor-pointer transition-all duration-fast active:scale-95; }
.chip.on { @apply bg-accent-subtle border-accent text-accent font-medium; }
</style>
