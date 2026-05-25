<script setup>
/**
 * MatchListView — 比赛中枢
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMatchesStore, usePlayersStore, useSeasonsStore } from '@/stores'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { STATUS, BEST_OF_OPTIONS } from '@/constants'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Input from '@/components/ui/Input.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { Dumbbell } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()
const seasonsStore = useSeasonsStore()
const { getSeasonColor } = useSeasonTheme()
const toast = useToast()

// Filter
const filterTab = ref('all')
const filters = [
  { key: 'all', label: '全部' },
  { key: 'live', label: '进行中' },
  { key: 'season', label: '赛季赛' },
  { key: 'friendly', label: '友谊赛' }
]

const filteredMatches = computed(() => {
  let ms = matchesStore.allMatches
  if (filterTab.value === 'live') ms = ms.filter(m => m.status !== STATUS.COMPLETED)
  else if (filterTab.value === 'friendly') ms = ms.filter(m => !m.seasonId)
  else if (filterTab.value === 'season') ms = ms.filter(m => !!m.seasonId)
  return ms
})

// Focus matches (live + pending)
const focusMatches = computed(() =>
  matchesStore.matches.filter(m => m.status === STATUS.IN_PROGRESS || m.status === STATUS.PENDING)
)

// Calendar
const calYear = ref(new Date().getFullYear())
const calMonth = ref(new Date().getMonth())
const monthLabel = computed(() => `${calYear.value}年${calMonth.value + 1}月`)
function prevMonth() { if (calMonth.value===0) { calMonth.value=11; calYear.value-- } else calMonth.value-- }
function nextMonth() { if (calMonth.value===11) { calMonth.value=0; calYear.value++ } else calMonth.value++ }

const calDays = computed(() => {
  const first = new Date(calYear.value, calMonth.value, 1)
  const last = new Date(calYear.value, calMonth.value+1, 0)
  const days = []
  for (let i=0;i<first.getDay();i++) days.push(null)
  for (let d=1;d<=last.getDate();d++) days.push(d)
  return days
})
function getDayMatches(day) {
  if (!day) return []
  const ds = `${calYear.value}-${String(calMonth.value+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  return matchesStore.allMatches.filter(m => m.date === ds)
}
const today = computed(() => {
  const n = new Date()
  return n.getFullYear()===calYear.value && n.getMonth()===calMonth.value ? n.getDate() : null
})

// Helpers
function getTeams(ids) { return ids?.map(id => playersStore.getPlayerName(id)).join('/') || '—' }
function getScore(mid) {
  const s = matchesStore.getMatchScore(mid); return `${s.scoreA}:${s.scoreB}`
}
function getSeasonColorStyle(seasonId) {
  if (!seasonId) return {}
  const s = seasonsStore.getSeasonById(seasonId)
  if (!s?.color) return {}
  const c = getSeasonColor(s.color)
  return { color: c.light }
}
function getSeasonLabel(seasonId) {
  if (!seasonId) return { badge: '友谊赛', sub: '' }
  const s = seasonsStore.getSeasonById(seasonId)
  const num = s?.name?.match(/第(.+?)赛季/)?.[1] || ''
  return { badge: '赛季', sub: num ? `第${num}赛季` : s?.name || '' }
}
function statusText(s) { return s===STATUS.IN_PROGRESS?'Live':s===STATUS.COMPLETED?'已结束':'待开始' }
function statusVar(s) { return s===STATUS.IN_PROGRESS?'success':s===STATUS.COMPLETED?'muted':'warning' }

function goScoring(mid) {
  const m = matchesStore.getMatchById(mid)
  if (m?.status === STATUS.COMPLETED) {
    router.push(`/matches/${mid}`)
  } else {
    router.push(`/scoring/${mid}`)
  }
}

// Create friendly match
const showCreate = ref(false)
const newM = ref({ teamA:[], teamB:[], bestOf:3, date:new Date().toISOString().slice(0,10) })
function togglePlayer(pid, team) {
  const arr = newM.value[team]; const i = arr.indexOf(pid)
  if (i>=0) arr.splice(i,1); else if (arr.length<2) arr.push(pid); else toast.show('每队最多2人','info')
}
function isSelected(pid,team) { return newM.value[team].includes(pid) }
async function handleCreate() {
  if (newM.value.teamA.length<1||newM.value.teamB.length<1) { toast.show('请选择两队选手','error'); return }
  toast.show('友谊赛创建成功','success'); showCreate.value=false
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Focus matches -->
    <div v-if="focusMatches.length > 0" class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-2">焦点战</h3>
      <div
        v-for="m in focusMatches"
        :key="m.id"
        class="p-4 rounded-lg border border-line-light bg-surface cursor-pointer transition-[transform,box-shadow] duration-fast"
        :class="{'!border-success !bg-success-subtle': m.status === STATUS.IN_PROGRESS, 'active:bg-surface-hover': m.status !== STATUS.IN_PROGRESS}"
        @click="goScoring(m.id)"
      >
        <div class="flex justify-center items-center gap-3 mb-2">
          <span class="text-lg font-semibold text-fg" :class="{'!font-bold !text-accent': m.winner==='a'}">{{ getTeams(m.teamA) }}</span>
          <span class="text-sm text-fg-muted font-bold" v-if="m.status===STATUS.IN_PROGRESS">vs</span>
          <span class="text-sm text-fg-muted font-bold" v-else>VS</span>
          <span class="text-lg font-semibold text-fg" :class="{'!font-bold !text-accent': m.winner==='b'}">{{ getTeams(m.teamB) }}</span>
        </div>
        <div class="flex justify-center items-center gap-3">
          <Badge :variant="statusVar(m.status)" size="sm">{{ statusText(m.status) }}</Badge>
          <span class="text-xl font-bold font-mono text-fg" v-if="m.status===STATUS.IN_PROGRESS || m.status===STATUS.COMPLETED">{{ getScore(m.id) }}</span>
          <span class="text-xs text-fg-muted">{{ BEST_OF_OPTIONS.find(o=>o.value===m.bestOf)?.label }}</span>
        </div>
      </div>
    </div>

    <!-- Create button -->
    <Button variant="primary" size="md" block @click="showCreate = true">+ 发起友谊赛</Button>

    <!-- Calendar -->
    <Card padding="md">
      <div class="flex items-center justify-between mb-3">
        <button aria-label="上个月" class="cal-nav" @click="prevMonth">◀</button>
        <h3 class="text-sm font-semibold text-fg">{{ monthLabel }}</h3>
        <button aria-label="下个月" class="cal-nav" @click="nextMonth">▶</button>
      </div>
      <div class="cal-grid">
        <span v-for="d in '日一二三四五六'" :key="d" class="text-xs text-fg-muted py-1 text-center">{{ d }}</span>
        <div v-for="(day,i) in calDays" :key="i" class="cal-day"
          :class="{'cal-today':day===today, 'cal-has':day&&getDayMatches(day).length>0}">
          <span v-if="day">{{ day }}</span>
          <span v-if="day&&getDayMatches(day).length>0" class="cal-dot"></span>
        </div>
      </div>
    </Card>

    <!-- Filters -->
    <div class="flex gap-1 bg-surface rounded-md p-[3px] border border-line-light">
      <button v-for="f in filters" :key="f.key" class="flex-1 p-2 border-none bg-transparent rounded-sm text-sm cursor-pointer transition-[transform,box-shadow] duration-fast"
        :class="filterTab===f.key ? 'bg-canvas text-fg font-medium shadow-sm' : 'text-fg-secondary'"
        @click="filterTab=f.key">{{ f.label }}</button>
    </div>

    <!-- History list -->
    <EmptyState v-if="filteredMatches.length===0" icon="Dumbbell" title="暂无比赛" :description="filterTab==='all'?'发起友谊赛或创建赛季':''" />

    <div v-else class="flex flex-col gap-0.5">
      <div v-for="m in filteredMatches" :key="m.id" class="flex items-center gap-3 py-3 px-2 border-b border-line-light cursor-pointer"
        :class="{'bg-success-subtle rounded-md !border-b-0':m.status===STATUS.IN_PROGRESS}"
        @click="goScoring(m.id)">
        <div class="flex flex-col items-center min-w-12">
          <span class="text-xs text-fg-muted">{{ m.date?.slice(5) || '—' }}</span>
          <span class="text-2xs text-accent bg-accent-subtle px-1 rounded-sm font-medium inline-block" :class="{'!text-warning !bg-warning-subtle':!m.seasonId}">{{ getSeasonLabel(m.seasonId).badge }}</span>
          <span class="text-2xs text-fg-muted block" v-if="getSeasonLabel(m.seasonId).sub">{{ getSeasonLabel(m.seasonId).sub }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <span class="text-sm font-medium text-fg">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <span class="text-sm font-semibold font-mono text-fg" :style="getSeasonColorStyle(m.seasonId)" v-if="m.status!==STATUS.PENDING">{{ getScore(m.id) }}</span>
          <Badge :variant="statusVar(m.status)" size="sm">{{ statusText(m.status) }}</Badge>
        </div>
      </div>
    </div>

    <!-- Create sheet -->
    <Sheet :show="showCreate" title="发起友谊赛" @close="showCreate=false">
      <div class="flex flex-col gap-4">
        <div class="ps">
          <h4 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-2">A 队</h4>
          <div class="flex flex-wrap gap-2">
            <button v-for="p in playersStore.players" :key="'a'+p.id"
              class="flex items-center gap-2 py-2 px-3 rounded-full border text-sm cursor-pointer transition-[transform,box-shadow] duration-fast" active:scale-95"
              :class="isSelected(p.id,'teamA') ? 'bg-accent-subtle border-accent text-accent' : 'border-line bg-canvas text-fg'"
              @click="togglePlayer(p.id,'teamA')">
              <Avatar :name="p.name" :src="p.avatar" size="sm" /><span>{{ p.name }}</span>
            </button>
          </div>
        </div>
        <div class="ps">
          <h4 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide mb-2">B 队</h4>
          <div class="flex flex-wrap gap-2">
            <button v-for="p in playersStore.players" :key="'b'+p.id"
              class="flex items-center gap-2 py-2 px-3 rounded-full border text-sm cursor-pointer transition-[transform,box-shadow] duration-fast" active:scale-95"
              :class="isSelected(p.id,'teamB') ? 'bg-accent-subtle border-accent text-accent' : 'border-line bg-canvas text-fg'"
              @click="togglePlayer(p.id,'teamB')">
              <Avatar :name="p.name" :src="p.avatar" size="sm" /><span>{{ p.name }}</span>
            </button>
          </div>
        </div>
        <Input label="日期" type="date" v-model="newM.date" />
        <div class="flex gap-3">
          <Button variant="secondary" size="md" class="flex-1" @click="showCreate=false">取消</Button>
          <Button variant="primary" size="md" class="flex-1" @click="handleCreate">创建</Button>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Calendar grid (needs grid-template-columns) */
.cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; text-align:center; }
.cal-day { aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:var(--radius-sm); font-size:var(--text-sm); position:relative; }
.cal-today { background:var(--color-accent); color:var(--color-text-inverse); font-weight:var(--weight-bold); }
.cal-has:not(.cal-today) { background:var(--color-accent-subtle); }
.cal-dot { @apply w-1 h-1 rounded-full bg-accent absolute bottom-1; }

/* Calendar nav button */
.cal-nav { @apply w-7 h-7 border-none rounded-full bg-surface-hover text-xs cursor-pointer flex items-center justify-center; }
</style>
