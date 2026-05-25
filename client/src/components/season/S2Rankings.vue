<script setup>
/**
 * S2Rankings — 绝地反击 + 绝对压制
 * Contract: { id, name, avatar, bigScore, smallScore, totalPoints, wins, losses,
 *   bonusBigScore, bonusSmallScore, finalBigScore, finalSmallScore, dominationCount, buffs[] }
 */
import { computed } from 'vue'
import RankingRow from '@/components/ui/RankingRow.vue'
import { Swords, Dice5 } from 'lucide-vue-next'

const props = defineProps({ rankings: Array, season: Object, rounds: Array })
const completedRounds = computed(() => props.rounds?.filter(r=>r.status==='completed').length||0)
const comebackData = computed(() => props.season?.comebackData)
const sorted = computed(() => [...props.rankings].sort((a,b)=>(b.finalBigScore??b.bigScore??0)-(a.finalBigScore??a.bigScore??0)))
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Buff cards -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-4 px-5 py-4 bg-surface rounded-lg border border-line-light">
        <div class="text-3xl"><Swords :size="24" /></div>
        <div class="flex-1">
          <div class="text-base font-semibold">绝对压制</div>
          <div class="text-xs text-fg-muted mt-0.5">单局净胜分 ≥ 12 · 第7轮结算</div>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-medium" :class="completedRounds>=7 ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'">
          {{ completedRounds>=7?'已结算':completedRounds+'/7' }}
        </span>
      </div>
      <div class="flex items-center gap-4 px-5 py-4 bg-surface rounded-lg border border-line-light">
        <div class="text-3xl"><Dice5 :size="24" /></div>
        <div class="flex-1">
          <div class="text-base font-semibold">绝地反击</div>
          <div class="text-xs text-fg-muted mt-0.5">第6轮后 1-4名分差≥3触发</div>
        </div>
        <span class="px-3 py-1 rounded-full text-xs font-medium" :class="comebackData?.triggered ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'">
          {{ comebackData?.triggered?'已触发':'待触发' }}
        </span>
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
        <!-- Buff tags in footer slot -->
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
