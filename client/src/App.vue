<script setup>
import { computed, defineAsyncComponent, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Home, Swords, Trophy, MapPin, ParkingCircle, Sun, Moon, SunMoon, FlaskConical } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'
import { useAppInit } from '@/composables/useAppInit'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useSWUpdate } from '@/composables/useSWUpdate'
import { usePWAInstall } from '@/composables/usePWAInstall'
import { useToast } from '@/composables/useToast'

const isTestMode = import.meta.env.VITE_TEST_MODE === 'true'
import ToastContainer from '@/components/ui/ToastContainer.vue'
import ConfirmSheet from '@/components/ui/ConfirmSheet.vue'
import AdminTokenSheet from '@/components/ui/AdminTokenSheet.vue'

const AdminToolsSheet = isTestMode
  ? defineAsyncComponent(() => import('@/components/admin/AdminToolsSheet.vue'))
  : null

const route = useRoute()
const router = useRouter()
const { isDark, themeMode, initTheme, destroyTheme, toggleTheme } = useTheme()
const { isInitialized, isInitializing, initError, initAllStores } = useAppInit()
const { activeSeasonId } = useSeasonTheme()
const { isOnline, wasOffline } = useOnlineStatus()
const { updateReady, refreshApp } = useSWUpdate()
const { isStandalone, canInstall, isIOS, install, dismissInstall, shouldShowGuide } = usePWAInstall()
const toast = useToast()

// 安装引导显示状态
const showInstallGuide = ref(false)

// 延迟弹出安装引导（首次加载 5 秒后，仅当非 standalone 时）
onMounted(() => {
  if (!isStandalone.value) {
    setTimeout(() => {
      if (shouldShowGuide()) {
        showInstallGuide.value = true
      }
    }, 5000)
  }
})

function handleDismissInstall() {
  dismissInstall()
  showInstallGuide.value = false
}

// ── 在线/离线状态 → Toast ──
let offlineToastId = null
watch(isOnline, (online) => {
  if (!online) {
    offlineToastId = toast.show('当前处于离线状态', 'error', 0)
  } else if (offlineToastId !== null) {
    toast.remove(offlineToastId)
    offlineToastId = null
    if (wasOffline.value) {
      toast.show('网络已恢复', 'success', 2500)
    }
  }
})

// ── SW 更新就绪 → 可点击刷新的 Toast ──
let updateToastId = null
watch(updateReady, (ready) => {
  if (ready && updateToastId === null) {
    updateToastId = toast.show('新版本已就绪，点击刷新', 'info', 0, () => {
      updateToastId = null
      refreshApp()
    })
  }
})

