<script setup>
/**
 * RankingRow — Shared ranking list row (Apple-native card style)
 * Top 3: medal only (no number). 4+: number only.
 * Each row is a standalone card, no border-b chain.
 */
import Avatar from '@/components/ui/Avatar.vue'
import RankMedal from '@/components/ui/RankMedal.vue'

defineProps({
  rank: { type: Number, required: true },
  name: { type: String, required: true },
  avatar: { type: String, default: '' },
  detail: { type: String, default: '' },
  score: { type: [Number, String], required: true },
  scoreLabel: { type: String, default: '' }
})
</script>

<template>
  <div>
    <div
      class="flex items-center gap-3 px-4 py-3 rounded-lg border transition-[transform,box-shadow] duration-fast active:scale-[0.98]"
      :class="{
        'bg-surface border-line-light': rank > 3,
        'rank-gold border-accent/30': rank === 1,
        'rank-silver border-line': rank === 2,
        'rank-bronze border-line': rank === 3
      }"
    >
      <!-- Rank indicator: medal for top 3, number for 4+ -->
      <div class="w-8 flex items-center justify-center shrink-0">
        <RankMedal v-if="rank <= 3" :rank="rank" />
        <span v-else class="text-sm font-bold font-mono text-fg-muted">{{ rank }}</span>
      </div>
      <Avatar :name="name" :src="avatar" size="md" />
      <div class="flex-1 min-w-0">
        <span class="block text-sm font-semibold truncate">{{ name }}</span>
        <span v-if="detail && !$slots.detail" class="block text-xs text-fg-muted mt-0.5">{{ detail }}</span>
        <slot name="detail" />
      </div>
      <div class="flex flex-col items-end shrink-0">
        <span class="text-2xl font-extrabold font-display text-accent">{{ score }}</span>
        <span v-if="scoreLabel" class="text-2xs text-fg-muted -mt-0.5">{{ scoreLabel }}</span>
      </div>
    </div>
    <!-- Footer slot: e.g. buff tags, rendered inside the card body, below the row -->
    <div v-if="$slots.footer" class="px-4 pb-3 -mt-1">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
.rank-gold { background: linear-gradient(135deg, oklch(0.85 0.12 85 / 0.25), oklch(0.90 0.08 85 / 0.10)); }
.rank-silver { background: linear-gradient(135deg, oklch(0.75 0.02 220 / 0.15), oklch(0.80 0.01 220 / 0.05)); }
.rank-bronze { background: linear-gradient(135deg, oklch(0.65 0.06 45 / 0.15), oklch(0.70 0.04 45 / 0.05)); }
</style>
