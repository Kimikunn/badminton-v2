<script setup>
/**
 * DaySheet — 某一天的操作面板：订场记录 / 监控（一天可多条）/ 历史（SHOW_LOGS）
 *
 * 一天两个正交维度（design §4.0）：
 * - 监控状态（维度一）：走 intent store，按天取，日历徽标与这里读的是同一份
 * - 不可用标记（维度二）：由父组件传入，不可用日不再提供监控新建，只给取消标记入口
 *
 * @props {boolean} show - 是否显示
 * @props {string} date - 选中日期 YYYY-MM-DD
 * @props {Array} bookings - 该日订场记录
 * @props {Object|null} unavailable - 该日不可用标记行（含 id），null = 未标记
 * @props {Function} getPlayerName - 玩家名
 * @props {Function} getPlayerAvatar - 玩家头像
 *
 * @events close / create-booking / mark-unavailable / unmark-unavailable
 */
import { ref, computed, watch } from 'vue'
import { useIntentStore, MONITOR_STATUS_LABELS, MONITOR_BADGE_VARIANT } from '@/stores/intent'
import Avatar from '@/components/ui/Avatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Sheet from '@/components/ui/Sheet.vue'
import { ChevronDown, Pencil, ShieldAlert, Trash2, X } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({
  show: { type: Boolean, default: false },
  date: { type: String, default: '' },
  bookings: { type: Array, default: () => [] },
  unavailable: { type: Object, default: null },
  getPlayerName: { type: Function, required: true },
  getPlayerAvatar: { type: Function, default: () => '' },
})

const emit = defineEmits(['close', 'create-booking', 'mark-unavailable', 'unmark-unavailable'])

const store = useIntentStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

// 历史（锁场记录 / 通知历史）只在非生产构建可见（测试环境专用，用户只关心结果）
const SHOW_LOGS = import.meta.env.MODE !== 'production'

const now = new Date()
const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const monitors = computed(() => store.monitorsForDate(props.date))

