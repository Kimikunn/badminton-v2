/**
 * Per-page season accent
 */
import { ref, computed } from 'vue'

const viewAccent = ref(null)

export function useViewAccent() {
  function setViewAccent(color) {
    viewAccent.value = color
  }

  function clearViewAccent() {
    viewAccent.value = null
  }

  const viewStyle = computed(() => {
    const c = viewAccent.value
    if (!c) return {}
    return {
      '--color-accent': c.light,
      '--color-accent-hover': c.light,
      '--color-accent-subtle': c.light.replace(')', ' / 0.12)'),
      '--color-accent-text': c.light,
    }
  })

  return { setViewAccent, clearViewAccent, viewStyle }
}
