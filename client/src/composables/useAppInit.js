/**
 * App Initialization Composable
 *
 * 并行加载所有 Store 数据。单个 Store 失败不影响整体——无后端时优雅降级为空状态。
 */
import { ref } from 'vue'
import {
  useClubStore,
  usePlayersStore,
  useVenuesStore,
  useSeasonsStore,
  useMatchesStore,
  useTitlesStore,
  useBookingsStore
} from '@/stores'

const isInitialized = ref(false)
const isInitializing = ref(false)
const initError = ref(null)

export function useAppInit() {
  async function initAllStores(options = {}) {
    if (isInitializing.value) return
    if (isInitialized.value && !options.force) return

    isInitializing.value = true
    initError.value = null

    const stores = [
      { name: 'club', fn: () => useClubStore().init(options) },
      { name: 'players', fn: () => usePlayersStore().init(options) },
      { name: 'venues', fn: () => useVenuesStore().init(options) },
      { name: 'titles', fn: () => useTitlesStore().init(options) },
      { name: 'seasons', fn: () => useSeasonsStore().init(options) },
      { name: 'matches', fn: () => useMatchesStore().init(options) },
      { name: 'bookings', fn: () => useBookingsStore().init(options) }
    ]

    try {
      // allSettled: 单个失败不阻塞整体
      const results = await Promise.allSettled(
        stores.map(s =>
          s.fn().then(
            () => ({ name: s.name, ok: true }),
            (err) => ({ name: s.name, ok: false, error: err.message })
          )
        )
      )

      // 提取结果
      const failures = []
      for (const r of results) {
        const val = r.value
        if (!val.ok) {
          console.warn(`[AppInit] ${val.name} 加载失败: ${val.error}`)
          failures.push(val.name)
        }
      }

      // 全部失败才算致命错误
      if (failures.length === stores.length) {
        initError.value = '无法连接到服务器，请检查网络后重试'
      } else if (failures.length > 0) {
        console.warn(`[AppInit] ${failures.length} 个模块加载失败: ${failures.join(', ')}，继续显示缓存数据`)
      }

      isInitialized.value = true
    } finally {
      isInitializing.value = false
    }
  }

  async function reloadAllStores() {
    isInitialized.value = false
    await initAllStores({ force: true })
  }

  return {
    isInitialized,
    isInitializing,
    initError,
    initAllStores,
    reloadAllStores
  }
}
