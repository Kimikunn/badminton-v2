import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 响应式在线/离线状态检测
 *
 * 提供：
 * - isOnline: 当前是否在线
 * - wasOffline: 自加载后是否经历过离线
 * - lastChanged: 最后状态变更时间戳
 *
 * 使用方式：
 * const { isOnline } = useOnlineStatus()
 * 在模板中：<div v-if="!isOnline" class="offline-banner">离线</div>
 */
export function useOnlineStatus() {
  const isOnline = ref(navigator.onLine)
  const wasOffline = ref(false)
  const lastChanged = ref(Date.now())

  function handleOnline() {
    isOnline.value = true
    lastChanged.value = Date.now()
  }

  function handleOffline() {
    isOnline.value = false
    wasOffline.value = true
    lastChanged.value = Date.now()
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
  })

  onUnmounted(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return {
    isOnline,
    wasOffline,
    lastChanged
  }
}
