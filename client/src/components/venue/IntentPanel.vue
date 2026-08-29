<script setup>
/**
 * IntentPanel — 订场意图面板（状态总开关 + 意图卡片列表 + 创建/编辑表单 + 锁场/通知历史）
 * 嵌入 VenueView 订场页使用；不可用日期由父组件传入（与订场日历共用一份数据）
 *
 * @props {Set<string>} unavailableDateSet - 不开放日期集合（YYYY-MM-DD），单次日期选择时禁用
 */
import { ref, computed, onMounted } from 'vue'
import { useIntentStore } from '@/stores'
import { assembleIntentPayload } from '@/stores/intent'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Pencil, Trash2, Radar, ChevronDown } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  unavailableDateSet: { type: Set, default: () => new Set() }
})

const store = useIntentStore()
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

// === 摘要工具 ===
const WEEKDAYS = [
  { value: 0, label: '日' }, { value: 1, label: '一' }, { value: 2, label: '二' },
  { value: 3, label: '三' }, { value: 4, label: '四' }, { value: 5, label: '五' },
  { value: 6, label: '六' }
]

const STATUS_META = {
  monitoring: { label: '监控中', variant: 'accent' },
  locked: { label: '已锁到待支付', variant: 'success' },
  expired: { label: '已过期', variant: 'muted' },
  downgraded: { label: '已降级仅提醒', variant: 'warning' }
}

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

function intentScheduleLabel(t) {
  if (isWeekly(t)) return weekdaysLabel(t.weekdays)
  if (!t.date) return '—'
  const d = new Date(t.date + 'T12:00:00')
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAYS[d.getDay()]?.label ?? ''}`
}

function intentSummary(t) {
  return `${t.windowStart}-${t.windowEnd} · 连打${t.durationHours}小时 · ${t.courtsNeeded}片场`
}

function intentAreaLabel(t) {
  // 场地偏好：选中场地按顺序展示；空 = 用全局优先级
  if (Array.isArray(t.preferredAreaIds) && t.preferredAreaIds.length) {
    return Array.isArray(t.preferredAreaNames) && t.preferredAreaNames.length
      ? t.preferredAreaNames.join(' → ')
      : `已选 ${t.preferredAreaIds.length} 片场`
  }
  return '场地偏好：按全局优先级'
}

// 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM'（纯字符串处理，避开 iOS 日期解析坑）
function fmtTime(ts) {
  if (!ts) return ''
  return String(ts).slice(5, 16)
}

// === 全局锁场场地优先级（保存到配置，长期生效；意图不设偏好时按此顺序） ===
const showPrioritySheet = ref(false)
const priorityDraft = ref([])
const savingPriority = ref(false)

const priorityLabel = computed(() => {
  const names = store.config?.areaPriorityNames
  if (Array.isArray(names) && names.length) return names.join(' → ')
  const ids = store.config?.areaPriority
  if (Array.isArray(ids) && ids.length) return `已选 ${ids.length} 片场`
  return '未设置'
})

function openPrioritySheet() {
  priorityDraft.value = [...(store.config?.areaPriority || [])]
  showPrioritySheet.value = true
}

function togglePriorityDraft(areaId) {
  const list = [...priorityDraft.value]
  const idx = list.indexOf(areaId)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(areaId)
  priorityDraft.value = list
}

async function savePriority() {
  savingPriority.value = true
  try {
    await store.saveConfig({ areaPriority: [...priorityDraft.value] })
    toast.show('已保存', 'success')
    showPrioritySheet.value = false
  } catch (e) { toast.show(e.message || '保存失败', 'error') }
  savingPriority.value = false
}

// === 卡片展开：锁场记录 + 通知历史（分页对象直接渲染，不入 store） ===
const expandedId = ref(null)
const detail = ref({ loading: false, error: '', locks: [], notifications: [] })

async function toggleExpand(t) {
  if (expandedId.value === t.id) { expandedId.value = null; return }
  expandedId.value = t.id
  detail.value = { loading: true, error: '', locks: [], notifications: [] }
  try {
    const [locks, notifications] = await Promise.all([
      store.fetchLocks(t.id),
      store.fetchNotifications(t.id)
    ])
    if (expandedId.value !== t.id) return
    detail.value = { loading: false, error: '', locks: locks?.list || [], notifications: notifications?.list || [] }
  } catch (e) {
    if (expandedId.value === t.id) {
      detail.value = { loading: false, error: e.message || '加载失败', locks: [], notifications: [] }
    }
  }
}

// === 意图表单（哪天有空 + 时间窗口/时长 + 场地偏好；模式与片数收进次要设置） ===
const showIntentSheet = ref(false)
const editingIntent = ref(null)
const intentForm = ref({
  schedule: 'date', date: '', weekdays: [],
  windowStart: '19:00', windowEnd: '21:00', durationHours: 2,
  mode: 'auto_lock', courtsNeeded: 1, preferredAreaIds: []
})
const savingIntent = ref(false)
const showAdvanced = ref(false)

// 场馆只放今天起 4 天的票（与服务端 BOOKING_WINDOW_DAYS 一致）：日期选择即 4 张卡片
const HOUR_OPTIONS = Array.from({ length: 18 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`) // 06:00-23:00
const DURATION_OPTIONS = [1, 2, 3, 4]
const COURTS_OPTIONS = [1, 2, 3]
const MODE_OPTIONS = [
  { key: 'auto_lock', label: '自动锁场' },
  { key: 'notify', label: '仅提醒' }
]

