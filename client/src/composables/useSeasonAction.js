import { api } from '@/api/client'
import { useSeasonsStore } from '@/stores'
import { useToast } from '@/composables/useToast'

export function useSeasonAction() {
  const seasonsStore = useSeasonsStore()
  const toast = useToast()

  async function recordSeasonAction(seasonId, actionId, payload = {}, successMessage = '已记录') {
    try {
      await api.post(`/seasons/${seasonId}/actions/${actionId}`, payload)
      await seasonsStore.init({ force: true })
      toast.show(successMessage, 'success')
      return true
    } catch (e) {
      toast.show(e.message || '记录失败', 'error')
      return false
    }
  }

  return { recordSeasonAction }
}
