<script setup>
/**
 * Badge — 标签/徽章
 *
 * @props {string} variant - accent | success | warning | danger | muted | gold | purple | blue | green
 * @props {string} size - sm | md
 */
defineProps({
  variant: { type: String, default: 'accent' },
  size: { type: String, default: 'md', validator: v => ['sm', 'md'].includes(v) }
})

const variantClasses = {
  accent:  'bg-accent-subtle text-accent',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger:  'bg-danger-subtle text-danger',
  muted:   'bg-surface-hover text-fg-muted',
  gold:    'bg-badge-gold-bg text-badge-gold',
  purple:  'bg-badge-purple-bg text-badge-purple',
  blue:    'bg-badge-blue-bg text-badge-blue',
  green:   'bg-badge-green-bg text-badge-green'
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full font-medium whitespace-nowrap leading-none"
    :class="[
      variantClasses[variant],
      size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
    ]"
  >
    <slot></slot>
  </span>
</template>