const showParking = ref(false)
const showDebug = ref(false)
const parkingPayUrl = 'https://s.keytop.cn/ra7ttv'
const alipayUrl = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(parkingPayUrl)}`

const showTab = computed(() => !route.meta.hideTab)

// ── Page transition ──
// depth 0 (tab pages): fade
// depth > 0 (detail pages): slide
const transitionName = ref('fade')
watch(route, (to, from) => {
  const toDepth = to.meta.depth ?? 0
  const fromDepth = from.meta.depth ?? 0
  if (toDepth > fromDepth) {
    transitionName.value = 'slide-left'
  } else if (toDepth < fromDepth) {
    transitionName.value = 'slide-right'
  } else {
    transitionName.value = 'fade'
  }
})

// ── Scroll-based header hide ──
const headerHidden = ref(false)
let lastScrollY = 0
let ticking = false

function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    const y = window.scrollY
    // Only hide on detail pages (depth > 0)
    const isDetailPage = (route.meta.depth ?? 0) > 0
    if (!isDetailPage) {
      headerHidden.value = false
    } else {
      const delta = y - lastScrollY
      if (delta > 8 && y > 60) {
        headerHidden.value = true
      } else if (delta < -5) {
        headerHidden.value = false
      }
    }
    lastScrollY = y
    ticking = false
  })
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  destroyTheme()
})

// Reset header on route change
watch(route, () => {
  headerHidden.value = false
  lastScrollY = 0
})

const tabs = [
  { key: 'home', label: '首页', icon: Home, route: '/' },
  { key: 'matches', label: '比赛', icon: Swords, route: '/matches' },
  { key: 'rankings', label: '积分榜', icon: Trophy, route: '/rankings' },
  { key: 'venues', label: '场地', icon: MapPin, route: '/venues' }
]

const activeTab = computed(() => {
  const tab = route.meta.tab
  if (tab) return tab
  return 'home'
})

const handleTabClick = (tab) => {
  if (tab.key === activeTab.value) return
  router.push(tab.route)
}

onMounted(async () => {
  initTheme()
  try {
    await initAllStores()
  } catch (err) {
    console.error('Init failed:', err)
  }
})
</script>

<template>
  <div class="app-shell min-h-dvh bg-canvas text-fg" :class="{ dark: isDark }">
    <!-- Loading -->
    <div v-if="isInitializing" class="flex flex-col items-center justify-center min-h-dvh gap-4 text-fg-secondary">
      <div class="w-8 h-8 border-[3px] border-line border-t-[var(--color-accent)] rounded-full animate-spin"></div>
      <p class="text-sm text-fg-muted">加载中...</p>
    </div>

    <!-- App -->
    <template v-else>
      <!-- Header — iOS 26 Liquid Glass -->
      <header
        class="sticky top-0 z-50 flex items-center justify-between px-4 transition-transform duration-300 ease-out liquid-header"
        :class="headerHidden ? '-translate-y-full' : 'translate-y-0'"
        style="padding-top: env(safe-area-inset-top, 0px); min-height: calc(var(--header-height) + env(safe-area-inset-top, 0px))"
      >
        <h1 class="text-base italic tracking-wide flex items-center gap-2" style="font-family: 'Playfair Display', serif;">
          The&nbsp;Plume&nbsp;Championship
          <span v-if="isTestMode" class="text-3xs font-mono font-normal px-1.5 py-0.5 rounded-full bg-warning-subtle text-warning border border-warning/30">TEST</span>
        </h1>
        <div class="flex gap-2">
          <button
            v-if="isTestMode"
            class="w-9 h-9 flex items-center justify-center border-none rounded-full bg-warning-subtle text-warning cursor-pointer transition-all duration-fast ease-out active:scale-90"
            @click="showDebug = true"
            title="测试工具"
          >
            <FlaskConical :size="18" />
          </button>
          <button
            class="w-9 h-9 flex items-center justify-center border-none rounded-full bg-surface-hover text-fg-secondary cursor-pointer transition-all duration-fast ease-out active:scale-90 active:bg-line"
            @click="showParking = true"
            title="停车缴费"
          >
            <ParkingCircle :size="18" />
          </button>
          <button
            class="w-9 h-9 flex items-center justify-center border-none rounded-full bg-surface-hover text-fg-secondary cursor-pointer transition-all duration-fast ease-out active:scale-90 active:bg-line"
            @click="toggleTheme"
            :title="themeMode"
          >
            <SunMoon v-if="themeMode === 'auto'" :size="18" />
            <Moon v-else-if="isDark" :size="18" />
            <Sun v-else :size="18" />
          </button>
        </div>
      </header>

      <!-- Content — extra bottom padding for floating tab bar -->
      <main class="p-4" :class="{ 'pb-[calc(80px+var(--safe-bottom))]': showTab }">
        <router-view v-slot="{ Component }">
          <transition :name="transitionName" mode="out-in">
            <component :is="Component" :key="route.path" />
          </transition>
        </router-view>
      </main>

      <!-- TabBar — iOS 26 Liquid Glass floating capsule -->
      <nav v-if="showTab" class="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center safe-bottom">
        <div class="liquid-tabbar pointer-events-auto">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="tab-btn"
            :class="{ 'tab-active': activeTab === tab.key }"
            @click="handleTabClick(tab)"
          >
            <component :is="tab.icon" :size="20" />
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </nav>
    </template>

    <ToastContainer />
    <ConfirmSheet />
    <AdminTokenSheet />

    <!-- Parking sheet -->
    <Teleport to="body">
      <transition name="sheet-fade">
        <div v-if="showParking" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showParking = false">
          <transition name="sheet-slide">
            <div v-if="showParking" class="w-full max-w-[480px] liquid-sheet px-5 pt-4 pb-[calc(var(--space-5) + var(--safe-bottom))]">
              <!-- Handle -->
              <div class="w-8 h-1 bg-fg-muted/25 rounded-full mx-auto mb-4"></div>
              <h3 class="text-lg font-semibold mb-4 text-center">停车缴费</h3>
              <!-- Brand color: Alipay #1677FF -->
              <a :href="alipayUrl" class="block w-full py-3 rounded-lg text-center font-medium text-white border-none cursor-pointer bg-[#1677FF] mb-2 transition-transform duration-fast active:scale-[0.97]">川体支付宝缴费</a>
              <!-- Brand color: WeChat #07C160 -->
              <a :href="parkingPayUrl" target="_blank" class="block w-full py-3 rounded-lg text-center font-medium text-white border-none cursor-pointer bg-[#07C160] mb-2 transition-transform duration-fast active:scale-[0.97]">川体小程序缴费</a>
              <button aria-label="关闭停车缴费" class="block w-full py-3 rounded-lg text-center font-medium border-none cursor-pointer bg-surface-hover text-fg-secondary transition-transform duration-fast active:scale-[0.97]" @click="showParking = false">关闭</button>
            </div>
          </transition>
        </div>
      </transition>
    </Teleport>

    <AdminToolsSheet v-if="isTestMode && AdminToolsSheet" :show="showDebug" @close="showDebug = false" />

    <!-- PWA 安装引导 Sheet -->
    <Teleport to="body">
      <transition name="sheet-fade">
        <div v-if="showInstallGuide" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="handleDismissInstall">
          <transition name="sheet-slide">
            <div v-if="showInstallGuide" class="w-full max-w-[480px] liquid-sheet px-5 pt-4 pb-[calc(var(--space-5)+var(--safe-bottom))]">
              <div class="w-8 h-1 bg-fg-muted/25 rounded-full mx-auto mb-4"></div>

              <h3 class="text-lg font-semibold mb-2 text-center">添加到主屏幕</h3>
              <p class="text-sm text-fg-muted text-center mb-4 leading-relaxed">
                安装到手机桌面，像 App 一样快速打开，支持离线使用
              </p>

              <!-- iOS 安装说明 -->
              <div v-if="isIOS" class="flex flex-col gap-3 mb-4">
                <div class="flex items-center gap-3 p-3 rounded-xl bg-surface-hover">
                  <div class="w-9 h-9 flex items-center justify-center rounded-full bg-accent text-white font-semibold text-sm shrink-0">1</div>
                  <span class="text-sm">点击 Safari 底部 <span class="font-semibold">分享按钮</span> <span class="text-fg-muted">⎋</span></span>
                </div>
                <div class="flex items-center gap-3 p-3 rounded-xl bg-surface-hover">
                  <div class="w-9 h-9 flex items-center justify-center rounded-full bg-accent text-white font-semibold text-sm shrink-0">2</div>
                  <span class="text-sm">向下滑动，点击 <span class="font-semibold">「添加到主屏幕」</span></span>
                </div>
                <div class="flex items-center gap-3 p-3 rounded-xl bg-surface-hover">
                  <div class="w-9 h-9 flex items-center justify-center rounded-full bg-accent text-white font-semibold text-sm shrink-0">3</div>
                  <span class="text-sm">点击右上角 <span class="font-semibold">「添加」</span> 完成安装</span>
                </div>
              </div>

              <!-- Android/Desktop 安装按钮 -->
              <button
                v-if="canInstall"
                class="block w-full py-3 rounded-lg text-center font-medium text-white border-none cursor-pointer bg-accent mb-2 transition-transform duration-fast active:scale-[0.97]"
                @click="install(); showInstallGuide = false"
              >
                立即安装
              </button>

              <button
                class="block w-full py-3 rounded-lg text-center font-medium border-none cursor-pointer bg-surface-hover text-fg-secondary transition-transform duration-fast active:scale-[0.97]"
                @click="handleDismissInstall"
              >
                暂不需要
              </button>
            </div>
          </transition>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Page transitions ── */

/* Fade: same-level tab switches */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 150ms ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Slide-left: navigating into detail page */
.slide-left-enter-active {
  transition: transform 250ms ease-out, opacity 250ms ease-out;
}
.slide-left-leave-active {
  transition: transform 150ms ease-in, opacity 150ms ease-in;
}
.slide-left-enter-from {
  transform: translateX(30%);
  opacity: 0;
}
.slide-left-leave-to {
  transform: translateX(-20%);
  opacity: 0;
}

/* Slide-right: navigating back from detail page */
.slide-right-enter-active {
  transition: transform 250ms ease-out, opacity 250ms ease-out;
}
.slide-right-leave-active {
  transition: transform 150ms ease-in, opacity 150ms ease-in;
}
.slide-right-enter-from {
  transform: translateX(-20%);
  opacity: 0;
}
.slide-right-leave-to {
  transform: translateX(30%);
  opacity: 0;
}

/* ── Sheet transitions (parking) ── */
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}
.sheet-slide-enter-active {
  transition: transform var(--duration-normal) var(--ease-out);
}
.sheet-slide-leave-active {
  transition: transform var(--duration-fast) var(--ease-in-out);
}
.sheet-slide-enter-from,
.sheet-slide-leave-to {
  transform: translateY(100%);
}

/* ── iOS 26 Liquid Glass ── */

/* Header: floating glass with subtle inner glow */
.liquid-header {
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 1px 3px rgba(0, 0, 0, 0.04);
}
.dark .liquid-header {
  background: rgba(30, 30, 34, 0.35);
  border-bottom-color: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Floating capsule tab bar */
.liquid-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 56px;
  padding: 4px;
  margin-bottom: 8px;
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.20);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.3),
    0 8px 32px rgba(0, 0, 0, 0.1);
  transition: transform var(--duration-normal) var(--ease-out);
}
.dark .liquid-tabbar {
  background: rgba(35, 35, 40, 0.45);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.06),
    0 8px 32px rgba(0, 0, 0, 0.35);
}

/* Tab button inside capsule */
.tab-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 64px;
  height: 48px;
  padding: 0 10px;
  border: none;
  border-radius: 24px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: all var(--duration-fast) var(--ease-out);
  position: relative;
}
.tab-btn:active {
  transform: scale(0.92);
}

/* Active tab: filled capsule pill */
.tab-btn.tab-active {
  background: rgba(255, 255, 255, 0.55);
  color: var(--color-accent);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}
.dark .tab-btn.tab-active {
  background: rgba(255, 255, 255, 0.14);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

/* Spinner */
@keyframes spin {
  to { transform: rotate(360deg); }
}
.animate-spin {
  animation: spin 0.8s linear infinite;
}
</style>