// 星期 chip 按周一到周日排列（WEEKDAYS 按下标=星期值索引，勿重排）
const WEEKDAY_CHIPS = [1, 2, 3, 4, 5, 6, 0].map(v => WEEKDAYS[v])

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayStr() {
  return dateToStr(new Date())
}

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

const windowMinutes = computed(() => {
  const [sh, sm] = intentForm.value.windowStart.split(':').map(Number)
  const [eh, em] = intentForm.value.windowEnd.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
})

const windowValid = computed(() => windowMinutes.value > 0)
const durationValid = computed(() => windowValid.value && intentForm.value.durationHours * 60 <= windowMinutes.value)

function toggleWeekday(v) {
  const set = new Set(intentForm.value.weekdays)
  if (set.has(v)) set.delete(v)
  else set.add(v)
  intentForm.value.weekdays = [...set].sort((a, b) => a - b)
}

function togglePreferredArea(areaId) {
  const list = [...intentForm.value.preferredAreaIds]
  const idx = list.indexOf(areaId)
  if (idx >= 0) list.splice(idx, 1)
  else list.push(areaId)
  intentForm.value.preferredAreaIds = list
}

function openAddIntent() {
  editingIntent.value = null
  intentForm.value = {
    schedule: 'date', date: todayStr(), weekdays: [],
    windowStart: '19:00', windowEnd: '21:00', durationHours: 2,
    mode: 'auto_lock', courtsNeeded: 1, preferredAreaIds: []
  }
  showAdvanced.value = false
  showIntentSheet.value = true
}

function openEditIntent(t) {
  editingIntent.value = t
  const weekly = isWeekly(t)
  const inWindow = dateCards.value.some(c => c.date === t.date)
  intentForm.value = {
    schedule: weekly ? 'weekly' : 'date',
    // 过期/窗口外的单次日期回退到今天，由用户重选
    date: weekly ? todayStr() : (inWindow ? t.date : todayStr()),
    weekdays: weekly ? [...t.weekdays] : [],
    windowStart: t.windowStart,
    windowEnd: t.windowEnd,
    durationHours: t.durationHours,
    mode: t.mode || 'auto_lock',
    courtsNeeded: t.courtsNeeded || 1,
    preferredAreaIds: Array.isArray(t.preferredAreaIds) ? [...t.preferredAreaIds] : []
  }
  showAdvanced.value = false
  showIntentSheet.value = true
}

