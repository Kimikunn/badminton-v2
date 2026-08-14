<script setup>
/**
 * DiceChip — 骰子点数芯片
 * 用数字代替 Unicode 骰面字符（⚀-⚅），避免部分 Android 字体缺字形显示为方框。
 * @props {number} value - 点数 1-6
 * @props {string} size - sm | md（默认 sm）
 */
defineProps({
  value: { type: Number, required: true },
  size: { type: String, default: 'sm' }
})
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-md border border-line bg-surface font-mono font-semibold text-fg shrink-0"
    :class="size === 'md' ? 'w-7 h-7 text-sm' : 'w-5 h-5 text-xs'"
  >{{ value }}</span>
</template>
