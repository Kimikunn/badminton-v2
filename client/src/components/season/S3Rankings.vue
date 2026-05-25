<script setup>
/**
 * S3Rankings — 超能饮料 + 绝对压制2.0 + 关键先生
 * Contract: same as S2 + drink/clutch buffs
 */
import { computed } from 'vue'
import RankingRow from '@/components/ui/RankingRow.vue'
import { CupSoda, Swords, Target } from 'lucide-vue-next'

const props = defineProps({ rankings: Array, season: Object, rounds: Array })
const completedRounds = computed(() => props.rounds?.filter(r=>r.status==='completed').length||0)
const sorted = computed(() => [...props.rankings].sort((a,b)=>(b.finalBigScore??b.bigScore??0)-(a.finalBigScore??a.bigScore??0)))
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Buff cards -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-4 px-5 py-4 bg-surface rounded-lg border border-line-light">
        <div class="text-3xl"><CupSoda :size="24" /></div>
        <div class="flex-1">
          <div class="text-base font-semibold">超能饮料</div>
          <div class="text-xs text-fg-muted mt-0.5">每轮掷骰子 · 1或6激活</div>
        </div>
      </div>
      <div class="flex items-center gap-4 px-5 py-4 bg-surface rounded-lg border border-line-light">
        <div class="text-3xl"><Swords :size="24" /></div>
        <div class="flex-1">
          <div class="text-base font-semibold">绝对压制 2.0</div>
          <div class="text-xs text-fg-muted mt-0.5">净胜≥10且对手<12 · 7轮结算</div>
        </div>
        <span class="px-3 py-1 rounded-full bg-warning-subtle text-warning text-xs font-medium">{{ completedRounds }}/7</span>
      </div>
      <div class="flex items-center gap-4 px-5 py-4 bg-surface rounded-lg border border-line-light">
        <div class="text-3xl"><Target :size="24" /></div>
        <div class="flex-1">
          <div class="text-base font-semibold">关键先生</div>
          <div class="text-xs text-fg-muted mt-0.5">Deuce获胜(≥22:20) · 7轮结算</div>
        </div>
      </div>
    </div>

    <!-- Rankings -->
    <div v-if="!sorted.length" class="text-center py-12 text-fg-muted text-sm">暂无数据</div>
    <div v-else class="flex flex-col gap-2">
      <RankingRow
        v-for="(r,i) in sorted"
        :key="r.id"
        :rank="i+1"
        :name="r.name"
        :avatar="r.avatar"
        :detail="`${r.wins??0}胜 ${r.losses??0}负`"
        :score="r.finalBigScore??r.bigScore??0"
        :score-label="r.bonusBigScore ? `+${r.bonusBigScore}` : ''"
      >
        <template v-if="r.buffs?.length" #footer>
          <div class="flex gap-1 flex-wrap">
            <span
              v-for="b in r.buffs"
              :key="b.id"
              class="px-2 py-px rounded-full bg-accent-subtle text-accent font-medium text-2xs"
              :class="{ 'bg-success-subtle text-success': b.settled }"
            >{{ b.count ? b.name+'×'+b.count : b.name }}</span>
          </div>
        </template>
      </RankingRow>
    </div>
  </div>
</template>