async function saveIntent() {
  const f = intentForm.value
  if (f.schedule === 'date') {
    if (!f.date) { toast.show('请选择日期', 'error'); return }
    if (props.unavailableDateSet.has(f.date)) { toast.show('该日期不开放，请选择其他日期', 'error'); return }
  } else if (!f.weekdays.length) {
    toast.show('请选择每周几', 'error'); return
  }
  if (!windowValid.value) { toast.show('窗口结束时间必须晚于开始时间', 'error'); return }
  if (!durationValid.value) { toast.show('打球时长不能超过时间窗口', 'error'); return }

  const input = {
    schedule: f.schedule,
    date: f.date,
    weekdays: [...f.weekdays],
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
    durationHours: f.durationHours,
    courtsNeeded: f.courtsNeeded,
    preferredAreaIds: [...f.preferredAreaIds],
    mode: f.mode
  }
  savingIntent.value = true
  try {
    if (editingIntent.value) {
      // 更新走部分字段语义：date/weekdays 传其一即切换模式，由 assembleIntentPayload 保证二选一
      await store.updateIntent(editingIntent.value.id, assembleIntentPayload(input))
    } else {
      await store.createIntent(input)
    }
    toast.show('已保存', 'success')
    showIntentSheet.value = false
  } catch (e) { toast.show(e.message || '保存失败', 'error') }
  savingIntent.value = false
}

