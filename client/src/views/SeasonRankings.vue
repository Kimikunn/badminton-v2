<script setup>
/**
 * SeasonRankings — 积分榜页 (旧版，保留路由兼容)
 * 三维度排名: 大分(胜场) / 小分(胜局) / 得分(总得分)
 */
import { computed, ref } from 'vue'
import { useSeasonsStore, useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import Card from '@/components/ui/Card.vue'
import RankMedal from '@/components/ui/RankMedal.vue'
import Badge from '@/components/ui/Badge.vue'
import Avatar from '@/components/ui/Avatar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SeasonTabs from '@/components/season/SeasonTabs.vue'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useViewAccent } from '@/composables/useViewAccent'
import { useSeasonTheme } from '@/composables/useSeasonTheme'

const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()

const { getSelectedSeasonId, setSelectedSeasonId } = useSeasonSelector()
const { setViewAccent, viewStyle } = useViewAccent()
const { getSeasonColor } = useSeasonTheme()
const selectedSeasonId = ref(getSelectedSeasonId())
const rankingTab = ref('big')

const currentSeason = computed(() =>
  seasonsStore.getSeasonById(selectedSeasonId.value) || seasonsStore.currentSeason
)

const tabs = [
  { key: 'big', label: '胜场大分' },
  { key: 'small', label: '场获小分' },
  { key: 'total', label: '进球总数' }
]

const bigRankings = computed(() => calcRankings('big'))
const smallRankings = computed(() => calcRankings('small'))
const totalRankings = computed(() => calcRankings('total'))

const currentRankings = computed(() => {
  if (rankingTab.value === 'big') return bigRankings.value
  if (rankingTab.value === 'small') return smallRankings.value
  return totalRankings.value
})

function selectSeason(id) {
  selectedSeasonId.value = id
  setSelectedSeasonId(id)
  const season = seasonsStore.getSeasonById(id)
  if (season?.color) setViewAccent(getSeasonColor(season.color))
}

function calcRankings(type) {
  if (!currentSeason.value) return []
  const participants = currentSeason.value.participants || []
  const seasonMatches = matchesStore.matches.filter(
    m => m.seasonId === currentSeason.value.id && m.status === STATUS.COMPLETED
  )
  const map = {}
  for (const pid of participants) { map[pid] = { id: pid, score: 0, detail: '' } }

  for (const match of seasonMatches) {
    const games = matchesStore.getGamesByMatch(match.id)
    const isTeamA = (pid) => match.teamA?.includes(pid)
    const isTeamB = (pid) => match.teamB?.includes(pid)
    for (const pid of participants) {
      if (type === 'big') {
        if (isTeamA(pid) && match.winner === 'a') map[pid].score++
        if (isTeamB(pid) && match.winner === 'b') map[pid].score++
      } else if (type === 'small') {
        for (const g of games) {
          if (g.status !== STATUS.COMPLETED) continue
          if (isTeamA(pid) && g.winner === 'a') map[pid].score++
          if (isTeamB(pid) && g.winner === 'b') map[pid].score++
        }
      } else {
        for (const g of games) {
          if (g.status !== STATUS.COMPLETED) continue
          if (isTeamA(pid)) map[pid].score += (g.scoreA || 0)
          if (isTeamB(pid)) map[pid].score += (g.scoreB || 0)
        }
      }
    }
  }
  return Object.values(map).sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1, player: playersStore.getPlayerById(p.id), name: playersStore.getPlayerName(p.id) }))
}
</script>

<template>
  <div class="flex flex-col gap-4" :style="viewStyle">
    <!-- Season tabs -->
    <SeasonTabs :seasons="seasonsStore.seasons" :selected-id="selectedSeasonId" @select="selectSeason" />

    <!-- Ranking tabs -->
    <div class="flex gap-1 bg-surface rounded-md px-1 py-0.5 border border-line-light">
      <button v-for="tab in tabs" :key="tab.key"
        class="flex-1 p-2 border-none rounded-sm text-sm cursor-pointer whitespace-nowrap transition-colors duration-fast"
        :class="rankingTab === tab.key ? 'bg-canvas text-fg font-medium shadow-sm' : 'bg-transparent text-fg-secondary'"
        @click="rankingTab = tab.key">
        {{ tab.label }}
      </button>
    </div>

    <EmptyState v-if="!currentSeason" icon="Trophy" title="暂无赛季" description="请先创建赛季" />

    <Card v-else-if="currentRankings.length > 0" padding="none">
      <div v-for="item in currentRankings" :key="item.id"
        class="flex items-center gap-3 px-5 py-3 border-b border-line-light last:border-b-0"
        :class="{'bg-accent-subtle': item.rank <= 3}">
        <RankMedal :rank="item.rank" />
        <Avatar :name="item.name" :src="item.player?.avatar" size="sm" />
        <div class="flex-1 min-w-0">
          <span class="text-base font-medium text-fg">{{ item.name }}</span>
        </div>
        <span class="text-xl font-bold font-mono text-accent">{{ item.score }}</span>
      </div>
    </Card>

    <EmptyState v-else icon="BarChart3" title="暂无数据" description="完成比赛后积分榜将自动更新" />
  </div>
</template>
