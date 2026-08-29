import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

// 按模式组装目标 payload：单日传 date，每周传 weekdays；areaIds 空数组 = 任意场地
export function assembleTargetPayload({ mode, date, weekdays, startTime, endTime, areaIds, excludeUnavailable }) {
  const base = { startTime, endTime, areaIds, excludeUnavailable }
  return mode === 'weekly' ? { ...base, weekdays } : { ...base, date }
}

export const useVenueWatchStore = defineStore('venueWatch', () => {
  const config = ref(null)
  const targets = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  function upsertTarget(target) {
    const idx = targets.value.findIndex(t => t.id === target.id)
    if (idx >= 0) {
      targets.value[idx] = target
    } else {
      targets.value.unshift(target)
    }
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [configRes, targetsRes] = await Promise.all([
        api.get('/venue-watch/config'),
        api.get('/venue-watch/targets')
      ])
      if (configRes.success) config.value = configRes.data
      if (targetsRes.success) targets.value = targetsRes.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  // v2：总开关只写 enabled；推送/小程序凭证走服务端 .env，不在此管理
  async function saveConfig({ enabled }) {
    const res = await api.put('/venue-watch/config', { enabled })
    if (!res.success) throw new Error(res.error || '保存配置失败')
    if (res.data) config.value = res.data
    return res.data
  }

  async function createTarget(data) {
    const res = await api.post('/venue-watch/targets', assembleTargetPayload(data))
    if (!res.success) throw new Error(res.error || '新增监控目标失败')
    if (res.data) upsertTarget(res.data)
    return res.data
  }

  async function updateTarget(id, data) {
    const res = await api.put(`/venue-watch/targets/${id}`, data)
    if (!res.success) throw new Error(res.error || '更新监控目标失败')
    if (res.data) upsertTarget(res.data)
    return res.data
  }

  async function deleteTarget(id) {
    const res = await api.delete(`/venue-watch/targets/${id}`)
    if (!res.success) throw new Error(res.error || '删除监控目标失败')
    targets.value = targets.value.filter(t => t.id !== id)
    return true
  }

  return {
    config, targets,
    loading, initialized,
    init, saveConfig,
    createTarget, updateTarget, deleteTarget
  }
})
