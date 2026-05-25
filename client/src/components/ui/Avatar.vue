<script setup>
/**
 * Avatar — 头像组件
 *
 * @props {string} src - 图片 URL
 * @props {string} name - 名称（用于生成首字母 fallback）
 * @props {string} size - sm | md | lg | xl
 */
defineProps({
  src: { type: String, default: null },
  name: { type: String, default: '' },
  size: { type: String, default: 'md', validator: v => ['sm', 'md', 'lg', 'xl'].includes(v) }
})

function getInitial(name) {
  return name ? name[0] : '?'
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl'
}
</script>

<template>
  <div
    class="flex items-center justify-center rounded-full overflow-hidden shrink-0 font-semibold select-none"
    :class="[sizeClasses[size], 'bg-[linear-gradient(135deg,var(--color-accent),var(--color-avatar-fallback-end))] text-fg-inverse']"
  >
    <img v-if="src" :src="src" :alt="name" class="w-full h-full object-cover" />
    <span v-else>{{ getInitial(name) }}</span>
  </div>
</template>
