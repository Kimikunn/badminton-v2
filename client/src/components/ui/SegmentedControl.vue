<script setup>
/**
 * SegmentedControl — Apple-style segmented control
 * Variants:
 *   default — rounded pill bg with sliding active indicator (used for main tabs)
 *   underline — bottom border indicator (used for sub-tabs in S4 rankings)
 */
const model = defineModel({ type: String, required: true })

defineProps({
  options: { type: Array, required: true },  // [{ key, label }]
  size: { type: String, default: 'md' },     // sm | md
  variant: { type: String, default: 'default' } // default | underline
})
</script>

<template>
  <!-- Default variant: bg-surface container with sliding indicator -->
  <div
    v-if="variant === 'default'"
    class="flex gap-1 bg-surface rounded-lg p-[3px] border border-line-light"
  >
    <button
      v-for="opt in options"
      :key="opt.key"
      class="flex-1 border-none bg-none rounded-md text-sm cursor-pointer font-medium transition-all duration-fast"
      :class="[
        size === 'sm' ? 'p-2' : 'p-2.5',
        model === opt.key ? 'bg-canvas text-fg shadow-sm' : 'bg-transparent text-fg-secondary'
      ]"
      @click="model = opt.key"
    >
      {{ opt.label }}
    </button>
  </div>

  <!-- Underline variant: bottom border indicator -->
  <div
    v-else
    class="flex gap-1 border-b border-line-light"
  >
    <button
      v-for="opt in options"
      :key="opt.key"
      class="flex-1 border-none bg-none rounded-none text-sm cursor-pointer font-medium transition-all duration-fast"
      :class="[
        size === 'sm' ? 'p-2' : 'p-2.5',
        model === opt.key
          ? 'text-fg border-b-2 border-accent'
          : 'text-fg-secondary'
      ]"
      @click="model = opt.key"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
