import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const useBookingsStore = defineStore('bookings', () => {
  const config = ref({ rotation: [], currentPersonIndex: 0 })
  const records = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  function sortRecords() {
    records.value = [...records.value].sort((a, b) => {
      const dateCompare = (b.date || '').localeCompare(a.date || '')
      if (dateCompare !== 0) return dateCompare
      return (b.createdAt || '').localeCompare(a.createdAt || '')
    })
  }

  function upsertRecord(record) {
    const idx = records.value.findIndex(r => r.id === record.id)
    if (idx >= 0) {
      records.value[idx] = record
    } else {
      records.value.unshift(record)
    }
    sortRecords()
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [cRes, rRes] = await Promise.all([
        api.get('/bookings/config'),
        api.get('/bookings/records')
      ])
      if (cRes.success) config.value = cRes.data
      if (rRes.success) records.value = rRes.data
    } catch { /* non-critical */ }
    finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function addRecord(data) {
    const res = await api.post('/bookings/records', data)
    if (!res.success) throw new Error(res.error || '添加记录失败')
    if (res.data) {
      upsertRecord(res.data)
      // Backend advances the booking rotation when a record is created.
      // Mirror that state locally without sending a duplicate config update.
      if (config.value.rotation.length) {
        config.value.currentPersonIndex = (config.value.currentPersonIndex + 1) % config.value.rotation.length
      }
    }
    return res.data
  }

  async function updateRecord(id, data) {
    const res = await api.put(`/bookings/records/${id}`, data)
    if (!res.success) throw new Error(res.error || '更新记录失败')
    if (res.data) upsertRecord(res.data)
    return res.data
  }

  async function deleteRecord(id) {
    const res = await api.delete(`/bookings/records/${id}`)
    if (!res.success) throw new Error(res.error || '删除记录失败')
    records.value = records.value.filter(r => r.id !== id)
    // Mirror the backend rotation rollback locally
    if (config.value.rotation.length) {
      config.value.currentPersonIndex = config.value.currentPersonIndex === 0
        ? config.value.rotation.length - 1
        : config.value.currentPersonIndex - 1
    }
    return true
  }

  return {
    config, records, loading, initialized,
    init, addRecord, updateRecord, deleteRecord
  }
})
