<script setup>
/**
 * Card — 卡片容器
 *
 * @props {string} padding - sm | md | lg | none
 * @props {boolean} clickable - 是否有点击反馈
 *
 * @slots default - 卡片内容
 * @slots header - 卡片头部
 * @slots footer - 卡片底部
 *
 * @events click - 点击事件（clickable 时）
 */
const props = defineProps({
  padding: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg', 'none'].includes(v) },
  clickable: { type: Boolean, default: false }
})

defineEmits(['click'])

const padClasses = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
  none: 'p-0'
}
</script>

<template>
  <div
    class="liquid-card overflow-hidden transition-[transform,box-shadow] duration-fast ease-out"
    :class="[padClasses[padding], { 'cursor-pointer active:scale-[0.98]': clickable }]"
    @click="clickable && $emit('click')"
  >
    <div v-if="$slots.header" class="px-5 py-4 border-b border-line-light/50">
      <slot name="header"></slot>
    </div>
    <slot></slot>
    <div v-if="$slots.footer" class="px-5 py-4 border-t border-line-light/50">
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* iOS 26 Liquid Glass Card */
.liquid-card {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-xl);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 4px 20px rgba(0, 0, 0, 0.05);
}
.dark .liquid-card {
  background: rgba(40, 40, 45, 0.45);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 4px 20px rgba(0, 0, 0, 0.25);
}
</style>
