/**
 * Per-page season accent
 */
import { watch, ref } from 'vue'

const viewAccent = ref(null)

export function useViewAccent() {
  function setViewAccent(color) {
    viewAccent.value = color
  }

  function clearViewAccent() {
    viewAccent.value = null
  }

  const viewStyle = ref({})

  watch(viewAccent, (c) => {
    if (c) {
      viewStyle.value = {
        '--color-accent': c.light,
        '--color-accent-hover': c.light,
        '--color-accent-subtle': c.light.replace(')', ' / 0.12)'),
        '--color-accent-text': c.light,
      }
    } else {
      viewStyle.value = {}
    }
  }, { immediate: true })

  return { setViewAccent, clearViewAccent, viewStyle }
}
