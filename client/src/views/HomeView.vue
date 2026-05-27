<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useClubStore, usePlayersStore, useSeasonsStore, useMatchesStore, useTitlesStore, useBookingsStore } from '@/stores'
import { STATUS } from '@/constants'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import TitleIcon from '@/components/ui/TitleIcon.vue'
import { ChevronRight, Users } from 'lucide-vue-next'

const router = useRouter()
const clubStore = useClubStore()
const playersStore = usePlayersStore()
const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const titlesStore = useTitlesStore()
const bookingsStore = useBookingsStore()

// Club - click to edit
const editingClub = ref(false)
const clubForm = ref({ name: '', description: '' })
function toggleEditClub() {
  if (!editingClub.value) {
    clubForm.value = { name: clubStore.club.name, description: clubStore.club.description }
  }
  editingClub.value = !editingClub.value
}
async function saveClub() {
  await clubStore.updateClub(clubForm.value)
  editingClub.value = false
}

// Members
function getDisplayedTitle(player) {
  if (player.displayedTitleId) {
    return titlesStore.allTitles.find(t => t.id === player.displayedTitleId)
  }
  return titlesStore.getHighestTitle(player.id)
}

const TITLE_PILL = {
  S: 'bg-[var(--color-badge-gold-bg)] text-[var(--color-badge-gold)]',
  A: 'bg-[var(--color-badge-purple-bg)] text-[var(--color-badge-purple)]',
  B: 'bg-accent-subtle text-accent',
  C: 'bg-success-subtle text-success',
  hidden: 'bg-surface-hover text-fg-muted'
}
function titlePillClass(level) { return TITLE_PILL[level] || TITLE_PILL.hidden }

const totalBookingHours = computed(() => {
  let total = 0
  for (const r of bookingsStore.records) {
    const sh = parseInt((r.startTime || '').split(':')[0], 10)
    const eh = parseInt((r.endTime || '').split(':')[0], 10)
    if (sh >= 0 && eh > sh) total += eh - sh
  }
  return total
})
function goToPlayer(id) { router.push({ name: 'player-detail', params: { id } }) }

// Season
const currentSeason = computed(() => seasonsStore.currentSeason)
const currentRound = computed(() => {
  if (!currentSeason.value) return null
  const rds = seasonsStore.getRoundsBySeason(currentSeason.value.id)
  return rds.find(r => r.status === STATUS.IN_PROGRESS) || rds[rds.length - 1] || null
})
const seasonProgress = computed(() => {
  if (!currentSeason.value) return 0
  const rds = seasonsStore.getRoundsBySeason(currentSeason.value.id)
  const done = rds.filter(r => r.status === STATUS.COMPLETED || r.status === STATUS.IN_PROGRESS).length
  return Math.round(done / Math.max(currentSeason.value.totalRounds, 1) * 100)
})

