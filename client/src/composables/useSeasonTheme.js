/**
 * Season Theme Composable
 *
 * Maps season colors to OKLCH hues. When a season is selected,
 * the entire app's accent color shifts to match that season's theme.
 */
import { watch, ref } from 'vue'
import { useSeasonsStore } from '@/stores'

const SEASON_COLORS = {
  blue:   { hue: 235, label: '蓝', light: 'oklch(0.52 0.18 235)', dark: 'oklch(0.68 0.16 235)' },
  purple: { hue: 290, label: '紫', light: 'oklch(0.52 0.18 290)', dark: 'oklch(0.68 0.16 290)' },
  green:  { hue: 155, label: '绿', light: 'oklch(0.55 0.16 155)', dark: 'oklch(0.68 0.14 155)' },
  yellow: { hue: 80,  label: '金', light: 'oklch(0.62 0.16 80)',  dark: 'oklch(0.72 0.14 80)' },
  red:    { hue: 20,  label: '红', light: 'oklch(0.52 0.20 20)',  dark: 'oklch(0.65 0.18 20)' },
  orange: { hue: 45,  label: '橙', light: 'oklch(0.60 0.18 45)',  dark: 'oklch(0.70 0.16 45)' },
}

const DEFAULT_COLOR = SEASON_COLORS.blue
const activeSeasonId = ref(null)

export function useSeasonTheme() {
  const seasonsStore = useSeasonsStore()

  function getSeasonColor(colorName) {
    return SEASON_COLORS[colorName] || DEFAULT_COLOR
  }

  function applySeasonTheme(seasonId) {
    activeSeasonId.value = seasonId
    const season = seasonsStore.getSeasonById(seasonId)
    const color = season?.color ? getSeasonColor(season.color) : DEFAULT_COLOR

    const root = document.documentElement
    const isDark = root.classList.contains('dark')

    root.style.setProperty('--color-accent', isDark ? color.dark : color.light)
    root.style.setProperty('--color-accent-hover', isDark
      ? `oklch(${color.hue === 80 ? 0.78 : 0.72} 0.14 ${color.hue})`
      : `oklch(${color.hue === 80 ? 0.55 : 0.48} 0.20 ${color.hue})`)
    root.style.setProperty('--color-accent-subtle', isDark
      ? `oklch(${color.hue === 80 ? 0.72 : 0.68} 0.16 ${color.hue} / 0.15)`
      : `oklch(${color.hue === 80 ? 0.62 : 0.52} 0.18 ${color.hue} / 0.12)`)
    root.style.setProperty('--color-accent-text', isDark
      ? `oklch(0.82 0.10 ${color.hue})`
      : `oklch(0.38 0.10 ${color.hue})`)
  }

  function resetTheme() {
    activeSeasonId.value = null
    const root = document.documentElement
    root.style.removeProperty('--color-accent')
    root.style.removeProperty('--color-accent-hover')
    root.style.removeProperty('--color-accent-subtle')
    root.style.removeProperty('--color-accent-text')
  }

  // Auto-apply theme when current season changes
  watch(() => seasonsStore.currentSeason, (season) => {
    if (season) {
      applySeasonTheme(season.id)
    }
  }, { immediate: true })

  return {
    SEASON_COLORS,
    getSeasonColor,
    applySeasonTheme,
    resetTheme,
    activeSeasonId
  }
}
