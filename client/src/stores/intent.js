import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'

// 单日模型：监控只绑具体日期（weekly 已下线），payload 只保留 date，
// 旧调用方残留的 schedule/weekdays 一律丢弃，避免服务端 422。
// preferredAreaIds 空数组 = 用全局 areaPriority
export function assembleIntentPayload({ date, schedule, weekdays, ...rest }) {
  return { ...rest, date }
}

// 单条监控的中文文案（PRD 状态表）；expired 只作兜底展示，不参与聚合
export const MONITOR_STATUS_LABELS = {
  expired: '已过期',
  awaiting_verify: '需验证',
  fulfilled: '已锁到',
  pending_release: '待放票（今天 09:00）',
  waiting: '等待放票',
  watching: '监控中',
  paused: '已暂停'
}

// 日历格子文案：格子太窄放不下全称，压缩到 2-3 字
export const MONITOR_CELL_LABELS = {
  expired: '已过期',
  awaiting_verify: '需验证',
  fulfilled: '已锁到',
  pending_release: '待放票',
  waiting: '等待',
  watching: '监控中',
  paused: '已暂停'
}

// 徽标配色（design §4.4）：awaiting_verify warning / fulfilled success / watching accent
// / pending_release+waiting info（项目无 info 令牌，用 Badge 的 blue）/ paused muted
export const MONITOR_BADGE_VARIANT = {
  expired: 'muted',
  awaiting_verify: 'warning',
  fulfilled: 'success',
  pending_release: 'blue',
  waiting: 'blue',
  watching: 'accent',
  paused: 'muted'
}

// 日历徽标聚合优先级：首个命中即为准，顺序即契约（design.md §4.2 / PRD 状态模型）；
// expired 不参与（过去日不渲染徽标）
export const BADGE_PRIORITY = [
  'awaiting_verify',
  'fulfilled',
  'watching',
  'pending_release',
  'waiting',
  'paused'
]

/**
 * 纯函数：把某天的多条监控折叠成一个徽标。
 * status = 优先级最高的一条；count = 当天参与聚合的监控总条数（日历上用角标展示）。
 * expired 与不可用日都不参与（过去日不渲染徽标，不可用走 X 覆盖）。
 */
export function aggregateDayBadge(monitors) {
  const active = (monitors || []).filter(m => m.status && m.status !== 'expired')
  if (!active.length) return null
  const status = BADGE_PRIORITY.find(s => active.some(m => m.status === s))
  return status ? { status, count: active.length } : null
}

export const useIntentStore = defineStore('intent', () => {
  const config = ref(null)
  const intents = ref([])
  const areas = ref([]) // 场地列表（引擎顺带记录），供全局锁场优先级选择
  const loading = ref(false)
  const initialized = ref(false)

  // 按日期索引：同一天可多条（多时段），按窗口开始时间排序。
  // 这是日历徽标与当天 sheet 的唯一来源；不可用日（维度二）不参与聚合。
  const monitorsByDate = computed(() => {
    const map = new Map()
    for (const m of intents.value) {
      if (!m.date) continue
      const list = map.get(m.date) || []
      list.push(m)
      map.set(m.date, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.windowStart).localeCompare(String(b.windowStart)))
    }
    return map
  })

  function monitorsForDate(date) {
    return (date && monitorsByDate.value.get(date)) || []
  }

  function badgeFor(date) {
    return aggregateDayBadge(monitorsByDate.value.get(date))
  }

  function upsertMonitor(monitor) {
    const idx = intents.value.findIndex(m => m.id === monitor.id)
    if (idx >= 0) intents.value[idx] = monitor
    else intents.value.unshift(monitor)
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [configRes, intentsRes, areasRes] = await Promise.all([
        api.get('/intents/config'),
        api.get('/intents'),
        api.get('/intents/areas')
      ])
      if (configRes.success) config.value = configRes.data
      if (intentsRes.success) intents.value = intentsRes.data
      if (areasRes.success) areas.value = areasRes.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  // 总开关 enabled、全局锁场场地优先级 areaPriority；推送/小程序凭证走服务端 .env，不在此管理
  async function saveConfig(patch) {
    const res = await api.put('/intents/config', patch)
    if (!res.success) throw new Error(res.error || '保存配置失败')
    if (res.data) config.value = res.data
    return res.data
  }

  // 日期由日历决定，payload 只带时段/偏好
  async function createForDate(date, payload) {
    const res = await api.post('/intents', assembleIntentPayload({ ...payload, date }))
    if (!res.success) throw new Error(res.error || '新增监控失败')
    if (res.data) upsertMonitor(res.data)
    return res.data
  }

  async function updateMonitor(id, patch) {
    const res = await api.put(`/intents/${id}`, patch)
    if (!res.success) throw new Error(res.error || '更新监控失败')
    if (res.data) upsertMonitor(res.data)
    return res.data
  }

  async function toggleMonitor(id) {
    const monitor = intents.value.find(m => m.id === id)
    if (!monitor) return null
    return updateMonitor(id, { enabled: !monitor.enabled })
  }

  async function deleteMonitor(id) {
    const res = await api.delete(`/intents/${id}`)
    if (!res.success) throw new Error(res.error || '删除监控失败')
    intents.value = intents.value.filter(m => m.id !== id)
    return true
  }

  // 历史按天拉取（R9）；分页对象直接返回给调用方，不入全局 state
  async function fetchLocksByDate(date, pageNo = 1, pageSize = 20) {
    const res = await api.get('/intents/locks', { date, pageNo, pageSize })
    if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : (res.error?.message || '查询锁场记录失败'))
    return res.data
  }

  async function fetchNotificationsByDate(date, pageNo = 1, pageSize = 20) {
    const res = await api.get('/intents/notifications', { date, pageNo, pageSize })
    if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : (res.error?.message || '查询通知历史失败'))
    return res.data
  }

  return {
    config, intents, areas,
    loading, initialized,
    monitorsByDate, monitorsForDate, badgeFor,
    init, saveConfig,
    createForDate, updateMonitor, toggleMonitor, deleteMonitor,
    fetchLocksByDate, fetchNotificationsByDate
  }
})
