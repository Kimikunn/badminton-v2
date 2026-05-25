<script setup>
/**
 * SeasonRounds — 轮次记录（已完成轮次的历史存档，只读）
 */
import { computed, ref } from 'vue'
import { useSeasonsStore, useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useViewAccent } from '@/composables/useViewAccent'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SeasonTabs from '@/components/season/SeasonTabs.vue'

const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()
const { getSeasonColor } = useSeasonTheme()
const { getSelectedSeasonId, setSelectedSeasonId } = useSeasonSelector()
const { setViewAccent, viewStyle } = useViewAccent()

const selectedSeasonId = ref(getSelectedSeasonId())
const currentSeason = computed(() => seasonsStore.getSeasonById(selectedSeasonId.value) || seasonsStore.currentSeason)

const completedRounds = computed(() => {
  if (!currentSeason.value) return []
  return seasonsStore.getRoundsBySeason(currentSeason.value.id)
    .filter(r => r.status === STATUS.COMPLETED)
    .sort((a,b) => b.roundNo - a.roundNo)
})

function selectSeason(id) { selectedSeasonId.value=id; setSelectedSeasonId(id); const s=seasonsStore.getSeasonById(id); if(s?.color)setViewAccent(getSeasonColor(s.color)) }
function getRoundMatches(rid) { return matchesStore.matches.filter(m=>m.roundId===rid).sort((a,b)=>a.id.localeCompare(b.id)) }
function getTeams(ids) { return ids?.map(id=>playersStore.getPlayerName(id)).join('/')||'—' }
function getScore(mid) { const s=matchesStore.getMatchScore(mid); return s.scoreA+s.scoreB>0?`${s.scoreA}:${s.scoreB}`:'' }
</script>

<template>
  <div class="flex flex-col gap-4" :style="viewStyle">
    <!-- Season tabs -->
    <SeasonTabs :seasons="seasonsStore.seasons" :selected-id="selectedSeasonId" @select="selectSeason" />

    <EmptyState v-if="!currentSeason" icon="BarChart3" title="暂无赛季" />
    <EmptyState v-else-if="completedRounds.length===0" icon="ClipboardList" title="暂无已完成的轮次" />

    <div v-else class="flex flex-col gap-3">
      <div v-for="round in completedRounds" :key="round.id">
        <div class="flex items-center gap-2 py-2">
          <span class="text-base font-bold font-mono text-fg">R{{ round.roundNo }}</span>
          <Badge variant="muted" size="sm">已完成</Badge>
        </div>
        <div class="flex flex-col gap-0.5">
          <div v-for="m in getRoundMatches(round.id)" :key="m.id" class="flex items-center justify-between py-2 px-3 bg-surface border border-line-light first:rounded-t-lg last:rounded-b-lg only:rounded-lg">
            <span class="text-sm font-medium text-fg">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
            <span class="text-sm font-semibold font-mono text-accent">{{ getScore(m.id) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
