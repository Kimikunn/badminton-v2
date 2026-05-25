<script setup>
/**
 * Sheet — 底部弹出面板（替代 Modal 作为首选交互容器）
 *
 * @props {boolean} show - 是否显示
 * @props {string} title - 面板标题
 * @props {string} height - auto | half | full
 *
 * @slots default - 面板内容
 * @slots header - 自定义头部
 *
 * @events close - 关闭事件
 */
defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  height: { type: String, default: 'auto', validator: v => ['auto', 'half', 'full'].includes(v) }
})

import { X } from 'lucide-vue-next'

const emit = defineEmits(['close'])

const heightMap = { auto: 'max-h-[90dvh]', half: 'max-h-[50dvh]', full: 'max-h-[90dvh]' }
</script>

<template>
  <Teleport to="body">
    <transition name="sheet-fade">
      <div v-if="show" class="fixed inset-0 z-100 flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="emit('close')">
        <transition name="sheet-slide">
          <div v-if="show" class="w-full max-w-[480px] liquid-sheet flex flex-col overflow-hidden" :class="heightMap[height]">
            <!-- Handle -->
            <div class="w-9 h-[5px] bg-fg-muted/25 rounded-full mx-auto mt-3 mb-1"></div>

            <!-- Header -->
            <div v-if="title || $slots.header" class="flex items-center justify-between px-5 pb-3">
              <h2 class="text-lg font-semibold tracking-tight">{{ title }}</h2>
              <slot name="header"></slot>
              <button class="w-8 h-8 flex items-center justify-center border-none rounded-full bg-surface-hover text-fg-secondary cursor-pointer transition-all duration-fast active:scale-90" @click="emit('close')">
                <X :size="18" />
              </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[calc(var(--space-5) + var(--safe-bottom))]">
              <slot></slot>
            </div>
          </div>
        </transition>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
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

/* iOS 26 Liquid Glass Sheet */
.liquid-sheet {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(48px) saturate(160%);
  -webkit-backdrop-filter: blur(48px) saturate(160%);
  border-radius: 28px 28px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.4);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 -4px 30px rgba(0, 0, 0, 0.08);
}
.dark .liquid-sheet {
  background: rgba(30, 30, 34, 0.65);
  border-top-color: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 -4px 30px rgba(0, 0, 0, 0.35);
}
</style>
