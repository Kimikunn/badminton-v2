import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Service Worker 更新通知
 *
 * 配合 vite-plugin-pwa 的 registerType: 'autoUpdate' 使用。
 * 检测新 SW 激活后，提示用户刷新页面以获取最新资源。
 *
 * 提供：
 * - updateReady: 是否有新版本已就绪（刷新后生效）
 * - refreshApp(): 刷新页面
 *
 * 使用方式：
 * const { updateReady, refreshApp } = useSWUpdate()
 */
export function useSWUpdate() {
  const updateReady = ref(false)
  let controllerChangeHandler = null

  function refreshApp() {
    window.location.reload()
  }

  function onControllerChange() {
    // 新的 SW 已接管页面，但页面 JS/CSS 仍是旧版本
    // 提示用户刷新以加载新资源
    updateReady.value = true
  }

  function checkWaitingWorker() {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then((reg) => {
      // 检查是否有 waiting 状态的 SW（说明已有更新待激活）
      // autoUpdate 模式下 skipWaiting 会立即激活，所以这里主要兜底
      if (reg.waiting) {
        updateReady.value = true
      }
      // 监听新 SW 安装事件
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          // autoUpdate 模式：SW 会在 installed 后立即 skipWaiting → activating → activated
          // 我们在 activated 时通过 controllerchange 通知
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 已有旧 SW 在控制页面 → 这是更新
            // skipWaiting 会立即触发，controllerchange 随后处理
          }
        })
      })
    })
  }

  onMounted(() => {
    if (!('serviceWorker' in navigator)) return

    // 监听 SW 接管事件
    controllerChangeHandler = onControllerChange
    navigator.serviceWorker.addEventListener('controllerchange', controllerChangeHandler)

    // 兜底检查
    checkWaitingWorker()
  })

  onUnmounted(() => {
    if (controllerChangeHandler) {
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChangeHandler)
    }
  })

  return {
    updateReady,
    refreshApp
  }
}
