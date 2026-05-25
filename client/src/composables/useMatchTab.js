import { ref } from 'vue'

const activeTab = ref('season')

export function useMatchTab() {
  return { activeTab }
}
