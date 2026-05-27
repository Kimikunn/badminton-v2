/**
 * Theme Composable — 三态主题（自动/浅色/深色）
 */
import { ref, computed, watch } from 'vue'

const STORAGE_KEY = 'bad-club-theme'

// 全局单例
const themeMode = ref(loadThemeMode())
const systemDark = ref(false)
let mediaQuery = null
let mediaQueryListener = null

function loadThemeMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

function saveThemeMode(mode) {
  themeMode.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch { /* ignore */ }
}

export function useTheme() {
  const isDark = computed(() => {
    if (themeMode.value === 'dark') return true
    if (themeMode.value === 'light') return false
    return systemDark.value
  })

  function initTheme() {
    if (mediaQuery) return // avoid double init
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches

    mediaQueryListener = (e) => {
      systemDark.value = e.matches
    }
    mediaQuery.addEventListener('change', mediaQueryListener)

    applyTheme(isDark.value)
  }

  function destroyTheme() {
    if (mediaQuery && mediaQueryListener) {
      mediaQuery.removeEventListener('change', mediaQueryListener)
      mediaQuery = null
      mediaQueryListener = null
    }
  }

  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    if (themeMeta) {
      themeMeta.content = dark ? '#1c1c1e' : '#f6f8fa'
    }
    const statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (statusMeta) {
      statusMeta.content = dark ? 'black-translucent' : 'default'
    }
  }

  watch(isDark, applyTheme, { immediate: true })

  function toggleTheme() {
    const modes = ['auto', 'light', 'dark']
    const idx = modes.indexOf(themeMode.value)
    const next = modes[(idx + 1) % 3]
    saveThemeMode(next)
  }

  function setTheme(mode) {
    saveThemeMode(mode)
  }

  return {
    isDark,
    themeMode,
    initTheme,
    destroyTheme,
    toggleTheme,
    setTheme
  }
}
