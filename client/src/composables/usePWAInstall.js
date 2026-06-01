import { ref, onMounted } from 'vue'

/**
 * PWA 安装引导 & standalone 检测
 *
 * 提供：
 * - isStandalone: 是否已安装为 PWA（standalone/fullscreen 模式）
 * - canInstall: 浏览器是否支持并可触发安装
 * - showInstallGuide: 是否应显示安装引导（iOS 手动流程）
 * - isIOS: 当前是否为 iOS 设备
 * - install(): 触发安装提示（Android/Desktop Chrome）
 * - dismissInstall(): 用户拒绝后记录，7 天内不再提示
 * - installDismissed: 用户是否已拒绝安装
 *
 * 使用方式：
 * const { isStandalone, canInstall, showInstallGuide, install } = usePWAInstall()
 */
export function usePWAInstall() {
  let deferredPrompt = null

  const isStandalone = ref(false)
  const canInstall = ref(false)
  const installDismissed = ref(false)
  const isIOS = ref(false)

  // ── Standalone 检测 ──
  function checkStandalone() {
    isStandalone.value =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true // iOS Safari
  }

  // ── iOS 检测 ──
  function checkIOS() {
    isIOS.value = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase())
  }

  // ── 已拒绝检测 ──
  function checkDismissed() {
    try {
      const dismissed = localStorage.getItem('pwa-install-dismissed')
      if (dismissed) {
        const dismissedAt = parseInt(dismissed, 10)
        const sevenDays = 7 * 24 * 60 * 60 * 1000
        installDismissed.value = Date.now() - dismissedAt < sevenDays
      }
    } catch {
      // localStorage 不可用
    }
  }

  // ── beforeinstallprompt ──
  function onBeforeInstallPrompt(e) {
    e.preventDefault()
    deferredPrompt = e
    canInstall.value = true
  }

  // ── appinstalled ──
  function onAppInstalled() {
    deferredPrompt = null
    canInstall.value = false
    isStandalone.value = true
  }

  // ── 触发安装 ──
  async function install() {
    if (!deferredPrompt) return false

    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    canInstall.value = false

    if (outcome === 'accepted') {
      return true
    }
    return false
  }

  // ── 拒绝安装 ──
  function dismissInstall() {
    try {
      localStorage.setItem('pwa-install-dismissed', String(Date.now()))
    } catch {
      // ignore
    }
    installDismissed.value = true
    canInstall.value = false
  }

  // ── 是否应显示引导 ──
  // 条件：非 standalone + (iOS 需手动引导 或 Chrome 支持 beforeinstallprompt） + 未被拒绝
  function shouldShowGuide() {
    if (isStandalone.value) return false
    if (installDismissed.value) return false
    // iOS 总是可以显示手动引导（因为不触发 beforeinstallprompt）
    // Android/Desktop 需要 beforeinstallprompt 已触发
    return isIOS.value || canInstall.value
  }

  onMounted(() => {
    checkStandalone()
    checkIOS()
    checkDismissed()

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
  })

  return {
    isStandalone,
    canInstall,
    isIOS,
    installDismissed,
    install,
    dismissInstall,
    shouldShowGuide
  }
}
