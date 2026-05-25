<script setup>
/**
 * Skeleton — 骨架屏加载占位
 * Apple-style shimmer effect
 *
 * @props {string} variant - text | circle | rect
 * @props {string} width - CSS 宽度
 * @props {string} height - CSS 高度
 */
defineProps({
  variant: { type: String, default: 'text', validator: v => ['text', 'circle', 'rect'].includes(v) },
  width: { type: String, default: '100%' },
  height: { type: String, default: '16px' }
})
</script>

<template>
  <div
    class="animate-shimmer"
    :class="{
      'rounded-sm': variant === 'text',
      'rounded-full': variant === 'circle',
      'rounded-md': variant === 'rect'
    }"
    :style="{ width, height }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
/* Shimmer gradient — can't express in Tailwind */
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.animate-shimmer {
  background: linear-gradient(
    90deg,
    var(--color-border) 25%,
    var(--color-border-light) 50%,
    var(--color-border) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
</style>
