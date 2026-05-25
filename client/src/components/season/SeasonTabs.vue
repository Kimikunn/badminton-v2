<script setup>
import { computed } from 'vue'
import { useSeasonTheme } from '@/composables/useSeasonTheme'

const props = defineProps({
  seasons: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' }
})

const emit = defineEmits(['select'])
const { getSeasonColor } = useSeasonTheme()

const visibleSeasons = computed(() => props.seasons || [])

function dotStyle(season) {
  return { '--season-tab-color': getSeasonColor(season.color).light }
}
</script>

<template>
  <div v-if="visibleSeasons.length > 1" class="season-tabs">
    <button
      v-for="season in visibleSeasons"
      :key="season.id"
      class="season-tab"
      :class="{ active: selectedId === season.id }"
      :aria-pressed="selectedId === season.id"
      @click="emit('select', season.id)"
    >
      <span class="season-tab-dot" :class="{ active: selectedId === season.id }" :style="dotStyle(season)">
        <span></span>
      </span>
      <span class="season-tab-label">{{ season.name }}</span>
    </button>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

.season-tabs {
  @apply flex gap-2 overflow-x-auto;
}

.season-tab {
  @apply shrink-0 px-4 py-2 rounded-full border border-line bg-surface text-sm text-fg-secondary cursor-pointer flex items-center gap-1.5 transition-colors duration-fast;
}

.season-tab.active {
  @apply bg-accent text-fg-inverse border-accent;
}

.season-tab-dot {
  width: 10px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0;
  border-radius: var(--radius-full);
  border: 1px solid oklch(1 0 0 / 0.35);
  transition: width var(--duration-fast) var(--ease-out),
    height var(--duration-fast) var(--ease-out),
    padding var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.season-tab-dot span {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: inherit;
  background: var(--season-tab-color);
}

.season-tab-dot.active {
  width: 12px;
  height: 12px;
  padding: 2px;
  border-color: oklch(1 0 0 / 0.45);
  background: var(--color-text-inverse);
  box-shadow: 0 0 0 1px oklch(0 0 0 / 0.08);
}

.season-tab-dot.active span {
  background: var(--color-text-inverse);
}

.season-tab-label {
  white-space: nowrap;
}
</style>
