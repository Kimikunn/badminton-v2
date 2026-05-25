import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import { STATUS, DEFAULT_BEST_OF } from '@/constants'

export const useMatchesStore = defineStore('matches', () => {
  const matches = ref([])
  const games = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  const allMatches = computed(() =>
    [...matches.value].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  )

  const historyMatches = computed(() =>
    allMatches.value.filter(m => m.status === STATUS.COMPLETED)
  )

  const ongoingMatches = computed(() =>
    matches.value.filter(m => m.status === STATUS.IN_PROGRESS)
  )

  function getMatchById(id) {
    return matches.value.find(m => m.id === id)
  }

  function getGamesByMatch(matchId) {
    return games.value.filter(g => g.matchId === matchId)
  }

  function getMatchScore(matchId) {
    const gs = getGamesByMatch(matchId)
    const scoreA = gs.filter(g => g.winner === 'a').length
    const scoreB = gs.filter(g => g.winner === 'b').length
    return { scoreA, scoreB }
  }

  function getMatchBestOf(matchId) {
    const m = getMatchById(matchId)
    return m?.bestOf || DEFAULT_BEST_OF
  }

  function sortMatches() {
    matches.value = [...matches.value].sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    )
  }

  function upsertMatch(match) {
    if (!match?.id) return
    const idx = matches.value.findIndex(m => m.id === match.id)
    if (idx >= 0) {
      matches.value[idx] = match
    } else {
      matches.value.unshift(match)
    }
  }

  function upsertMatches(nextMatches = []) {
    for (const match of nextMatches) upsertMatch(match)
    sortMatches()
  }

  function removeMatchesByRound(roundId) {
    const removedIds = new Set(matches.value.filter(m => m.roundId === roundId).map(m => m.id))
    matches.value = matches.value.filter(m => m.roundId !== roundId)
    games.value = games.value.filter(g => !removedIds.has(g.matchId))
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const [mRes, gRes] = await Promise.all([
        api.get('/matches'),
        api.get('/games')
      ])
      if (mRes.success) matches.value = mRes.data
      if (gRes.success) games.value = gRes.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function startMatch(matchId) {
    const res = await api.post(`/matches/${matchId}/start`)
    if (res.success && res.data) {
      const idx = matches.value.findIndex(m => m.id === matchId)
      if (idx >= 0) matches.value[idx] = res.data
    }
    return res.success
  }

  async function cancelMatch(matchId) {
    const res = await api.post(`/matches/${matchId}/cancel`)
    if (res.success) {
      const idx = matches.value.findIndex(m => m.id === matchId)
      if (idx >= 0) matches.value[idx].status = STATUS.PENDING
      // Remove associated games
      games.value = games.value.filter(g => g.matchId !== matchId)
    }
    return res.success
  }

  async function createMatch(data) {
    const res = await api.post('/matches', data)
    if (res.success && res.data) {
      upsertMatches([res.data])
    }
    return res.success ? res.data : null
  }

  async function updateMatch(matchId, data) {
    const res = await api.put(`/matches/${matchId}`, data)
    if (res.success && res.data) {
      const idx = matches.value.findIndex(m => m.id === matchId)
      if (idx >= 0) matches.value[idx] = res.data
    }
    return res.success ? res.data : null
  }

  async function deleteMatch(matchId) {
    const res = await api.delete(`/matches/${matchId}`)
    if (res.success) {
      matches.value = matches.value.filter(m => m.id !== matchId)
      games.value = games.value.filter(g => g.matchId !== matchId)
    }
    return res.success ? res.data : null
  }

  async function setGameScore(matchId, scoreA, scoreB) {
    const currentGame = games.value.find(g => g.matchId === matchId && g.status === STATUS.IN_PROGRESS)
    if (!currentGame) return false
    const res = await api.put(`/games/${currentGame.id}/score`, { scoreA, scoreB })
    if (res.success && res.data) {
      const idx = games.value.findIndex(g => g.id === currentGame.id)
      if (idx >= 0) games.value[idx] = res.data
    }
    return res.success
  }

  return {
    matches, games, loading, initialized,
    allMatches, historyMatches, ongoingMatches,
    getMatchById, getGamesByMatch, getMatchScore, getMatchBestOf,
    init, upsertMatches, removeMatchesByRound,
    startMatch, cancelMatch, createMatch, updateMatch, deleteMatch, setGameScore
  }
})
