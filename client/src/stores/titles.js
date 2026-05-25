import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const useTitlesStore = defineStore('titles', () => {
  const allTitles = ref([])
  const playerTitles = ref({}) // { playerId: [title, ...] }
  const loading = ref(false)
  const initialized = ref(false)

  function getPlayerTitles(playerId) {
    return playerTitles.value[playerId] || []
  }

  function getHighestTitle(playerId) {
    const titles = getPlayerTitles(playerId)
    if (!titles.length) return null
    const order = { S: 0, A: 1, B: 2, C: 3, hidden: 4 }
    return titles.sort((a, b) => (order[a.level] || 5) - (order[b.level] || 5))[0]
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [tRes, ptRes] = await Promise.all([
        api.get('/titles'),
        api.get('/titles/all-players')
      ])
      if (tRes.success) allTitles.value = tRes.data
      if (ptRes.success) playerTitles.value = ptRes.data
    } catch { /* non-critical */ }
    finally {
      loading.value = false
      initialized.value = true
    }
  }

  return { allTitles, playerTitles, loading, initialized, getPlayerTitles, getHighestTitle, init }
})
