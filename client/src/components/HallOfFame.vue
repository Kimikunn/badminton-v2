<script setup>
/**
 * HallOfFame — 名人堂
 * 荣誉墙 + 组合冠军 + 趣味数据
 */
import { computed } from 'vue'
import { useSeasonsStore, usePlayersStore, useMatchesStore } from '@/stores'
import { STATUS } from '@/constants'
import { useRouter } from 'vue-router'
import Avatar from '@/components/ui/Avatar.vue'
import { Trophy, Crown, Handshake, Flame, Dumbbell, Zap, Hash } from 'lucide-vue-next'

const seasonsStore = useSeasonsStore()
const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const router = useRouter()

function championTitle(ruleId) {
  if (ruleId === 's4') return '优胜者'
  if (ruleId === 's5') return '异变之王'
  return '总冠军'
}

function seasonHex(color) {
  const map = { blue: '#3b82f6', purple: '#8b5cf6', green: '#10b981', yellow: '#f59e0b', red: '#ef4444', orange: '#f97316' }
  return map[color] || '#3b82f6'
}

// ── Champions ──
const completedSeasons = computed(() =>
  seasonsStore.seasons
    .filter(s => s.status === STATUS.COMPLETED && s.championPlayerId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
)

const s4Season = computed(() => completedSeasons.value.find(s => s.ruleId === 's4'))
const s4ComboPlayers = computed(() => {
  if (!s4Season.value) return []
  const cc = s4Season.value.comebackData?.s4?.comboChampion
  if (!cc?.players?.length) return []
  return cc.players.map(pid => playersStore.getPlayerById(pid)).filter(Boolean)
})

function getChampion(season) {
  return season.championPlayerId ? playersStore.getPlayerById(season.championPlayerId) : null
}

// ── Fun facts ──
const playerStats = computed(() => {
  const stats = {}
  for (const p of playersStore.players) {
    stats[p.id] = { player: p, wins: 0, losses: 0, totalPts: 0 }
  }
  for (const m of matchesStore.allMatches) {
    if (m.status !== STATUS.COMPLETED) continue
    for (const pid of [...(m.teamA || []), ...(m.teamB || [])]) {
      if (!stats[pid]) continue
      const isA = (m.teamA || []).includes(pid)
      const isB = (m.teamB || []).includes(pid)
      if (!isA && !isB) continue
      if ((isA && m.winner === 'a') || (isB && m.winner === 'b')) stats[pid].wins++
      else stats[pid].losses++
      for (const g of matchesStore.getGamesByMatch(m.id)) {
        if (g.status !== STATUS.COMPLETED) continue
        stats[pid].totalPts += isA ? (g.scoreA || 0) : (g.scoreB || 0)
      }
    }
  }
  return stats
})

const domKing = computed(() => {
  let best = null
  for (const s of Object.values(playerStats.value)) {
    if (!best || (s.wins / Math.max(s.wins + s.losses, 1)) > (best.wins / Math.max(best.wins + best.losses, 1))) {
      best = s
    }
  }
  return best
})

const ironMan = computed(() => {
  let best = null
  for (const s of Object.values(playerStats.value)) {
    if (!best || s.losses > best.losses) best = s
  }
  return best
})

const seasonGameRank = computed(() => {
  const rank = seasonsStore.seasons
    .filter(s => s.status === STATUS.COMPLETED)
    .map(s => {
      let count = 0
      for (const m of matchesStore.allMatches) {
        if (m.seasonId !== s.id || m.status !== STATUS.COMPLETED) continue
        for (const g of matchesStore.getGamesByMatch(m.id)) {
          if (g.status === STATUS.COMPLETED) count++
        }
      }
      return { name: s.name, color: s.color, count, seasonId: s.id }
    })
    .sort((a, b) => b.count - a.count)
  // Only show the top season
  return rank.length ? [rank[0]] : []
})

function shortPairName(ids) {
  if (!ids) return '—'
  return ids.map(id => {
    const name = playersStore.getPlayerName(id)
    return name?.charAt(0) || '?'
  }).join('')
}

const closestGame = computed(() => {
  let best = null, bestTotal = 0
  for (const m of matchesStore.allMatches) {
    if (m.status !== STATUS.COMPLETED) continue
    for (const g of matchesStore.getGamesByMatch(m.id)) {
      if (g.status !== STATUS.COMPLETED) continue
      const total = (g.scoreA || 0) + (g.scoreB || 0)
      if (total > bestTotal) {
        bestTotal = total
        const teamAShort = shortPairName(m.teamA)
        const teamBShort = shortPairName(m.teamB)
        best = { scoreA: g.scoreA, scoreB: g.scoreB, teamA: teamAShort, teamB: teamBShort, seasonName: seasonsStore.getSeasonById(m.seasonId)?.name, matchId: m.id }
      }
    }
  }
  return best
})

function goToMatch(id) {
  if (id) router.push({ name: 'match-detail', params: { id } })
}

function goToPlayer(id) {
  if (id) router.push({ name: 'player-detail', params: { id } })
}
</script>

<template>
  <div v-if="completedSeasons.length" class="flex flex-col gap-4">
    <!-- Section header -->
    <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide px-1">
      <Trophy :size="14" class="inline mr-1 -mt-px text-accent" />
      名人堂
    </h3>

    <!-- Season champion grid -->
    <div class="fame-grid">
      <div
        v-for="season in completedSeasons"
        :key="season.id"
        class="fame-card cursor-pointer"
        :style="{ '--season-color': seasonHex(season.color) }"
        @click="goToPlayer(season.championPlayerId)"
      >
        <div class="fame-badge" :style="{ background: seasonHex(season.color) + '18', color: seasonHex(season.color), borderColor: seasonHex(season.color) + '40' }">
          {{ season.name?.split('-')[0] || 'S?' }}
        </div>
        <Avatar v-if="getChampion(season)" :name="getChampion(season).name" :src="getChampion(season).avatar" size="lg" class="fame-avatar" />
        <span class="fame-season-name">{{ season.name }}</span>
        <span class="fame-player-name">{{ getChampion(season)?.name || '—' }}</span>
        <span class="fame-title" :style="{ color: seasonHex(season.color) }">
          <Crown :size="12" class="inline mr-0.5" />
          {{ championTitle(season.ruleId) }}
        </span>
      </div>
    </div>

    <!-- S4 combo champion banner -->
    <div v-if="s4ComboPlayers.length === 2" class="combo-banner" :style="{ '--season-color': seasonHex(s4Season.color) }">
      <div class="combo-stripe"></div>
      <div class="combo-body">
        <div class="combo-players">
          <div class="combo-player" @click="goToPlayer(s4ComboPlayers[0].id)">
            <Avatar :name="s4ComboPlayers[0].name" :src="s4ComboPlayers[0].avatar" size="md" />
            <span class="combo-name">{{ s4ComboPlayers[0].name }}</span>
          </div>
          <div class="combo-plus"><Handshake :size="18" /></div>
          <div class="combo-player" @click="goToPlayer(s4ComboPlayers[1].id)">
            <Avatar :name="s4ComboPlayers[1].name" :src="s4ComboPlayers[1].avatar" size="md" />
            <span class="combo-name">{{ s4ComboPlayers[1].name }}</span>
          </div>
        </div>
        <span class="combo-label">{{ s4Season.name }} · 组合冠军</span>
      </div>
    </div>

    <!-- ═══ 趣味数据 ═══ -->
    <div v-if="domKing" class="flex flex-col gap-3">
      <h4 class="text-2xs font-semibold text-fg-muted uppercase tracking-wider px-1">
        <Zap :size="12" class="inline mr-1 -mt-px" />
        数据一览
      </h4>

      <!-- Top 3 cards -->
      <div class="fun-grid">
        <!-- 绝对王者 -->
        <div class="fun-card" @click="goToPlayer(domKing.player.id)">
          <div class="fun-icon-wrap"><Flame :size="18" /></div>
          <div class="fun-body">
            <span class="fun-label">绝对王者</span>
            <span class="fun-big">{{ Math.round(domKing.wins / Math.max(domKing.wins + domKing.losses, 1) * 100) }}<span class="fun-big-pct">%</span></span>
            <span class="fun-sub">胜率</span>
            <span class="fun-name">{{ domKing.player.name }}</span>
            <span class="fun-detail">{{ domKing.wins }} 胜 {{ domKing.losses }} 负</span>
          </div>
        </div>

        <!-- 不屈斗士 -->
        <div class="fun-card" @click="goToPlayer(ironMan.player.id)">
          <div class="fun-icon-wrap fun-icon-iron"><Dumbbell :size="18" /></div>
          <div class="fun-body">
            <span class="fun-label">不屈斗士</span>
            <span class="fun-big">{{ ironMan.losses }}<span class="fun-big-pct">败</span></span>
            <span class="fun-sub">屡败屡战</span>
            <span class="fun-name">{{ ironMan.player.name }}</span>
            <span class="fun-detail">打满 {{ ironMan.wins + ironMan.losses }} 场比赛</span>
          </div>
        </div>

        <!-- 最焦灼一局 -->
        <div v-if="closestGame" class="fun-card cursor-pointer" @click="goToMatch(closestGame.matchId)">
          <div class="fun-icon-wrap fun-icon-heat"><Hash :size="18" /></div>
          <div class="fun-body">
            <span class="fun-label">最焦灼一局</span>
            <span class="fun-big">{{ closestGame.scoreA }}<span class="fun-big-pct">:{{ closestGame.scoreB }}</span></span>
            <span class="fun-sub">总分 {{ (closestGame.scoreA || 0) + (closestGame.scoreB || 0) }}</span>
            <span class="fun-name">{{ closestGame.teamA }} vs {{ closestGame.teamB }}</span>
            <span class="fun-detail">{{ closestGame.seasonName }}</span>
          </div>
        </div>
      </div>

      <!-- 赛季局数排行 -->
      <div v-if="seasonGameRank.length" class="season-rank cursor-pointer" @click="router.push('/rankings?season=' + seasonGameRank[0].seasonId)">
        <div class="flex items-baseline justify-between">
          <span class="fun-label">赛季局数之最</span>
          <span class="text-3xs text-fg-muted">查看全部 →</span>
        </div>
        <div class="sr-row mt-2" :style="{ '--season-color': seasonHex(seasonGameRank[0].color) }">
          <span class="sr-name">{{ seasonGameRank[0].name }}</span>
          <div class="sr-bar-track">
            <div class="sr-bar" :style="{ width: '100%', background: seasonHex(seasonGameRank[0].color) }"></div>
          </div>
          <span class="sr-count">{{ seasonGameRank[0].count }}<span class="sr-unit">局</span></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* ── Grid ── */
.fame-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--space-3);
}

