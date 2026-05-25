<script setup>
/**
 * ToastContainer — Toast 渲染容器
 * 挂载在 App.vue 中，全局单例
 */
import { useToast } from '@/composables/useToast'
const { toasts, remove } = useToast()
</script>

<template>
  <Teleport to="body">
    <div v-if="toasts.length > 0" class="fixed top-[calc(var(--header-height)+var(--space-3))] left-1/2 -translate-x-1/2 z-200 flex flex-col gap-2 pointer-events-none w-[calc(100%-var(--space-8))] max-w-[400px]">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="px-4 py-3 rounded-xl text-sm font-medium text-center pointer-events-auto cursor-pointer backdrop-blur-xl shadow-lg -webkit-tap-highlight-color-transparent transition-transform duration-fast active:scale-[0.97]"
          :class="{
            'bg-toast-bg text-toast-text': toast.type === 'info',
            'bg-toast-success-bg text-fg-inverse': toast.type === 'success',
            'bg-toast-error-bg text-fg-inverse': toast.type === 'error'
          }"
          @click="remove(toast.id)"
        >
          <span>{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: all var(--duration-normal) var(--ease-out);
}
.toast-leave-active {
  transition: all var(--duration-fast) var(--ease-in-out);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(calc(-1 * var(--space-2))) scale(0.95);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(var(--space-1)) scale(0.95);
}
</style>