// === 监控表单：日期已由 sheet 决定，只剩时段 / 时长 / 模式 / 片数 ===
// 场馆可订时段 09:00-21:00（见 CONTEXT.md 可订时段）：开始 09:00-20:00，结束 10:00-21:00
const START_HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`)
const END_HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => `${String(i + 10).padStart(2, '0')}:00`)
const DURATION_OPTIONS = ['1', '2', '3', '4'].map(h => ({ key: h, label: `${h} 小时` }))
const COURTS_OPTIONS = ['1', '2', '3'].map(n => ({ key: n, label: `${n} 片` }))
const MODE_OPTIONS = [
  { key: 'auto_lock', label: '自动锁场' },
  { key: 'notify', label: '仅提醒' }
]

const showForm = ref(false)
const editingId = ref(null)
const form = ref({ windowStart: '20:00', windowEnd: '21:00', duration: '1', courts: '1', mode: 'auto_lock' })
const saving = ref(false)

const windowMinutes = computed(() => {
  const [sh, sm] = form.value.windowStart.split(':').map(Number)
  const [eh, em] = form.value.windowEnd.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
})

const windowValid = computed(() => windowMinutes.value > 0)
const durationValid = computed(() => windowValid.value && Number(form.value.duration) * 60 <= windowMinutes.value)

function openForm(monitor = null) {
  editingId.value = monitor ? monitor.id : null
  form.value = {
    windowStart: monitor?.windowStart || '20:00',
    windowEnd: monitor?.windowEnd || '21:00',
    duration: String(monitor?.durationHours || 1),
    courts: String(monitor?.courtsNeeded || 1),
    mode: monitor?.mode || 'auto_lock'
  }
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
}

async function saveMonitor() {
  if (!windowValid.value) { toast.show('窗口结束时间必须晚于开始时间', 'error'); return }
  if (!durationValid.value) { toast.show('打球时长不能超过时间窗口', 'error'); return }

  const payload = {
    windowStart: form.value.windowStart,
    windowEnd: form.value.windowEnd,
    durationHours: Number(form.value.duration),
    courtsNeeded: Number(form.value.courts),
    preferredAreaIds: [], // 场地偏好统一用设置里的全局锁场优先级
    mode: form.value.mode
  }

  saving.value = true
  try {
    if (editingId.value) await store.updateMonitor(editingId.value, payload)
    else await store.createForDate(props.date, payload)
    toast.show('已保存', 'success')
    closeForm()
  } catch (e) { toast.show(e.message || '保存失败', 'error') }
  saving.value = false
}

async function toggleMonitor(monitor) {
  try {
    await store.toggleMonitor(monitor.id)
  } catch (e) { toast.show(e.message || '操作失败', 'error') }
}

async function deleteMonitor(monitor) {
  const ok = await confirmAction({
    title: '删除监控',
    message: `确认删除 ${props.date} ${monitor.windowStart}-${monitor.windowEnd} 的监控？`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await store.deleteMonitor(monitor.id)
    if (editingId.value === monitor.id) closeForm()
    toast.show('已删除', 'success')
  } catch (e) { toast.show(e.message || '删除失败', 'error') }
}

function monitorSummary(m) {
  return `${m.windowStart}-${m.windowEnd} · 连打${m.durationHours}小时 · ${m.courtsNeeded}片场`
}

// === 状态展示 ===
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

// verifyDeadline 可能是毫秒时间戳（引擎内 Date.now() + windowMs）或时间串，两种都接受
function fmtClock(ts) {
  if (ts == null || ts === '') return ''
  let d
  if (typeof ts === 'number') d = new Date(ts)
  else {
    const s = String(ts)
    d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  }
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function verifyHint(m) {
  const t = fmtClock(m.verifyDeadline)
  return t
    ? `请在小程序完成图形验证，系统会在 ${t} 前自动重试`
    : '请在小程序完成图形验证，系统正在自动重试'
}

// 锁场失败的结构化错误码（design §3.5），不匹配中文文案
const ERROR_CODE_LABELS = {
  RISK_CONTROL: '风控拦截',
  SOLDOUT: '已被抢',
  LIMIT: '超出限订',
  UNPAID: '未支付订单',
  OTHER: '失败'
}

function attemptLabel(attempt) {
  const outcome = attempt.status === 'locked' ? '已锁到' : (ERROR_CODE_LABELS[attempt.errorCode] || '失败')
  return attempt.attempts > 1 ? `${outcome} · ${attempt.attempts} 次` : outcome
}

// === 历史：按天拉取（R9），分页对象直接在组件内渲染 ===
const showHistory = ref(false)
const history = ref({ loading: false, error: '', locks: [], notifications: [] })

function emptyHistory() {
  return { loading: false, error: '', locks: [], notifications: [] }
}

async function toggleHistory() {
  if (showHistory.value) { showHistory.value = false; return }
  showHistory.value = true
  history.value = { loading: true, error: '', locks: [], notifications: [] }
  try {
    const [locks, notifications] = await Promise.all([
      store.fetchLocksByDate(props.date),
      store.fetchNotificationsByDate(props.date)
    ])
    history.value = { loading: false, error: '', locks: locks?.list || [], notifications: notifications?.list || [] }
  } catch (e) {
    history.value = { loading: false, error: e.message || '加载失败', locks: [], notifications: [] }
  }
}

// 相同错误文案只显示一次（一次尝试可能多片场地同因失败，逐条重复是噪音）
function uniqueErrors(list) {
  return [...new Set((list || []).map(x => x.error).filter(Boolean))]
}

// 换天 / 关面板都回到初始态，避免下次打开残留上次的草稿
watch([() => props.show, () => props.date], () => {
  closeForm()
  showHistory.value = false
  history.value = emptyHistory()
})

// === 订场记录（沿用原有行为） ===
async function handleMarkUnavailable() {
  const parts = []
  if (props.bookings.length) parts.push(`当天有 ${props.bookings.length} 条订场记录，标记不可用将同时删除`)
  if (monitors.value.length) parts.push(`当天有 ${monitors.value.length} 条监控，标记后监控不会生效`)
  if (parts.length) {
    const ok = await confirmAction({
      title: '标记不可用',
      message: `${parts.join('；')}，确认？`,
      confirmText: '确认标记',
      variant: 'danger'
    })
    if (!ok) return
  }
  emit('mark-unavailable', props.date)
}
</script>

<template>
  <Sheet :show="show" :title="date" @close="emit('close')">
    <!-- 不可用日：维度二命中，整块替换为提示 + 取消标记入口（监控不生效，也不可达新建） -->
    <div v-if="unavailable" class="text-center py-4 text-sm">
      <X :size="28" class="text-danger mx-auto mb-2" />
      <p class="text-fg-secondary">已标记为不可用</p>
      <p class="text-xs text-fg-muted mt-1.5">该日已标记不可用，监控不会生效</p>
      <Button variant="secondary" size="md" block class="mt-3" @click="emit('unmark-unavailable', unavailable.id)">取消标记</Button>
    </div>

    <div v-else class="flex flex-col gap-3">
      <!-- 订场记录（沿用原日历 sheet 的展示） -->
      <div>
        <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">订场记录</span>
        <div v-if="bookings.length" class="flex flex-col">
          <div
            v-for="r in bookings"
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
        <div v-else class="py-3 text-fg-muted text-xs">暂无订场</div>
        <Button v-if="date >= todayKey" variant="primary" size="md" block class="mt-1" @click="emit('create-booking', date)">新增订场</Button>
      </div>

      <!-- 监控区块：按天，一天可多条（多时段）；状态由服务端派生，这里只展示与操作 -->
      <div class="rounded-lg border border-line-light bg-canvas px-3 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">监控</span>
          <span v-if="monitors.length" class="text-2xs text-fg-muted">{{ monitors.length }} 条</span>
          <Button v-if="!showForm" variant="ghost" size="sm" class="ml-auto" @click="openForm()">+ 开启这天监控</Button>
        </div>

        <p v-if="!monitors.length && !showForm" class="py-2 text-xs text-fg-muted">这天还没有监控，开启后到放票时间会自动抢</p>

        <div v-for="m in monitors" :key="m.id" class="py-2 border-b border-line-light last:border-b-0">
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0 flex flex-col gap-0.5">
              <div class="flex items-center gap-1.5 flex-wrap">
                <Badge size="sm" :variant="MONITOR_BADGE_VARIANT[m.status] || 'muted'">{{ MONITOR_STATUS_LABELS[m.status] || m.status }}</Badge>
                <Badge size="sm" :variant="m.mode === 'auto_lock' ? 'success' : 'muted'">{{ m.mode === 'auto_lock' ? '自动锁场' : '仅提醒' }}</Badge>
              </div>
              <span class="text-2xs text-fg-secondary truncate">{{ monitorSummary(m) }}</span>
              <span v-if="m.lastAttempt" class="text-2xs text-fg-muted truncate">最近尝试 {{ fmtTime(m.lastAttempt.createdAt) }} · {{ attemptLabel(m.lastAttempt) }}</span>
            </div>
            <button
              class="switch shrink-0"
              :class="{ on: m.enabled }"
              role="switch"
              :aria-checked="!!m.enabled"
              title="启用"
              @click="toggleMonitor(m)"
            ><span class="switch-dot"></span></button>
            <button class="icon-btn" title="编辑" @click="openForm(m)">
              <Pencil :size="14" />
            </button>
            <button class="icon-btn !text-danger" title="删除" @click="deleteMonitor(m)">
              <Trash2 :size="14" />
            </button>
          </div>

          <!-- 需验证：放票高峰被图形验证拦下时醒目提示 + 重试截止时间 -->
          <div v-if="m.status === 'awaiting_verify'" class="mt-1.5 flex items-start gap-1.5 rounded-lg bg-warning-subtle px-2.5 py-2">
            <ShieldAlert :size="14" class="text-warning shrink-0 mt-[1px]" />
            <div class="min-w-0">
              <p class="text-xs font-medium text-warning">需验证</p>
              <p class="text-2xs text-fg-secondary">{{ verifyHint(m) }}</p>
            </div>
          </div>
        </div>

        <!-- 新增 / 编辑：内联表单，日期由本面板决定，不再有星期条 -->
        <div v-if="showForm" class="mt-2 pt-2.5 border-t border-line-light flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-fg-secondary">{{ editingId ? '编辑监控' : '新增监控' }}</span>
            <button class="ml-auto text-2xs text-fg-muted active:opacity-70" @click="closeForm">取消</button>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">时间窗口</label>
            <div class="flex items-center gap-2 mt-0.5">
              <select v-model="form.windowStart" class="time-select">
                <option v-for="t in START_HOUR_OPTIONS" :key="'s' + t" :value="t">{{ t }}</option>
              </select>
              <span class="text-xs text-fg-muted">至</span>
              <select v-model="form.windowEnd" class="time-select">
                <option v-for="t in END_HOUR_OPTIONS" :key="'e' + t" :value="t">{{ t }}</option>
              </select>
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">连打时长</label>
            <SegmentedControl v-model="form.duration" :options="DURATION_OPTIONS" size="sm" />
            <p v-if="!windowValid" class="text-2xs text-danger">窗口结束时间必须晚于开始时间</p>
            <p v-else-if="!durationValid" class="text-2xs text-danger">打球时长不能超过时间窗口</p>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">同一小时几片场</label>
            <SegmentedControl v-model="form.courts" :options="COURTS_OPTIONS" size="sm" />
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">模式</label>
            <SegmentedControl v-model="form.mode" :options="MODE_OPTIONS" size="sm" />
          </div>

          <Button variant="primary" size="md" block :loading="saving" :disabled="!durationValid" @click="saveMonitor">保存</Button>
        </div>
      </div>

      <!-- 历史：锁场记录 / 通知历史（仅测试环境），按天拉取 -->
      <div v-if="SHOW_LOGS" class="flex flex-col gap-1.5">
        <button class="flex items-center gap-1 text-2xs text-fg-secondary active:opacity-70" @click="toggleHistory">
          <ChevronDown :size="14" class="transition-transform duration-fast" :class="{ 'rotate-180': showHistory }" />
          历史记录（锁场 / 通知）
        </button>
        <div v-if="showHistory" class="rounded-lg bg-canvas border border-line-light px-3 py-2">
          <div v-if="history.loading" class="py-3 text-center text-2xs text-fg-muted">加载中…</div>
          <div v-else-if="history.error" class="py-3 text-center text-2xs text-danger">{{ history.error }}</div>
          <template v-else>
            <div class="mb-1">
              <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">锁场记录</span>
              <div v-if="!history.locks.length" class="py-1.5 text-2xs text-fg-muted">暂无锁场记录</div>
              <div v-for="l in history.locks" :key="l.id" class="flex items-center gap-1.5 py-1 text-2xs">
                <span class="text-fg-secondary">{{ l.startTime }}-{{ l.endTime }}</span>
                <span class="text-fg-muted">{{ l.areaName }}</span>
                <Badge v-if="l.status === 'failed'" size="sm" variant="danger">失败</Badge>
                <Badge v-else size="sm" variant="success">成功</Badge>
                <span class="ml-auto text-fg-muted">{{ fmtTime(l.createdAt) }}</span>
              </div>
              <p v-for="msg in uniqueErrors(history.locks)" :key="'le' + msg" class="text-2xs text-danger mt-0.5">{{ msg }}</p>
            </div>
            <div>
              <span class="text-2xs font-semibold text-fg-muted uppercase tracking-wide">通知历史</span>
              <div v-if="!history.notifications.length" class="py-1.5 text-2xs text-fg-muted">暂无通知</div>
              <div v-for="n in history.notifications" :key="n.id" class="flex items-center gap-1.5 py-1 text-2xs">
                <span class="text-fg-secondary">{{ n.startTime }}-{{ n.endTime }}</span>
                <span class="text-fg-muted">{{ n.areaName }}<template v-if="n.price != null"> ¥{{ n.price }}</template></span>
                <Badge v-if="n.success" size="sm" variant="success">已推送</Badge>
                <Badge v-else size="sm" variant="danger">失败</Badge>
                <span class="ml-auto text-fg-muted">{{ fmtTime(n.createdAt) }}</span>
              </div>
              <p v-for="msg in uniqueErrors(history.notifications)" :key="'ne' + msg" class="text-2xs text-danger mt-0.5">{{ msg }}</p>
            </div>
          </template>
        </div>
      </div>

      <!-- 标记不可用：与监控正交，只改维度二；有订场/监控时先二次确认 -->
      <Button v-if="date >= todayKey" variant="danger" size="md" block @click="handleMarkUnavailable">标记不可用</Button>
    </div>
  </Sheet>
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

/* 时间窗口下拉 */
.time-select { @apply px-2 py-1.5 rounded-lg border border-line bg-canvas text-sm text-fg; }
</style>
