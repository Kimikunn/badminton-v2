<script setup>
/**
 * ScoreBoard — 记分板组件
 *
 * The core scoring interaction: two large touch targets that increment on tap.
 * Designed for single-thumb operation during live games.
 *
 * @props {string} teamAName - A 队名称
 * @props {string} teamBName - B 队名称
 * @props {number} scoreA - A 队当前局得分
 * @props {number} scoreB - B 队当前局得分
 * @props {number} gamesA - A 队已赢局数
 * @props {number} gamesB - B 队已赢局数
 * @props {number} bestOf - 总局数
 * @props {boolean} interactive - 是否可操作（记分中）
 * @props {boolean} disabled - 是否禁用操作（等待/暂停中）
 *
 * @events score-a - A 队得分
 * @events score-b - B 队得分
 * @events undo-a - A 队撤销
 * @events undo-b - B 队撤销
 */
defineProps({
  teamAName: { type: String, default: 'A队' },
  teamBName: { type: String, default: 'B队' },
  scoreA: { type: Number, default: 0 },
  scoreB: { type: Number, default: 0 },
  gamesA: { type: Number, default: 0 },
  gamesB: { type: Number, default: 0 },
  bestOf: { type: Number, default: 3 },
  interactive: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['score-a', 'score-b', 'undo-a', 'undo-b'])
</script>

<template>
  <div class="flex items-center justify-center gap-4 py-6">
    <!-- Team A -->
    <div class="team-section flex flex-col items-center gap-3 flex-1 max-w-[160px]">
      <div v-if="interactive" class="flex gap-1.5">
        <span v-for="i in (bestOf === 7 ? 7 : Math.ceil(bestOf / 2))" :key="'ga-'+i"
          class="w-2.5 h-2.5 rounded-full transition-colors duration-fast ease-out"
          :class="i <= gamesA ? 'bg-accent' : 'bg-line'">
        </span>
      </div>
      <button
        class="w-full aspect-square max-w-[140px] bg-surface border-2 border-line rounded-2xl flex items-center justify-center select-none -webkit-tap-highlight-color-transparent transition-all duration-fast ease-out active:scale-95 active:border-accent active:bg-accent-subtle disabled:pointer-events-none disabled:opacity-70 shadow-sm active:shadow-none"
        :disabled="disabled"
        @click="emit('score-a')"
      >
        <span class="text-5xl font-extrabold font-display text-fg leading-none transition-transform duration-fast ease-out" :class="{'scale-110': !disabled}">{{ scoreA }}</span>
      </button>
      <span class="text-base font-semibold text-fg text-center">{{ teamAName }}</span>
      <button
        v-if="interactive && scoreA > 0"
        class="undo-btn w-8 h-8 border-none rounded-full flex items-center justify-center bg-surface-hover text-fg-muted text-sm cursor-pointer -webkit-tap-highlight-color-transparent transition-all duration-fast ease-out hover:opacity-100 active:scale-90 active:bg-warning-subtle active:text-warning shadow-sm"
        @click="emit('undo-a')"
        title="撤销"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 2.1-5.3L3 7"/></svg>
      </button>
    </div>

    <!-- VS Divider -->
    <div class="flex flex-col items-center justify-center shrink-0">
      <span class="text-sm font-bold text-fg-muted uppercase tracking-widest">VS</span>
    </div>

    <!-- Team B -->
    <div class="team-section flex flex-col items-center gap-3 flex-1 max-w-[160px]">
      <div v-if="interactive" class="flex gap-1.5">
        <span v-for="i in (bestOf === 7 ? 7 : Math.ceil(bestOf / 2))" :key="'gb-'+i"
          class="w-2.5 h-2.5 rounded-full transition-colors duration-fast ease-out"
          :class="i <= gamesB ? 'bg-accent' : 'bg-line'">
        </span>
      </div>
      <button
        class="w-full aspect-square max-w-[140px] bg-surface border-2 border-line rounded-2xl flex items-center justify-center select-none -webkit-tap-highlight-color-transparent transition-all duration-fast ease-out active:scale-95 active:border-accent active:bg-accent-subtle disabled:pointer-events-none disabled:opacity-70 shadow-sm active:shadow-none"
        :disabled="disabled"
        @click="emit('score-b')"
      >
        <span class="text-5xl font-extrabold font-display text-fg leading-none transition-transform duration-fast ease-out" :class="{'scale-110': !disabled}">{{ scoreB }}</span>
      </button>
      <span class="text-base font-semibold text-fg text-center">{{ teamBName }}</span>
      <button
        v-if="interactive && scoreB > 0"
        class="undo-btn w-8 h-8 border-none rounded-full flex items-center justify-center bg-surface-hover text-fg-muted text-sm cursor-pointer -webkit-tap-highlight-color-transparent transition-all duration-fast ease-out hover:opacity-100 active:scale-90 active:bg-warning-subtle active:text-warning shadow-sm"
        @click="emit('undo-b')"
        title="撤销"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 2.1-5.3L3 7"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Only what Tailwind can't express: hover on parent activates child undo button */
.team-section:hover .undo-btn {
  opacity: 1;
}
</style>
