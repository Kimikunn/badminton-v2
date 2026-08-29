import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

// 组装意图 payload：schedule='weekly' 传 weekdays，否则传 date（二选一，服务端校验）
// preferredAreaIds 空数组 = 用全局 areaPriority
export function assembleIntentPayload({ schedule, date, weekdays, ...rest }) {
  return schedule === 'weekly' ? { ...rest, weekdays } : { ...rest, date }
}

export const useIntentStore = defineStore('intent', () => {
  const config = ref(null)
  const intents = ref([])
  const areas = ref([]) // 场地列表（引擎顺带记录），供场地偏好/全局优先级选择
  const loading = ref(false)
  const initialized = ref(false)

  function upsertIntent(intent) {
    const idx = intents.value.findIndex(i => i.id === intent.id)
    if (idx >= 0) {
      intents.value[idx] = intent
    } else {
      intents.value.unshift(intent)
    }
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

  async function createIntent(data) {
    const res = await api.post('/intents', assembleIntentPayload(data))
    if (!res.success) throw new Error(res.error || '新增订场意图失败')
    if (res.data) upsertIntent(res.data)
    return res.data
  }

  async function updateIntent(id, patch) {
    const res = await api.put(`/intents/${id}`, patch)
    if (!res.success) throw new Error(res.error || '更新订场意图失败')
    if (res.data) upsertIntent(res.data)
    return res.data
  }

  async function deleteIntent(id) {
    const res = await api.delete(`/intents/${id}`)
    if (!res.success) throw new Error(res.error || '删除订场意图失败')
    intents.value = intents.value.filter(i => i.id !== id)
    return true
  }

  // 卡片展开用：分页对象直接返回给调用方，不入全局 state
  async function fetchLocks(intentId, pageNo = 1, pageSize = 20) {
    const res = await api.get('/intents/locks', { intentId, pageNo, pageSize })
    if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : (res.error?.message || '查询锁场记录失败'))
    return res.data
  }

  async function fetchNotifications(intentId, pageNo = 1, pageSize = 20) {
    const res = await api.get('/intents/notifications', { intentId, pageNo, pageSize })
    if (!res.success) throw new Error(typeof res.error === 'string' ? res.error : (res.error?.message || '查询通知历史失败'))
    return res.data
  }

  return {
    config, intents, areas,
    loading, initialized,
    init, saveConfig,
    createIntent, updateIntent, deleteIntent,
    fetchLocks, fetchNotifications
  }
})