async function toggleIntent(t) {
  if (t.expired) return
  try {
    await store.updateIntent(t.id, { enabled: !t.enabled })
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
}

async function deleteIntent(t) {
  const ok = await confirmAction({
    title: '删除订场意图',
    message: `确认删除「${intentScheduleLabel(t)} ${t.windowStart}-${t.windowEnd}」的订场意图？`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await store.deleteIntent(t.id)
    if (expandedId.value === t.id) expandedId.value = null
    toast.show('已删除', 'success')
  } catch (e) { toast.show(e.message || '删除失败', 'error') }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card padding="md">
      <!-- 头部：标题 + 就绪指示灯 + 总开关 -->
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">订场意图</h3>
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

      <!-- 全局锁场设置：场地优先级（保存到配置长期生效，意图未选偏好时生效） -->
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-fg-secondary">锁场优先级</span>
        <button class="text-xs text-accent active:opacity-70" @click="openPrioritySheet">{{ priorityLabel }}</button>
      </div>

      <!-- 总开关关闭时意图列表淡态（逐项开关仍可操作） -->
      <div :class="{ 'opacity-60': store.config && !store.config.enabled }">
      <!-- 订场意图 -->
      <div class="flex items-center justify-between mb-1.5">
        <h4 class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">订场意图</h4>
        <Button variant="ghost" size="sm" @click="openAddIntent">+ 新增</Button>
      </div>
      <EmptyState v-if="!store.intents.length" title="暂无订场意图" description="说说你哪天有空、想打几小时">
        <template #icon><Radar :size="40" class="text-fg-muted" /></template>
      </EmptyState>
      <div v-else class="flex flex-col">
        <div
          v-for="t in store.intents" :key="t.id"
          class="py-1.5 border-b border-line-light last:border-b-0"
          :class="{ 'opacity-50': t.expired }"
        >
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0 cursor-pointer active:opacity-70" @click="toggleExpand(t)">
              <div class="flex items-center gap-1.5 flex-wrap">
                <Badge size="sm" :variant="t.expired ? 'muted' : 'accent'">{{ intentScheduleLabel(t) }}</Badge>
                <Badge size="sm" :variant="STATUS_META[t.status]?.variant || 'muted'">{{ STATUS_META[t.status]?.label || t.status }}</Badge>
                <Badge v-if="t.mode === 'auto_lock'" size="sm" variant="success">自动锁场</Badge>
                <Badge v-else size="sm" variant="muted">仅提醒</Badge>
              </div>
              <span class="block text-2xs text-fg-secondary truncate mt-0.5">{{ intentSummary(t) }}</span>
              <span class="block text-2xs text-fg-muted truncate mt-0.5">{{ intentAreaLabel(t) }}</span>
            </div>
            <button
              class="switch shrink-0"
              :class="{ on: t.enabled }"
              role="switch"
              :aria-checked="!!t.enabled"
              :disabled="t.expired"
              title="启用"
              @click.stop="toggleIntent(t)"
            ><span class="switch-dot"></span></button>
            <button class="icon-btn" @click.stop="openEditIntent(t)" title="编辑">
              <Pencil :size="14" />
            </button>
            <button class="icon-btn !text-danger" @click.stop="deleteIntent(t)" title="删除">
              <Trash2 :size="14" />
            </button>
            <ChevronDown
              :size="14"
              class="shrink-0 text-fg-muted transition-transform duration-fast cursor-pointer"
              :class="{ 'rotate-180': expandedId === t.id }"
              @click.stop="toggleExpand(t)"
            />
          </div>

          <!-- 展开详情：最近锁场记录 + 通知历史 -->
          <div v-if="expandedId === t.id" class="mt-1.5 rounded-lg bg-canvas border border-line-light px-3 py-2">
            <div v-if="detail.loading" class="py-3 text-center text-2xs text-fg-muted">加载中…</div>
            <div v-else-if="detail.error" class="py-3 text-center text-2xs text-danger">{{ detail.error }}</div>
            <template v-else>
              <div class="mb-1">
                <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">锁场记录</span>
                <div v-if="!detail.locks.length" class="py-1.5 text-2xs text-fg-muted">暂无锁场记录</div>
                <div v-for="l in detail.locks" :key="l.id" class="flex items-center gap-1.5 py-1 text-2xs">
                  <span class="text-fg-secondary">{{ l.date?.slice(5) }} {{ l.startTime }}-{{ l.endTime }}</span>
                  <span class="text-fg-muted">{{ l.areaName }}</span>
                  <Badge v-if="l.status === 'locked'" size="sm" variant="success">已锁场</Badge>
                  <Badge v-else size="sm" variant="danger">失败</Badge>
                  <span class="ml-auto text-fg-muted">{{ fmtTime(l.createdAt) }}</span>
                </div>
                <p v-for="l in detail.locks.filter(x => x.error)" :key="'e' + l.id" class="text-2xs text-danger">{{ l.error }}</p>
              </div>
              <div>
                <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">通知历史</span>
                <div v-if="!detail.notifications.length" class="py-1.5 text-2xs text-fg-muted">暂无通知</div>
                <div v-for="n in detail.notifications" :key="n.id" class="flex items-center gap-1.5 py-1 text-2xs">
                  <span class="text-fg-secondary">{{ n.date?.slice(5) }} {{ n.startTime }}-{{ n.endTime }}</span>
                  <span class="text-fg-muted">{{ n.areaName }}<template v-if="n.price != null"> ¥{{ n.price }}</template></span>
                  <Badge v-if="n.success" size="sm" variant="success">已推送</Badge>
                  <Badge v-else size="sm" variant="danger">失败</Badge>
                  <span class="ml-auto text-fg-muted">{{ fmtTime(n.createdAt) }}</span>
                </div>
                <p v-for="n in detail.notifications.filter(x => x.error)" :key="'e' + n.id" class="text-2xs text-danger">{{ n.error }}</p>
              </div>
            </template>
          </div>
        </div>
      </div>
      </div>
    </Card>

    <!-- 意图表单：① 哪天有空 ② 打几小时（窗口+时长） ③ 场地偏好；模式/片数收在次要设置 -->
    <Sheet :show="showIntentSheet" :title="editingIntent ? '编辑订场意图' : '新增订场意图'" @close="showIntentSheet=false">
      <div class="flex flex-col gap-4">
        <!-- ① 哪天有空：单次日期 或 每周几，二选一 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">哪天有空</label>
          <div class="flex gap-1.5 mt-0.5">
            <button class="chip" :class="{ on: intentForm.schedule === 'date' }" @click="intentForm.schedule = 'date'">单次日期</button>
            <button class="chip" :class="{ on: intentForm.schedule === 'weekly' }" @click="intentForm.schedule = 'weekly'">每周重复</button>
          </div>

          <!-- 单次：今天起 4 天卡片，不开放日期禁用并红色标识 -->
          <div v-if="intentForm.schedule === 'date'" class="grid grid-cols-4 gap-2 mt-1.5">
            <button
              v-for="c in dateCards" :key="c.date"
              class="flex flex-col items-center gap-0.5 py-2 rounded-lg border transition-all duration-fast"
              :class="[
                intentForm.date === c.date
                  ? 'border-accent bg-accent-subtle'
                  : (c.isUnavailable ? 'border-danger bg-danger-subtle' : 'border-line bg-canvas'),
                c.isUnavailable ? 'cursor-not-allowed' : 'active:scale-95'
              ]"
              :disabled="c.isUnavailable"
              @click="intentForm.date = c.date"
            >
              <span
                class="text-sm font-medium"
                :class="intentForm.date === c.date ? 'text-accent' : (c.isUnavailable ? 'text-danger' : 'text-fg')"
              >{{ c.dayLabel }}</span>
              <span
                class="text-2xs"
                :class="intentForm.date === c.date ? 'text-accent' : (c.isUnavailable ? 'text-danger' : 'text-fg-muted')"
              >{{ c.dateLabel }}</span>
              <span class="h-[18px] flex items-center">
                <Badge v-if="c.isUnavailable" size="sm" variant="danger">不可用</Badge>
                <Badge v-else-if="c.isToday" size="sm" :variant="intentForm.date === c.date ? 'accent' : 'muted'">今天</Badge>
              </span>
            </button>
          </div>

          <!-- 每周：星期 chips 多选 -->
          <div v-else class="flex gap-1.5 flex-wrap mt-1.5">
            <button
              v-for="d in WEEKDAY_CHIPS" :key="d.value"
              class="chip"
              :class="{ on: intentForm.weekdays.includes(d.value) }"
              @click="toggleWeekday(d.value)"
            >周{{ d.label }}</button>
          </div>
        </div>

        <!-- ② 打几小时：时间窗口 + 时长 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">打几小时</label>
          <div class="flex items-center gap-2 mt-0.5">
            <select v-model="intentForm.windowStart" class="time-select">
              <option v-for="t in HOUR_OPTIONS" :key="'s' + t" :value="t">{{ t }}</option>
            </select>
            <span class="text-xs text-fg-muted">至</span>
            <select v-model="intentForm.windowEnd" class="time-select">
              <option v-for="t in HOUR_OPTIONS" :key="'e' + t" :value="t">{{ t }}</option>
            </select>
            <span class="text-2xs text-fg-muted">内任选</span>
          </div>
          <div class="flex gap-1.5 mt-1.5">
            <button
              v-for="h in DURATION_OPTIONS" :key="h"
              class="chip"
              :class="{ on: intentForm.durationHours === h }"
              @click="intentForm.durationHours = h"
            >{{ h }} 小时</button>
          </div>
          <p v-if="!windowValid" class="text-2xs text-danger">窗口结束时间必须晚于开始时间</p>
          <p v-else-if="!durationValid" class="text-2xs text-danger">打球时长不能超过时间窗口</p>
        </div>

        <!-- ③ 场地偏好：有序 chips，按点选顺序优先；不选 = 全局优先级 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">场地偏好</label>
          <div v-if="store.areas.length" class="flex gap-1.5 flex-wrap mt-0.5">
            <button
              v-for="a in store.areas" :key="a.areaId"
              class="chip"
              :class="{ on: intentForm.preferredAreaIds.includes(a.areaId) }"
              @click="togglePreferredArea(a.areaId)"
            >{{ a.areaName }}<template v-if="intentForm.preferredAreaIds.indexOf(a.areaId) >= 0">·{{ intentForm.preferredAreaIds.indexOf(a.areaId) + 1 }}</template></button>
          </div>
          <p class="text-2xs text-fg-muted mt-0.5">按点选顺序优先，不选 = 按全局锁场优先级。</p>
        </div>

        <!-- 次要设置：模式 + 同时片数 -->
        <div class="flex flex-col gap-2">
          <button class="flex items-center gap-1 text-xs text-fg-secondary active:opacity-70" @click="showAdvanced = !showAdvanced">
            <ChevronDown :size="14" class="transition-transform duration-fast" :class="{ 'rotate-180': showAdvanced }" />
            次要设置（{{ intentForm.mode === 'auto_lock' ? '自动锁场' : '仅提醒' }} · {{ intentForm.courtsNeeded }} 片场）
          </button>
          <template v-if="showAdvanced">
            <div class="flex items-center justify-between">
              <span class="text-sm text-fg">模式</span>
              <div class="flex gap-1.5">
                <button
                  v-for="opt in MODE_OPTIONS" :key="opt.key"
                  class="chip"
                  :class="{ on: intentForm.mode === opt.key }"
                  @click="intentForm.mode = opt.key"
                >{{ opt.label }}</button>
              </div>
            </div>
            <p class="text-2xs text-fg-muted">自动锁场：命中可订时段时自动下单锁场（约 5 分钟支付窗口）；仅提醒：只推送通知。</p>
            <div class="flex items-center justify-between">
              <span class="text-sm text-fg">同一小时几片场</span>
              <div class="flex gap-1.5">
                <button
                  v-for="n in COURTS_OPTIONS" :key="n"
                  class="chip"
                  :class="{ on: intentForm.courtsNeeded === n }"
                  @click="intentForm.courtsNeeded = n"
                >{{ n }} 片</button>
              </div>
            </div>
          </template>
        </div>

        <Button
          variant="primary" size="md" block
          :loading="savingIntent"
          :disabled="!durationValid"
          @click="saveIntent"
        >保存</Button>
      </div>
    </Sheet>

    <!-- 全局锁场优先级设置（长期生效；按点选顺序优先锁场，冲突自动递补） -->
    <Sheet :show="showPrioritySheet" title="锁场优先级" @close="showPrioritySheet=false">
      <div class="flex flex-col gap-4">
        <div v-if="store.areas.length" class="flex gap-1.5 flex-wrap">
          <button
            v-for="a in store.areas" :key="a.areaId"
            class="chip"
            :class="{ on: priorityDraft.includes(a.areaId) }"
            @click="togglePriorityDraft(a.areaId)"
          >{{ a.areaName }}<template v-if="priorityDraft.indexOf(a.areaId) >= 0">·{{ priorityDraft.indexOf(a.areaId) + 1 }}</template></button>
        </div>
        <div v-else class="py-6 text-center text-xs text-fg-muted">暂无场地数据，等监控轮询一次后自动记录</div>
        <p class="text-2xs text-fg-muted">自动锁场时按点选顺序优先下单，被抢冲突自动递补下一片；不选 = 按场馆默认顺序。对所有订场意图生效。</p>
        <Button variant="primary" size="md" block :loading="savingPriority" @click="savePriority">保存</Button>
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

/* 时间窗口下拉 */
.time-select { @apply px-2 py-1.5 rounded-lg border border-line bg-canvas text-sm text-fg; }
</style>