// Live matches (both season and friendly)
const liveMatches = computed(() => matchesStore.ongoingMatches.slice(0, 3))
function getTeamNames(ids) { return ids?.map(id => playersStore.getPlayerName(id)).join('/') || '—' }
function getMatchScore(mid) { const s = matchesStore.getMatchScore(mid); return `${s.scoreA}:${s.scoreB}` }
function getMatchTypeLabel(m) { return m.seasonId ? '赛季' : '友谊' }
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Club info — Liquid Glass -->
    <div
      class="liquid-card p-4 cursor-pointer transition-[transform,box-shadow] duration-fast ease-out active:scale-[0.98]"
      :class="{ '!cursor-default': editingClub }"
      @click="!editingClub && toggleEditClub()"
    >
      <template v-if="!editingClub">
        <div class="flex items-center gap-3">
          <img src="/icon-192.png" class="w-11 h-11 rounded-xl shrink-0 shadow-sm object-cover" alt="TPC" />
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-semibold text-fg">{{ clubStore.club.name }}</h2>
            <p class="text-xs text-fg-secondary mt-0.5">{{ clubStore.club.description || '暂无介绍' }}</p>
          </div>
        </div>
      </template>
      <template v-else>
        <Input label="名称" v-model="clubForm.name" @click.stop />
        <Input label="介绍" type="textarea" v-model="clubForm.description" rows="2" class="mt-3" @click.stop />
        <div class="flex gap-2 mt-3" @click.stop>
          <Button variant="secondary" size="sm" class="flex-1" @click="editingClub=false">取消</Button>
          <Button variant="primary" size="sm" class="flex-1" @click="saveClub">保存</Button>
        </div>
      </template>
    </div>

    <!-- Season progress -->
    <Card v-if="currentSeason" padding="md">
      <div class="flex items-baseline justify-between mb-3">
        <span class="font-semibold text-fg">{{ currentSeason.name }}</span>
        <span class="text-sm text-fg-secondary" v-if="currentRound">第 {{ currentRound.roundNo }}/{{ currentSeason.totalRounds }} 轮</span>
      </div>
      <div class="h-1 bg-line rounded-full overflow-hidden">
        <div class="h-full bg-accent rounded-full transition-[width] duration-500 ease-out" :style="{width:seasonProgress+'%'}"></div>
      </div>
    </Card>

    <!-- Live matches -->
    <div v-if="liveMatches.length > 0" class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">进行中</h3>
      <div v-for="m in liveMatches" :key="m.id" class="live-match-card flex items-center gap-3 p-3 px-4 cursor-pointer transition-transform duration-fast active:scale-[0.98]" @click="router.push(`/scoring/${m.id}`)">
        <div class="w-2 h-2 rounded-full bg-success shrink-0 animate-pulse-dot"></div>
        <div class="flex-1 min-w-0 flex flex-col">
          <span class="text-sm font-medium text-fg">{{ getTeamNames(m.teamA) }} vs {{ getTeamNames(m.teamB) }}</span>
          <span class="text-2xs text-fg-muted">{{ getMatchTypeLabel(m) }}</span>
        </div>
        <span class="text-base font-bold font-mono text-accent">{{ getMatchScore(m.id) }}</span>
      </div>
    </div>

    <!-- Members -->
    <Card padding="md">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-2">成员 ({{ playersStore.players.length }})</h3>
      <div class="flex flex-col" v-if="playersStore.players.length > 0">
        <div v-for="p in playersStore.players" :key="p.id" class="flex items-center gap-2 py-2 cursor-pointer border-b border-line-light last:border-b-0 transition-opacity duration-fast active:opacity-70" @click="goToPlayer(p.id)">
          <Avatar :name="p.name" :src="p.avatar" size="sm" />
          <span class="text-sm font-medium text-fg flex-1 min-w-0">{{ p.name }}</span>
          <span v-if="getDisplayedTitle(p)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0" :class="titlePillClass(getDisplayedTitle(p).level)">
            <TitleIcon :title-id="getDisplayedTitle(p).id" :size="12" />
            <span class="text-2xs max-w-20 truncate">{{ getDisplayedTitle(p).name }}</span>
          </span>
          <ChevronRight :size="16" class="text-fg-muted shrink-0" />
        </div>
      </div>
      <EmptyState v-else icon="Users" title="暂无成员" />
    </Card>

    <!-- Stats -->
    <div class="flex justify-around items-center">
      <div class="text-center">
        <span class="block text-xl font-bold text-accent">{{ playersStore.players.length }}</span>
        <span class="text-xs text-fg-muted">成员</span>
      </div>
      <div class="text-center">
        <span class="block text-xl font-bold text-accent">{{ seasonsStore.seasons.length }}</span>
        <span class="text-xs text-fg-muted">赛季</span>
      </div>
      <div class="text-center">
        <span class="block text-xl font-bold text-accent">{{ matchesStore.historyMatches.length }}</span>
        <span class="text-xs text-fg-muted">比赛</span>
      </div>
      <div v-if="totalBookingHours" class="text-center">
        <span class="block text-xl font-bold text-accent">{{ totalBookingHours }}h</span>
        <span class="text-xs text-fg-muted">时长</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";

/* iOS 26 Liquid Glass — Club card */
.liquid-card {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-xl);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 4px 20px rgba(0, 0, 0, 0.05);
}
.dark .liquid-card {
  background: rgba(40, 40, 45, 0.45);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 4px 20px rgba(0, 0, 0, 0.25);
}

/* Live match card — glass with success tint */
.live-match-card {
  background: rgba(255, 255, 255, 0.50);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 2px 12px rgba(16, 185, 129, 0.08);
}
.dark .live-match-card {
  background: rgba(40, 40, 45, 0.40);
  border-color: rgba(16, 185, 129, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 12px rgba(0, 0, 0, 0.2);
}

@keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.4} }
.animate-pulse-dot { animation: pulse-dot 2s infinite; }
</style>
