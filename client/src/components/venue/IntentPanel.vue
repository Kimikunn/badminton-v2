<script setup>
/**
 * IntentPanel — 订场意图面板（意图卡片列表 + 新增；总开关/凭证状态/全局优先级收进设置 Sheet）
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
import { Pencil, Trash2, Radar, ChevronDown, Settings } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  unavailableDateSet: { type: Set, default: () => new Set() }
})

const store = useIntentStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

onMounted(() => { store.init() })

// === 状态与总开关（收进设置 Sheet） ===
const savingConfig = ref(false)

// 就绪 = 推送配置 + 小程序登录态均已配置（凭证在服务器 .env）
const isReady = computed(() => !!(store.config?.pushConfigured && store.config?.gymTokenConfigured))

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

// 锁场/推送日志只在非生产构建可见（测试环境专用，用户只关心结果）
const SHOW_LOGS = import.meta.env.MODE !== 'production'

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

// 最近的下一个发生日（每周模式：今天起 14 天内第一个匹配日；单次模式：date 本身）
function nextOccurrenceDate(t) {
  if (!isWeekly(t)) return t.date
  const set = new Set(t.weekdays)
  const now = new Date()
  for (let i = 0; i < 14; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    if (set.has(d.getDay())) return dateToStr(d)
  }
  return null
}

function nextOccurrenceLabel(t) {
  const date = nextOccurrenceDate(t)
  if (!date) return ''
  const d = new Date(date + 'T12:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 下一个发生日恰是不开放日（引擎当天会跳过，卡片上提前告知）
function nextOccurrenceUnavailable(t) {
  const date = nextOccurrenceDate(t)
  return !!date && props.unavailableDateSet.has(date)
}

function intentSummary(t) {
  return `${t.windowStart}-${t.windowEnd} · 连打${t.durationHours}小时 · ${t.courtsNeeded}片场`
}

// 服务端时间戳存的是 UTC（SQLite datetime('now')）：按 UTC 解析，渲染为本地时间（MM-DD HH:MM）
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(String(ts).replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return String(ts).slice(5, 16)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

// 相同错误文案只显示一次（一次尝试可能多片场地同因失败，逐条重复是噪音）
function uniqueErrors(list) {
  return [...new Set((list || []).map(x => x.error).filter(Boolean))]
}

// === 设置（总开关 / 凭证状态 / 全局锁场优先级；意图不设偏好时按全局顺序锁场） ===
const showSettingsSheet = ref(false)
const priorityDraft = ref([])
const savingPriority = ref(false)

function openSettings() {
  priorityDraft.value = [...(store.config?.areaPriority || [])]
  showSettingsSheet.value = true
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
    showSettingsSheet.value = false
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

// === 意图表单（每周哪几天 + 时间窗口/时长；场地偏好统一用设置里的全局优先级；模式与片数收进次要设置） ===
const showIntentSheet = ref(false)
const editingIntent = ref(null)
const intentForm = ref({
  weekdays: [],
  windowStart: '19:00', windowEnd: '21:00', durationHours: 2,
  mode: 'auto_lock', courtsNeeded: 1
})
const savingIntent = ref(false)
const showAdvanced = ref(false)

// 场馆可订时段 09:00-21:00（见 CONTEXT.md 可订时段）：开始 09:00-20:00，结束 10:00-21:00
const START_HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`)
const END_HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => `${String(i + 10).padStart(2, '0')}:00`)
const DURATION_OPTIONS = [1, 2, 3, 4]
const COURTS_OPTIONS = [1, 2, 3]
const MODE_OPTIONS = [
  { key: 'auto_lock', label: '自动锁场' },
  { key: 'notify', label: '仅提醒' }
]

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 从今天起往后 7 天的星期条：今天永远是第一天。每天都可选（选的是"每周几"），
// 超出放票窗口（今天起 4 天）的灰显，不开放的标注"不可用"
const weekStrip = computed(() => {
  const now = new Date()
  const lastBookable = new Date(now)
  lastBookable.setDate(now.getDate() + 3) // 与服务端 BOOKING_WINDOW_DAYS=4 一致
  const lastBookableS = dateToStr(lastBookable)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const date = dateToStr(d)
    days.push({
      weekday: d.getDay(),
      dayLabel: WEEKDAYS[d.getDay()].label,
      dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      isToday: i === 0,
      muted: date > lastBookableS,
      isUnavailable: props.unavailableDateSet.has(date)
    })
  }
  return days
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

function openAddIntent() {
  editingIntent.value = null
  intentForm.value = {
    weekdays: [],
    windowStart: '19:00', windowEnd: '21:00', durationHours: 2,
    mode: 'auto_lock', courtsNeeded: 1
  }
  showAdvanced.value = false
  showIntentSheet.value = true
}

function openEditIntent(t) {
  editingIntent.value = t
  intentForm.value = {
    // 旧的单次日期意图：预选它那天的星期几，保存后即转为每周模式
    weekdays: isWeekly(t) ? [...t.weekdays] : (t.date ? [new Date(t.date + 'T12:00:00').getDay()] : []),
    windowStart: t.windowStart,
    windowEnd: t.windowEnd,
    durationHours: t.durationHours,
    mode: t.mode || 'auto_lock',
    courtsNeeded: t.courtsNeeded || 1
  }
  showAdvanced.value = false
  showIntentSheet.value = true
}

async function saveIntent() {
  const f = intentForm.value
  if (!f.weekdays.length) { toast.show('请选择每周几', 'error'); return }
  if (!windowValid.value) { toast.show('窗口结束时间必须晚于开始时间', 'error'); return }
  if (!durationValid.value) { toast.show('打球时长不能超过时间窗口', 'error'); return }

  const input = {
    schedule: 'weekly',
    weekdays: [...f.weekdays],
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
    durationHours: f.durationHours,
    courtsNeeded: f.courtsNeeded,
    preferredAreaIds: [], // 场地偏好统一用设置里的全局优先级
    mode: f.mode
  }
  savingIntent.value = true
  try {
    if (editingIntent.value) {
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
    title: '删除辅助订场',
    message: `确认删除「${intentScheduleLabel(t)} ${t.windowStart}-${t.windowEnd}」？`,
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
      <!-- 头部：标题 + 新增 + 设置入口（总开关/凭证状态/全局优先级收进设置） -->
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">辅助订场</h3>
        <div class="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" @click="openAddIntent">+ 新增</Button>
          <button class="icon-btn" title="辅助订场设置" @click="openSettings">
            <Settings :size="14" />
          </button>
        </div>
      </div>

      <!-- 总开关关闭时意图列表淡态（逐项开关仍可操作） -->
      <div :class="{ 'opacity-60': store.config && !store.config.enabled }">
      <EmptyState v-if="!store.intents.length" title="暂无辅助订场" description="说说你哪天有空、想打几小时">
        <template #icon><Radar :size="40" class="text-fg-muted" /></template>
      </EmptyState>
      <div v-else class="flex flex-col">
        <div
          v-for="t in store.intents" :key="t.id"
          class="py-1.5 border-b border-line-light last:border-b-0"
          :class="{ 'opacity-50': t.expired }"
        >
          <div class="flex items-center gap-2">
            <div
              class="flex-1 min-w-0"
              :class="SHOW_LOGS ? 'cursor-pointer active:opacity-70' : ''"
              @click="SHOW_LOGS && toggleExpand(t)"
            >
              <div class="flex items-center gap-1.5 flex-wrap">
                <Badge size="sm" :variant="t.expired ? 'muted' : 'accent'">{{ intentScheduleLabel(t) }}</Badge>
                <span v-if="isWeekly(t)" class="text-2xs text-fg-muted">{{ nextOccurrenceLabel(t) }}</span>
                <Badge v-if="nextOccurrenceUnavailable(t)" size="sm" variant="warning">不可用</Badge>
                <Badge v-if="t.mode === 'auto_lock'" size="sm" variant="success">自动锁场</Badge>
                <Badge v-else size="sm" variant="muted">仅提醒</Badge>
              </div>
              <span class="block text-2xs text-fg-secondary truncate mt-0.5">{{ intentSummary(t) }}</span>
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
              v-if="SHOW_LOGS"
              :size="14"
              class="shrink-0 text-fg-muted transition-transform duration-fast cursor-pointer"
              :class="{ 'rotate-180': expandedId === t.id }"
              @click.stop="toggleExpand(t)"
            />
          </div>

          <!-- 展开详情：最近锁场记录 + 通知历史（仅测试环境） -->
          <div v-if="SHOW_LOGS && expandedId === t.id" class="mt-1.5 rounded-lg bg-canvas border border-line-light px-3 py-2">
            <div v-if="detail.loading" class="py-3 text-center text-2xs text-fg-muted">加载中…</div>
            <div v-else-if="detail.error" class="py-3 text-center text-2xs text-danger">{{ detail.error }}</div>
            <template v-else>
              <div class="mb-1">
                <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">锁场记录</span>
                <div v-if="!detail.locks.length" class="py-1.5 text-2xs text-fg-muted">暂无锁场记录</div>
                <div v-for="l in detail.locks" :key="l.id" class="flex items-center gap-1.5 py-1 text-2xs">
                  <span class="text-fg-secondary">{{ l.date?.slice(5) }} {{ l.startTime }}-{{ l.endTime }}</span>
                  <span class="text-fg-muted">{{ l.areaName }}</span>
                  <Badge v-if="l.status === 'failed'" size="sm" variant="danger">失败</Badge>
                  <Badge v-else size="sm" variant="success">成功</Badge>
                  <span class="ml-auto text-fg-muted">{{ fmtTime(l.createdAt) }}</span>
                </div>
                <p v-for="msg in uniqueErrors(detail.locks)" :key="'le' + msg" class="text-2xs text-danger mt-0.5">{{ msg }}</p>
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
                <p v-for="msg in uniqueErrors(detail.notifications)" :key="'ne' + msg" class="text-2xs text-danger mt-0.5">{{ msg }}</p>
              </div>
            </template>
          </div>
        </div>
      </div>
      </div>
    </Card>

    <!-- 意图表单：① 每周哪几天（星期条） ② 打几小时（窗口+时长）；模式/片数收在次要设置 -->
    <Sheet :show="showIntentSheet" :title="editingIntent ? '编辑辅助订场' : '新增辅助订场'" @close="showIntentSheet=false">
      <div class="flex flex-col gap-4">
        <!-- ① 每周哪几天：本周星期条；已过/未放票灰显，不开放标"不可用"（均可选，选的是每周几） -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">每周哪几天</label>
          <div class="grid grid-cols-7 gap-1 mt-1.5">
            <button
              v-for="c in weekStrip" :key="c.weekday"
              class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg border transition-all duration-fast active:scale-95"
              :class="[
                intentForm.weekdays.includes(c.weekday)
                  ? 'border-accent bg-accent-subtle'
                  : 'border-line bg-canvas',
                c.muted && !intentForm.weekdays.includes(c.weekday) ? 'opacity-45' : ''
              ]"
              @click="toggleWeekday(c.weekday)"
            >
              <span
                class="text-sm font-medium"
                :class="intentForm.weekdays.includes(c.weekday) ? 'text-accent' : (c.muted ? 'text-fg-muted' : 'text-fg')"
              >{{ c.dayLabel }}</span>
              <span
                class="text-2xs"
                :class="intentForm.weekdays.includes(c.weekday) ? 'text-accent' : 'text-fg-muted'"
              >{{ c.dateLabel }}</span>
              <span class="h-[16px] flex items-center text-2xs">
                <template v-if="c.isUnavailable"><span class="text-warning">不可用</span></template>
                <template v-else-if="c.isToday"><span :class="intentForm.weekdays.includes(c.weekday) ? 'text-accent' : 'text-fg-muted'">今天</span></template>
              </span>
            </button>
          </div>
        </div>

        <!-- ② 打几小时：时间窗口 + 时长 -->
        <div class="flex flex-col gap-1">
          <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">打几小时</label>
          <div class="flex items-center gap-2 mt-0.5">
            <select v-model="intentForm.windowStart" class="time-select">
              <option v-for="t in START_HOUR_OPTIONS" :key="'s' + t" :value="t">{{ t }}</option>
            </select>
            <span class="text-xs text-fg-muted">至</span>
            <select v-model="intentForm.windowEnd" class="time-select">
              <option v-for="t in END_HOUR_OPTIONS" :key="'e' + t" :value="t">{{ t }}</option>
            </select>
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

    <!-- 辅助订场设置：凭证状态 + 总开关 + 全局锁场优先级（对所有意图生效） -->
    <Sheet :show="showSettingsSheet" title="辅助订场设置" @close="showSettingsSheet=false">
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <span class="text-sm text-fg">监控状态</span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full" :class="isReady ? 'bg-success' : 'bg-line'"></span>
            <span class="text-xs" :class="isReady ? 'text-success' : 'text-fg-muted'">{{ isReady ? '已就绪' : '未配置' }}</span>
          </span>
        </div>
        <p v-if="!isReady" class="text-2xs text-fg-muted">请在服务器 .env 配置凭证（PUSH_TOKEN / GYM_TOKEN_USER），修改后需重启服务生效。</p>

        <div class="flex items-center justify-between">
          <span class="text-sm text-fg">总开关</span>
          <button
            class="switch"
            :class="{ on: store.config?.enabled }"
            role="switch"
            :aria-checked="!!store.config?.enabled"
            :disabled="savingConfig || !store.config"
            @click="toggleEnabled"
          ><span class="switch-dot"></span></button>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-sm text-fg">锁场优先级</span>
          <div v-if="store.areas.length" class="flex gap-1.5 flex-wrap">
            <button
              v-for="a in store.areas" :key="a.areaId"
              class="chip"
              :class="{ on: priorityDraft.includes(a.areaId) }"
              @click="togglePriorityDraft(a.areaId)"
            >{{ a.areaName }}<template v-if="priorityDraft.indexOf(a.areaId) >= 0">·{{ priorityDraft.indexOf(a.areaId) + 1 }}</template></button>
          </div>
          <div v-else class="py-4 text-center text-xs text-fg-muted">暂无场地数据</div>
        </div>

        <Button variant="primary" size="md" block :loading="savingPriority" @click="savePriority">保存优先级</Button>
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