/* ── Champion card ── */
.fame-card {
  @apply flex flex-col items-center gap-1.5 p-3 pt-4 rounded-2xl;
  background: rgba(255, 255, 255, 0.40);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.30);
  border-top: 3px solid var(--season-color);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 4px 12px rgba(0, 0, 0, 0.03);
  transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
.fame-card:active { transform: scale(0.97); }
.dark .fame-card {
  background: rgba(40, 40, 45, 0.38);
  border-color: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 12px rgba(0, 0, 0, 0.18);
}

.fame-badge { @apply px-2 py-0.5 rounded-full text-2xs font-bold tracking-wider; border: 1px solid; }
.fame-avatar { @apply shrink-0; box-shadow: 0 0 8px var(--season-color); }
.fame-season-name { @apply text-2xs font-medium; color: var(--color-text-muted); }
.fame-player-name { @apply text-sm font-bold; color: var(--color-text); }
.fame-title { @apply text-3xs font-semibold tracking-wide; }

/* ── Combo banner ── */
.combo-banner {
  @apply relative rounded-2xl overflow-hidden;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.dark .combo-banner {
  background: rgba(40, 40, 45, 0.33);
  border-color: rgba(255, 255, 255, 0.06);
}
.combo-stripe { height: 3px; background: var(--season-color); }
.combo-body { @apply flex flex-col items-center gap-2 py-4 px-3; }
.combo-players { @apply flex items-center gap-1; }
.combo-player { @apply flex flex-col items-center gap-1 px-2 py-1 rounded-xl cursor-pointer; transition: background var(--duration-fast); }
.combo-player:hover { background: rgba(255, 255, 255, 0.30); }
.dark .combo-player:hover { background: rgba(255, 255, 255, 0.06); }
.combo-name { @apply text-sm font-bold; color: var(--color-text); }
.combo-plus {
  @apply flex items-center justify-center w-8 h-8 rounded-full shrink-0 mx-1;
  background: var(--color-accent-subtle); color: var(--color-accent);
}
.combo-label {
  @apply text-2xs font-semibold uppercase tracking-wider px-3 py-0.5 rounded-full;
  background: color-mix(in srgb, var(--season-color) 15%, transparent);
  color: var(--season-color);
}

/* ── Fun facts ── */
.fun-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--space-2);
}
.fun-card {
  @apply flex flex-col items-center gap-0 p-3 rounded-xl cursor-pointer;
  background: rgba(255, 255, 255, 0.30);
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  transition: transform var(--duration-fast) var(--ease-out);
}
.fun-card:active { transform: scale(0.97); }
.dark .fun-card {
  background: rgba(40, 40, 45, 0.25);
  border-color: rgba(255, 255, 255, 0.05);
}

