<script setup>
/**
 * RankingsHubView — 积分榜调度中心
 */
import { computed, ref, defineAsyncComponent } from 'vue'
import { useSeasonsStore, useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import { getRule } from '@/rules'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useViewAccent } from '@/composables/useViewAccent'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Card from '@/components/ui/Card.vue'
import Avatar from '@/components/ui/Avatar.vue'
import SeasonTabs from '@/components/season/SeasonTabs.vue'
// Lazy load season ranking components — only the active season's component is loaded
const S1Rankings = defineAsyncComponent(() => import('@/components/season/S1Rankings.vue'))
const S2Rankings = defineAsyncComponent(() => import('@/components/season/S2Rankings.vue'))
const S3Rankings = defineAsyncComponent(() => import('@/components/season/S3Rankings.vue'))
const S4Rankings = defineAsyncComponent(() => import('@/components/season/S4Rankings.vue'))
const S5Rankings = defineAsyncComponent(() => import('@/components/season/S5Rankings.vue'))
const FriendlyStats = defineAsyncComponent(() => import('@/components/FriendlyStats.vue'))

const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()
const { getSeasonColor } = useSeasonTheme()
const { getSelectedSeasonId, setSelectedSeasonId } = useSeasonSelector()
const { setViewAccent, viewStyle } = useViewAccent()

const parentTab = ref('season')
const parentTabOptions = [
  { key: 'season', label: '赛季积分' },
  { key: 'friendly', label: '友谊赛' }
]
const selectedSeasonId = ref(getSelectedSeasonId())
const currentSeason = computed(() => seasonsStore.getSeasonById(selectedSeasonId.value) || seasonsStore.currentSeason)
const ruleId = computed(() => currentSeason.value?.ruleId || 'standard')

function selectSeason(id) { selectedSeasonId.value=id; setSelectedSeasonId(id); const s=seasonsStore.getSeasonById(id); if(s?.color)setViewAccent(getSeasonColor(s.color)) }

// === Rankings computed via rule module ===
const seasonRankings = computed(() => {
  if (!currentSeason.value) return []
  const rule = getRule(ruleId.value)
  if (!rule?.calcRankings) return []
  return rule.calcRankings(
    currentSeason.value.participants || [],
    matchesStore.matches.filter(m => m.seasonId === currentSeason.value.id && m.status === STATUS.COMPLETED),
    (mid) => matchesStore.getGamesByMatch(mid),
    (id) => playersStore.getPlayerById(id),
    { season: currentSeason.value, rounds: seasonsStore.getRoundsBySeason(currentSeason.value.id) }
  )
})

const seasonRounds = computed(() => currentSeason.value ? seasonsStore.getRoundsBySeason(currentSeason.value.id) : [])
const seasonMatches = computed(() => currentSeason.value ? matchesStore.matches.filter(m => m.seasonId === currentSeason.value.id) : [])

// S4-specific
const s4ComboRankings = computed(() => {
  if (ruleId.value !== 's4' || !currentSeason.value) return []
  const rule = getRule('s4')
  return rule?.calcComboRankings ? rule.calcComboRankings(seasonMatches.value, (mid) => matchesStore.getGamesByMatch(mid), seasonRounds.value, { season: currentSeason.value }) : []
})
const s4TopWinner = computed(() => {
  if (ruleId.value !== 's4') return null
  const topDone = seasonRounds.value.filter(r => r.roundNo <= 4 && r.status === 'completed').length
  if (topDone < 4) return null
  return [...seasonRankings.value].sort((a,b) => (b.stars||0) - (a.stars||0))[0] || null
})
</script>

<template>
  <div class="flex flex-col gap-4" :style="viewStyle">
    <!-- Parent tabs: 赛季积分 / 友谊赛 -->
    <SegmentedControl v-model="parentTab" :options="parentTabOptions" />

    <!-- Season tab -->
    <template v-if="parentTab==='season'">
      <SeasonTabs :seasons="seasonsStore.seasons" :selected-id="selectedSeasonId" @select="selectSeason" />
      <div v-if="!currentSeason" class="text-center p-12 text-fg-muted text-sm">暂无赛季</div>
      <S1Rankings v-else-if="ruleId==='standard'" :rankings="seasonRankings" />
      <S2Rankings v-else-if="ruleId==='s2'" :rankings="seasonRankings" :season="currentSeason" :rounds="seasonRounds" />
      <S3Rankings v-else-if="ruleId==='s3'" :rankings="seasonRankings" :season="currentSeason" :rounds="seasonRounds" />
      <S4Rankings v-else-if="ruleId==='s4'" :rankings="seasonRankings" :season="currentSeason" :rounds="seasonRounds" :matches="seasonMatches" :combo-rankings="s4ComboRankings" :top-winner="s4TopWinner" />
      <S5Rankings v-else-if="ruleId==='s5'" :rankings="seasonRankings" :season="currentSeason" :rounds="seasonRounds" />
    </template>

    <!-- Friendly tab -->
    <template v-if="parentTab==='friendly'">
      <FriendlyStats />
    </template>
  </div>
</template>
