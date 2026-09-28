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
    const style = {
      '--color-accent': c.light,
      '--color-accent-hover': c.light,
      '--color-accent-subtle': c.light.replace(')', ' / 0.12)'),
      '--color-accent-text': c.light,
    }
    // 赛季对比色（如 S7 FF770F × #000026）：accent 实心底上的文字色
    if (c.contrast) style['--season-contrast'] = c.contrast
    return style
  })

  return { setViewAccent, clearViewAccent, viewStyle }
}
