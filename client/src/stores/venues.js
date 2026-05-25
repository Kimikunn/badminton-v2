import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api/client'

export const useVenuesStore = defineStore('venues', () => {
  const venues = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  function getVenueById(id) {
    return venues.value.find(v => v.id === id)
  }

  function sortVenues() {
    venues.value = [...venues.value].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN')
    )
  }

  function upsertVenue(venue) {
    const idx = venues.value.findIndex(v => v.id === venue.id)
    if (idx >= 0) {
      venues.value[idx] = venue
    } else {
      venues.value.push(venue)
    }
    sortVenues()
  }

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const res = await api.get('/venues')
      if (res.success) venues.value = res.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function createVenue(data) {
    const res = await api.post('/venues', data)
    if (res.success && res.data) {
      upsertVenue(res.data)
      return res.data
    }
    return null
  }

  async function updateVenue(id, data) {
    const res = await api.put(`/venues/${id}`, data)
    if (res.success && res.data) {
      upsertVenue(res.data)
      return res.data
    }
    return null
  }

  async function deleteVenue(id) {
    const res = await api.delete(`/venues/${id}`)
    if (res.success) {
      venues.value = venues.value.filter(v => v.id !== id)
    }
    return res.success
  }

  return {
    venues, loading, initialized,
    getVenueById,
    init, createVenue, updateVenue, deleteVenue
  }
})