.fun-icon-wrap {
  @apply w-8 h-8 rounded-full flex items-center justify-center mb-1;
  background: linear-gradient(135deg, oklch(0.70 0.18 40), oklch(0.65 0.22 25));
  color: #fff;
}
.fun-icon-iron {
  background: linear-gradient(135deg, oklch(0.60 0.15 250), oklch(0.50 0.20 260));
}
.fun-icon-heat {
  background: linear-gradient(135deg, oklch(0.65 0.18 290), oklch(0.55 0.20 300));
}

.fun-body { @apply flex flex-col items-center gap-0.5; }
.fun-label { @apply text-3xs font-semibold uppercase tracking-wider; color: var(--color-text-muted); }
.fun-big { @apply text-xl font-bold font-mono; color: var(--color-text); }
.fun-big-pct { @apply text-sm font-normal; color: var(--color-accent); }
.fun-sub { @apply text-3xs; color: var(--color-text-muted); }
.fun-name { @apply text-xs font-semibold mt-0.5; color: var(--color-text-secondary); }
.fun-detail { @apply text-3xs; color: var(--color-text-muted); }

/* ── Season rank ── */
.season-rank {
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(16px) saturate(120%);
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  transition: transform var(--duration-fast) var(--ease-out);
}
.season-rank:active { transform: scale(0.98); }
.dark .season-rank {
  background: rgba(40, 40, 45, 0.22);
  border-color: rgba(255, 255, 255, 0.05);
}
.sr-row { @apply flex items-center gap-3; }
.sr-name { @apply text-sm font-medium shrink-0; color: var(--color-text-secondary); }
.sr-bar-track { @apply flex-1 h-2.5 rounded-full bg-line overflow-hidden; }
.sr-bar { @apply h-full rounded-full; transition: width 0.6s var(--ease-out); }
.sr-count { @apply text-base font-bold font-mono shrink-0; color: var(--color-accent); }
.sr-unit { @apply text-xs font-normal; color: var(--color-text-muted); }
</style>
