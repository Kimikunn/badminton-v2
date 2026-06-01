import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'

export const useSeasonsStore = defineStore('seasons', () => {
  const seasons = ref([])
  const rounds = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  const currentSeason = computed(() =>
    seasons.value.find(s => s.status === 'ongoing') || seasons.value[0] || null
  )
  const currentRound = computed(() => {
    if (!currentSeason.value) return null
    return rounds.value.find(r =>
      r.seasonId === currentSeason.value.id && r.status === 'in_progress'
    ) || null
  })

  function getSeasonById(id) { return seasons.value.find(s => s.id === id) }
  function getRoundsBySeason(seasonId) { return rounds.value.filter(r => r.seasonId === seasonId) }
  function getRoundById(id) { return rounds.value.find(r => r.id === id) }

  function normalizeRound(round) {
    if (!round) return round
    const { id, seasonId, roundNo, status, venueManagerId, createdAt } = round
    return { id, seasonId, roundNo, status, venueManagerId, createdAt }
  }

  function upsertSeason(season) {
    if (!season?.id) return
    const idx = seasons.value.findIndex(s => s.id === season.id)
    if (idx >= 0) seasons.value[idx] = season
    else seasons.value.unshift(season)
  }

  function upsertRound(round) {
    const normalized = normalizeRound(round)
    if (!normalized?.id) return
    const idx = rounds.value.findIndex(r => r.id === normalized.id)
    if (idx >= 0) rounds.value[idx] = normalized
    else rounds.value.push(normalized)
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [sRes, rRes] = await Promise.all([
        api.get('/seasons'), api.get('/rounds')
      ])
      if (sRes.success) seasons.value = sRes.data
      if (rRes.success) rounds.value = rRes.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function createRound(data) {
    const res = await api.post('/rounds', data)
    if (!res.success) throw new Error(res.error || '创建轮次失败')
    if (res.data) {
      upsertRound(res.data)
      if (res.data.season) upsertSeason(res.data.season)
    }
    return res.data
  }

  async function createSeason(data) {
    const res = await api.post('/seasons', data)
    if (!res.success) throw new Error(res.error || '创建赛季失败')
    if (res.data) upsertSeason(res.data)
    return res.data
  }

  async function deleteSeason(seasonId) {
    const res = await api.delete(`/seasons/${seasonId}`)
    if (!res.success) throw new Error(res.error || '删除赛季失败')
    seasons.value = seasons.value.filter(s => s.id !== seasonId)
    rounds.value = rounds.value.filter(r => r.seasonId !== seasonId)
    return true
  }

  async function updateRound(roundId, data) {
    const res = await api.put(`/rounds/${roundId}`, data)
    if (!res.success) throw new Error(res.error || '更新轮次失败')
    if (res.data) upsertRound(res.data)
    return res.data
  }

  async function deleteRound(roundId) {
    const res = await api.delete(`/rounds/${roundId}`)
    if (!res.success) throw new Error(res.error || '删除轮次失败')
    rounds.value = rounds.value.filter(r => r.id !== roundId)
    return true
  }

  async function recordAction(seasonId, actionId, payload = {}) {
    const res = await api.post(`/seasons/${seasonId}/actions/${actionId}`, payload)
    if (res.success) await init({ force: true })
    return res
  }

  return {
    seasons, rounds, loading, initialized, currentSeason, currentRound,
    getSeasonById, getRoundsBySeason, getRoundById,
    init, createSeason, deleteSeason, createRound, updateRound, deleteRound, recordAction
  }
})
