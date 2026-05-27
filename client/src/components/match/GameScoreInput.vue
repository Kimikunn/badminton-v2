<script setup>
import { computed } from 'vue'

const props = defineProps({
  scoreA: { type: Number, default: 0 },
  scoreB: { type: Number, default: 0 },
  matchScore: { type: Object, required: true },
  teamAPlayers: { type: Array, default: () => [] },
  teamBPlayers: { type: Array, default: () => [] },
  bestOf: { type: Number, default: 3 },
  maxScore: { type: Number, default: 30 },
  hasCurrentGame: { type: Boolean, default: false },
  isMatchOver: { type: Boolean, default: false },
  borderClass: { type: String, default: 'border-line' }
})

const emit = defineEmits(['update:scoreA', 'update:scoreB'])

const localScoreA = computed({
  get: () => props.scoreA,
  set: value => emit('update:scoreA', value)
})

const localScoreB = computed({
  get: () => props.scoreB,
  set: value => emit('update:scoreB', value)
})

const canInput = computed(() => props.hasCurrentGame && !props.isMatchOver)
</script>

<template>
  <div class="flex items-center justify-center gap-3 py-4">
    <div class="flex flex-col items-center gap-2 flex-1 max-w-[140px]">
      <div class="flex gap-1.5">
        <span
          v-for="i in (bestOf === 7 ? 7 : Math.ceil(bestOf / 2))"
          :key="'a'+i"
          class="w-2.5 h-2.5 rounded-full transition-colors duration-fast"
          :class="i <= matchScore.scoreA ? 'bg-accent' : 'bg-line'"
        />
      </div>
      <div
        class="w-full aspect-square max-w-[120px] rounded-2xl bg-surface border-2 flex items-center justify-center shadow-sm transition-colors duration-fast"
        :class="borderClass"
      >
        <input
          v-if="canInput"
          v-model.number="localScoreA"
          type="number"
          class="score-input"
          min="0"
          :max="maxScore"
        />
        <span v-else class="text-5xl font-extrabold font-display text-fg">{{ scoreA }}</span>
      </div>
      <div class="flex flex-col items-center gap-px">
        <span v-for="name in teamAPlayers" :key="name" class="text-sm font-medium text-fg">{{ name }}</span>
      </div>
    </div>

    <div class="shrink-0"><span class="text-xs font-bold text-fg-muted tracking-widest">VS</span></div>

    <div class="flex flex-col items-center gap-2 flex-1 max-w-[140px]">
      <div class="flex gap-1.5">
        <span
          v-for="i in (bestOf === 7 ? 7 : Math.ceil(bestOf / 2))"
          :key="'b'+i"
          class="w-2.5 h-2.5 rounded-full transition-colors duration-fast"
          :class="i <= matchScore.scoreB ? 'bg-accent' : 'bg-line'"
        />
      </div>
      <div
        class="w-full aspect-square max-w-[120px] rounded-2xl bg-surface border-2 flex items-center justify-center shadow-sm transition-colors duration-fast"
        :class="borderClass"
      >
        <input
          v-if="canInput"
          v-model.number="localScoreB"
          type="number"
          class="score-input"
          min="0"
          :max="maxScore"
        />
        <span v-else class="text-5xl font-extrabold font-display text-fg">{{ scoreB }}</span>
      </div>
      <div class="flex flex-col items-center gap-px">
        <span v-for="name in teamBPlayers" :key="name" class="text-sm font-medium text-fg">{{ name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

.score-input {
  width: 80%;
  border: none;
  background: transparent;
  font-size: var(--text-5xl);
  font-weight: var(--weight-extrabold);
  font-family: var(--font-display);
  text-align: center;
  color: var(--color-text);
  outline: none;
  -moz-appearance: textfield;
}

.score-input::-webkit-outer-spin-button,
.score-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
</style>
