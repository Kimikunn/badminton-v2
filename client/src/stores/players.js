import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const usePlayersStore = defineStore('players', () => {
  const players = ref([])
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref(null)

  function getPlayerById(id) {
    return players.value.find(p => p.id === id)
  }

  function getPlayerName(id) {
    const p = getPlayerById(id)
    return p?.name || '未知'
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const res = await api.get('/players')
      if (res.success) players.value = res.data
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function updatePlayer(id, data) {
    const res = await api.put(`/players/${id}`, data)
    if (res.success) {
      const idx = players.value.findIndex(p => p.id === id)
      if (idx >= 0) players.value[idx] = { ...players.value[idx], ...data }
    }
    return res.success
  }

  return { players, loading, initialized, error, getPlayerById, getPlayerName, init, updatePlayer }
})
