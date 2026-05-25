<script setup>
import { computed, ref, onMounted } from 'vue'
import { useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import { Chart, registerables } from 'chart.js'
import Card from '@/components/ui/Card.vue'

Chart.register(...registerables)

const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()

const friendlyMatches = computed(() =>
  matchesStore.matches.filter(m => !m.seasonId && m.status === STATUS.COMPLETED)
)

// Per-player stats
const playerStats = computed(() => {
  const map = {}
  for (const p of playersStore.players) {
    map[p.id] = { name: p.name, wins: 0, losses: 0, gamesWon: 0, totalPoints: 0, totalMatches: 0 }
  }
  for (const m of friendlyMatches.value) {
    const gs = matchesStore.getGamesByMatch(m.id).filter(g => g.status === STATUS.COMPLETED)
    for (const pid of (m.teamA || [])) { if (map[pid]) {
      map[pid].totalMatches++
      if (m.winner === 'a') map[pid].wins++; else map[pid].losses++
      for (const g of gs) { map[pid].totalPoints += (g.scoreA || 0); if (g.winner === 'a') map[pid].gamesWon++ }
    }}
    for (const pid of (m.teamB || [])) { if (map[pid]) {
      map[pid].totalMatches++
      if (m.winner === 'b') map[pid].wins++; else map[pid].losses++
      for (const g of gs) { map[pid].totalPoints += (g.scoreB || 0); if (g.winner === 'b') map[pid].gamesWon++ }
    }}
  }
  return Object.values(map).filter(p => p.totalMatches > 0)
})

// Chart refs
const winChart = ref(null)
const pointsChart = ref(null)
let winChartInst = null
let pointsChartInst = null

onMounted(() => {
  if (playerStats.value.length === 0) return

  const labels = playerStats.value.map(p => p.name)

  if (winChart.value) {
    winChartInst = new Chart(winChart.value, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '胜', data: playerStats.value.map(p => p.wins), backgroundColor: '#22c55e', borderRadius: 4 },
          { label: '负', data: playerStats.value.map(p => p.losses), backgroundColor: '#ef4444', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 11 } } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { stepSize: 1 } } }
      }
    })
  }

  if (pointsChart.value) {
    const barColors = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444']
    pointsChartInst = new Chart(pointsChart.value, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '总得分', data: playerStats.value.map(p => p.totalPoints), backgroundColor: labels.map((_, i) => barColors[i % barColors.length]), borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#e5e7eb' } } }
      }
    })
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="playerStats.length === 0" class="text-center p-12 text-fg-muted text-sm">暂无友谊赛数据</div>
    <template v-else>
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-4">胜负对比</h3>
        <div class="max-h-[220px]"><canvas ref="winChart"></canvas></div>
      </Card>
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-4">总得分</h3>
        <div class="max-h-[220px]"><canvas ref="pointsChart"></canvas></div>
      </Card>
      <Card padding="md">
        <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-4">数据概览</h3>
        <div class="flex flex-col gap-3">
          <div v-for="p in playerStats" :key="p.name" class="flex items-center gap-3">
            <span class="text-sm font-medium w-12 shrink-0">{{ p.name }}</span>
            <div class="flex-1 flex items-center gap-2">
              <div class="flex-1 h-2 bg-line rounded-sm overflow-hidden"><div class="ov-bar ov-win" :style="{width:(p.totalMatches>0?p.wins/p.totalMatches*100:0)+'%'}"></div></div>
              <span class="text-xs font-semibold text-success min-w-8 text-right">{{ p.totalMatches>0?Math.round(p.wins/p.totalMatches*100):0 }}%</span>
            </div>
            <span class="text-xs text-fg-muted min-w-[50px] text-right">{{ p.wins }}W {{ p.losses }}L</span>
          </div>
        </div>
      </Card>
    </template>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
.chart-wrap canvas { max-height:200px; }
.ov-bar { height:100%; border-radius:var(--radius-sm); transition:width 0.5s var(--ease-out); }
.ov-bar.ov-win { background:var(--color-success); }
</style>
