<script setup>
/**
 * RankMedal — 排名奖牌图标
 * Replaces 🥇🥈🥉 emojis with Lucide Award icons in rank colors
 */
defineProps({ rank: { type: Number, required: true } })
</script>

<template>
  <span class="rank-medal" :class="'medal-' + rank">
    <svg v-if="rank <= 3" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="8" r="6"/>
      <path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/>
    </svg>
    <span v-else class="medal-number">#{{ rank }}</span>
  </span>
</template>

<style scoped>
.rank-medal { display: inline-flex; align-items: center; justify-content: center; min-width: var(--icon-xl); text-align: center; }
.medal-1 { color: var(--color-s4-gold); filter: drop-shadow(0 1px 2px var(--color-s4-gold-light)); }
.medal-2 { color: var(--color-medal-silver); filter: drop-shadow(0 1px 2px oklch(0.75 0.02 240 / 0.2)); }
.medal-3 { color: var(--color-medal-bronze); filter: drop-shadow(0 1px 2px oklch(0.70 0.10 55 / 0.2)); }
.medal-number { font-size: var(--text-sm); font-weight: var(--weight-bold); font-family: var(--font-mono); color: var(--color-text-muted); }
</style>
