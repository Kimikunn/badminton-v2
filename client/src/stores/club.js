import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'

export const useClubStore = defineStore('club', () => {
  const club = ref({ name: 'The Plume Championship', description: '', avatar: null })
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref(null)

  const name = computed(() => club.value.name)

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const res = await api.get('/club')
      if (res.success) club.value = res.data
    } catch (err) {
      error.value = err.message
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function updateClub(data) {
    const res = await api.put('/club', data)
    if (res.success) club.value = { ...club.value, ...data }
    return res.success
  }

  return { club, loading, initialized, error, name, init, updateClub }
})
