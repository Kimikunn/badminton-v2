<script setup>
/**
 * Button — 原子按钮组件
 *
 * @props {string} variant - primary | secondary | danger | ghost
 * @props {string} size - sm | md | lg
 * @props {boolean} loading - 加载中状态
 * @props {boolean} disabled - 禁用状态
 * @props {boolean} block - 撑满宽度
 *
 * @slots default - 按钮文字
 * @slots prefix - 前置图标
 * @slots suffix - 后缀图标
 *
 * @events click - 点击事件
 */
const props = defineProps({
  variant: { type: String, default: 'primary', validator: v => ['primary', 'secondary', 'danger', 'ghost'].includes(v) },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg'].includes(v) },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  block: { type: Boolean, default: false }
})

defineEmits(['click'])

const sizeClasses = {
  sm: 'px-3 h-8 text-sm rounded-md',
  md: 'px-4 h-10 text-base rounded-lg',
  lg: 'px-6 h-12 text-lg rounded-lg'
}

const variantClasses = {
  primary: 'bg-accent text-fg-inverse active:bg-accent-hover',
  secondary: 'bg-surface-hover text-fg active:bg-line',
  danger: 'bg-danger text-fg-inverse active:bg-danger-hover',
  ghost: 'bg-transparent text-fg-secondary active:bg-surface-hover'
}
</script>

<template>
  <button
    class="inline-flex items-center justify-center gap-2 border-none font-sans font-medium cursor-pointer select-none -webkit-tap-highlight-color-transparent transition-all duration-fast ease-out active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none shadow-sm active:shadow-none"
    :class="[variantClasses[variant], sizeClasses[size], { 'w-full': block }]"
    :disabled="disabled || loading"
    @click="$emit('click')"
  >
    <span v-if="loading" class="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin-button"></span>
    <slot v-else name="prefix"></slot>
    <span><slot></slot></span>
    <slot name="suffix"></slot>
  </button>
</template>

<style scoped>
@keyframes spin-button { to { transform: rotate(360deg); } }
.animate-spin-button { animation: spin-button 0.6s linear infinite; }
</style>
