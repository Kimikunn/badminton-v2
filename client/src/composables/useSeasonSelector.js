/**
 * Shared selected season state — persists across season sub-pages
 */
import { ref } from 'vue'
import { useSeasonsStore } from '@/stores'

const selectedSeasonId = ref(null)

export function useSeasonSelector() {
  function getSelectedSeasonId() {
    if (selectedSeasonId.value) return selectedSeasonId.value
    const store = useSeasonsStore()
    return store.currentSeason?.id || ''
  }

  function setSelectedSeasonId(id) {
    selectedSeasonId.value = id
  }

  return { selectedSeasonId, getSelectedSeasonId, setSelectedSeasonId }
}
