<script setup>
/**
 * MatchHubView — 比赛中枢（合并赛季+比赛）
 *
 * Parent tabs: [赛季比赛] [友谊赛]
 * Season tab: season progress + current round + create round + history
 * Friendly tab: create friendly + live matches + history
 */
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSeasonsStore, useMatchesStore, usePlayersStore } from '@/stores'
import { STATUS } from '@/constants'
import { getRule } from '@/rules'
import { useSeasonTheme } from '@/composables/useSeasonTheme'
import { useSeasonSelector } from '@/composables/useSeasonSelector'
import { useViewAccent } from '@/composables/useViewAccent'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Avatar from '@/components/ui/Avatar.vue'
import Button from '@/components/ui/Button.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Input from '@/components/ui/Input.vue'
import Sheet from '@/components/ui/Sheet.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SeasonTabs from '@/components/season/SeasonTabs.vue'
import SeasonPresetManager from '@/components/season/SeasonPresetManager.vue'
import { SEASON_PRESETS } from '@/constants/seasonPresets'
import { BarChart3, Dumbbell, Trash2, RefreshCw, Dice5 } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useMatchTab } from '@/composables/useMatchTab'
import { useConfirm } from '@/composables/useConfirm'

const isTestMode = import.meta.env.VITE_TEST_MODE === 'true'
const deletingSeasonId = ref(null)
const hasNextSeasonPreset = computed(() => {
  const existing = new Set(seasonsStore.seasons.map(s => s.ruleId))
  const next = SEASON_PRESETS.find(p => !existing.has(p.ruleId))
  if (!next) return false
  const idx = SEASON_PRESETS.indexOf(next)
  if (idx === 0) return true
  const prevPreset = SEASON_PRESETS[idx - 1]
  const prevSeason = seasonsStore.seasons.find(s => s.ruleId === prevPreset.ruleId)
  return prevSeason && prevSeason.status === 'completed'
})
const router = useRouter()
const seasonsStore = useSeasonsStore()
const matchesStore = useMatchesStore()
const playersStore = usePlayersStore()
const { getSeasonColor } = useSeasonTheme()
const { getSelectedSeasonId, setSelectedSeasonId } = useSeasonSelector()
const { setViewAccent, viewStyle } = useViewAccent()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()

const { activeTab } = useMatchTab()

// Parent tab - use shared state
const parentTab = activeTab
const parentTabOptions = [
  { key: 'season', label: '赛季比赛' },
  { key: 'friendly', label: '友谊赛' }
]

// === SEASON TAB ===
const selectedSeasonId = ref(getSelectedSeasonId())
const currentSeason = computed(() => seasonsStore.getSeasonById(selectedSeasonId.value) || seasonsStore.currentSeason)

const rounds = computed(() => {
  if (!currentSeason.value) return []
  return seasonsStore.getRoundsBySeason(currentSeason.value.id).sort((a,b) => a.roundNo - b.roundNo)
})
const completedRounds = computed(() => rounds.value.filter(r => getRoundMatches(r.id).some(m => m.status === STATUS.COMPLETED)))

const stats = computed(() => {
  const rds = rounds.value
  const completed = rds.filter(r => r.status === STATUS.COMPLETED).length
  const current = rds.find(r => r.status === STATUS.IN_PROGRESS) || rds.find(r => r.status === STATUS.PENDING)
  const maxRoundNo = rds.length > 0 ? Math.max(...rds.map(r => r.roundNo)) : 0
  const currentRoundNo = Math.min(current?.roundNo || maxRoundNo, currentSeason.value?.totalRounds || 1)
  return { total: currentSeason.value?.totalRounds||0, completed, currentRound: current, currentRoundNo }
})

const seasonMatches = computed(() => {
  if (!currentSeason.value) return []
  return matchesStore.allMatches.filter(m => m.seasonId === currentSeason.value.id)
})
const currentRule = computed(() => getRule(currentSeason.value?.ruleId))
const beforeRoundLifecycle = computed(() => currentRule.value?.lifecycle?.beforeRound || null)
const requiresBeforeRoundDice = computed(() => beforeRoundLifecycle.value?.required && beforeRoundLifecycle.value?.type === 'dice')
const nextRoundNo = computed(() => Math.max(0, ...rounds.value.map(r => r.roundNo)) + 1)
const supportsRandomPairings = computed(() => !(currentSeason.value?.ruleId === 's4' && nextRoundNo.value >= 5))
const pairingPreviewNote = computed(() => supportsRandomPairings.value
  ? '随机生成对阵，可重新随机；确认后将按当前预览创建。'
  : '按赛季规则固定生成，确认后将与下列对阵一致。'
)

// Round CRUD
const editingRound = ref(null)
const showEditRound = ref(false)

function openEditRound(round) {
  editingRound.value = round
  showEditRound.value = true
}

async function saveRoundEdit() {
  try {
    await seasonsStore.updateRound(editingRound.value.id, { status: editingRound.value.status })
    toast.show('已更新', 'success')
    showEditRound.value = false
  } catch(e) { toast.show('更新失败', 'error') }
}

async function handleDeleteRound(round) {
  const ok = await confirmAction({
    title: `删除 R${round.roundNo}`,
    message: `确认删除 R${round.roundNo} 及其所有比赛？\n此操作不可撤销。`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await seasonsStore.deleteRound(round.id)
    matchesStore.removeMatchesByRound(round.id)
    toast.show(`R${round.roundNo} 已删除`, 'success')
  } catch(e) { toast.show('删除失败', 'error') }
}

function selectSeason(id) {
  selectedSeasonId.value = id
  setSelectedSeasonId(id)
  const s = seasonsStore.getSeasonById(id)
  if (s?.color) setViewAccent(getSeasonColor(s.color))
}

async function handleDeleteSeason(season) {
  if (!isTestMode && season.status === STATUS.COMPLETED) {
    toast.show('已完成赛季不允许删除', 'error')
    return
  }
  const ok = await confirmAction({
    title: `删除 ${season.name}`,
    message: `确认删除「${season.name}」及其所有轮次和比赛？\n此操作不可撤销。`,
    confirmText: '删除',
    variant: 'danger'
  })
  if (!ok) return

  deletingSeasonId.value = season.id
  try {
    await seasonsStore.deleteSeason(season.id)
    matchesStore.init({ force: true })
    seasonsStore.init({ force: true })
    toast.show(`已删除 ${season.name}`, 'success')
  } catch (e) {
    toast.show('删除失败', 'error')
  } finally {
    deletingSeasonId.value = null
  }
}

const canCreate = computed(() => {
  if (!currentSeason.value || currentSeason.value.status==='completed') return false
  const maxRound = Math.max(0, ...rounds.value.map(r=>r.roundNo))
  const hasUnfinishedRound = rounds.value.some(r =>
    r.status !== STATUS.COMPLETED || getRoundMatches(r.id).some(m => m.status !== STATUS.COMPLETED)
  )
  return maxRound < stats.value.total && !hasUnfinishedRound
})

const showCreate = ref(false)
const creating = ref(false)
const previewPairings = ref([])
const pendingRoundDice = ref(null)
const showSeasonManager = ref(false)

function getS5RoundDice(roundNo) {
  return currentSeason.value?.comebackData?.s5?.roundDice?.[String(roundNo)] || null
}

function getDiceMode(dice) {
  return dice === 1 || dice === 6 ? 'mutation' : 'order'
}

function getDiceModeLabel(mode) {
  return mode === 'mutation' ? '异变 · 15分制' : '秩序 · 21分制'
}

function rollRoundDice() {
  const dice = Math.floor(Math.random() * 6) + 1
  pendingRoundDice.value = {
    dice,
    mode: getDiceMode(dice)
  }
}

function generatePreview() {
  const parts = currentSeason.value?.participants || []
  if (parts.length < 4) return []

  if (currentSeason.value?.ruleId === 's4' && nextRoundNo.value >= 5) {
    const sorted = [...parts].sort()
    const combos = {
      5: { teamA: [sorted[0], sorted[1]], teamB: [sorted[2], sorted[3]] },
      6: { teamA: [sorted[0], sorted[2]], teamB: [sorted[1], sorted[3]] },
      7: { teamA: [sorted[0], sorted[3]], teamB: [sorted[1], sorted[2]] }
    }
    return [combos[nextRoundNo.value] || combos[5]]
  }

  const [a,b,c,d] = [...parts].sort(() => Math.random() - 0.5)
  return [
    { teamA:[a,b], teamB:[c,d] },
    { teamA:[a,c], teamB:[b,d] },
    { teamA:[a,d], teamB:[b,c] }
  ]
}

function openCreate() {
  previewPairings.value = generatePreview()
  pendingRoundDice.value = null
  showCreate.value = true
}

function shufflePreview() {
  previewPairings.value = generatePreview()
}

async function createNextRound() {
  if (requiresBeforeRoundDice.value && !pendingRoundDice.value) {
    toast.show('请先投骰子', 'warning')
    return
  }

  creating.value = true
  try {
    const roundNo = nextRoundNo.value
    const created = await seasonsStore.createRound({
      seasonId: currentSeason.value.id,
      roundNo,
      pairings: supportsRandomPairings.value ? previewPairings.value : undefined,
      beforeRoundSetup: requiresBeforeRoundDice.value
        ? { timing: 'beforeRound', type: 'dice', roundDice: { dice: pendingRoundDice.value.dice } }
        : undefined
    })
    matchesStore.upsertMatches(created?.matches || [])
    toast.show(`第 ${roundNo} 轮已创建`, 'success')
    showCreate.value = false
  } catch(e) { toast.show('创建失败: '+e.message, 'error') }
  creating.value = false
}

function getRoundMatches(rid) {
  const ms = matchesStore.matches.filter(m=>m.roundId===rid).sort((a,b)=>a.id.localeCompare(b.id))
  // Find the first non-completed match - only this one can be played
  const firstPending = ms.findIndex(m => m.status !== STATUS.COMPLETED)
  return ms.map((m, i) => ({
    ...m,
    _playable: i === firstPending || m.status === STATUS.IN_PROGRESS
  }))
}

const isSeasonLocked = computed(() => !isTestMode && currentSeason.value?.status === STATUS.COMPLETED)
const canDeleteCurrentRound = computed(() => {
  if (isSeasonLocked.value) return false
  if (!stats.value.currentRound) return false
  return !getRoundMatches(stats.value.currentRound.id).some(m => m.status === STATUS.COMPLETED)
})

function getTeams(ids) { return ids?.map(id=>playersStore.getPlayerName(id)).join('/')||'—' }
function getScore(mid) { const s=matchesStore.getMatchScore(mid); return s.scoreA+s.scoreB>0?`${s.scoreA}:${s.scoreB}`:'' }
function goScoring(mid) {
  const m = matchesStore.getMatchById(mid)
  router.push(m?.status===STATUS.COMPLETED ? `/matches/${mid}` : `/scoring/${mid}`)
}

async function handleDeleteMatch(match) {
  const ok = await confirmAction({
    title: '删除比赛',
    message: '确认删除这场比赛？',
    confirmText: '删除'
  })
  if (!ok) return
  try { await matchesStore.deleteMatch(match.id); toast.show('已删除','success') }
  catch(e) { toast.show('删除失败','error') }
}

// === FRIENDLY TAB ===
const friendlyMatches = computed(() => matchesStore.allMatches.filter(m => !m.seasonId))
const friendlyLive = computed(() => friendlyMatches.value.filter(m => m.status === STATUS.IN_PROGRESS || m.status === STATUS.PENDING))
const friendlyHistory = computed(() => friendlyMatches.value.filter(m => m.status === STATUS.COMPLETED))

const showFriendlyCreate = ref(false)
const newFriendly = ref({ teamA:[], teamB:[], bestOf:1, date:new Date().toISOString().slice(0,10) })
function togglePlayer(pid, team) {
  const arr = newFriendly.value[team]; const i = arr.indexOf(pid)
  if (i>=0) arr.splice(i,1); else if (arr.length<2) arr.push(pid); else toast.show('每队最多2人','info')
}
function isSelected(pid,team) { return newFriendly.value[team].includes(pid) }
function isPlayerDisabled(pid, team) {
  // Can't select a player already in the opposing team
  const otherTeam = team === 'teamA' ? 'teamB' : 'teamA'
  return newFriendly.value[otherTeam].includes(pid)
}
async function createFriendly() {
  if (newFriendly.value.teamA.length<1||newFriendly.value.teamB.length<1) { toast.show('请选择两队选手','error'); return }
  try {
    await matchesStore.createMatch({
      teamA: newFriendly.value.teamA, teamB: newFriendly.value.teamB,
      bestOf: newFriendly.value.bestOf, date: newFriendly.value.date, type: 'doubles'
    })
    toast.show('友谊赛已创建','success')
    showFriendlyCreate.value = false
    newFriendly.value = { teamA:[], teamB:[], bestOf:1, date:new Date().toISOString().slice(0,10) }
  } catch(e) { toast.show('创建失败','error') }
}

function seasonStatusLabel(status) {
  return status === 'ongoing' ? '进行中' : status === 'pending' ? '未开始' : '已完成'
}

function seasonStatusVariant(status) {
  return status === 'ongoing' ? 'success' : 'muted'
}

onMounted(() => {
  const s = currentSeason.value
  if (s?.color) setViewAccent(getSeasonColor(s.color))
})
</script>

<template>
  <div class="flex flex-col gap-4" :style="viewStyle">
    <!-- Parent tabs -->
    <SegmentedControl v-model="parentTab" :options="parentTabOptions" />

    <!-- ====== SEASON TAB ====== -->
    <template v-if="parentTab==='season'">
      <!-- Season selector -->
      <SeasonTabs :seasons="seasonsStore.seasons" :selected-id="selectedSeasonId" :deletable="isTestMode" @select="selectSeason" @delete="handleDeleteSeason" />
      <Button v-if="hasNextSeasonPreset" variant="secondary" size="sm" block @click="showSeasonManager = true">+ 创建赛季</Button>

      <EmptyState v-if="!currentSeason" icon="BarChart3" title="暂无赛季" />

      <template v-else>
        <!-- Progress -->
        <Card padding="md">
          <div class="flex items-start justify-between mb-3">
            <div>
              <h3 class="text-sm font-semibold text-fg">第 {{ stats.currentRoundNo }}/{{ stats.total }} 轮</h3>
            </div>
            <Badge :variant="seasonStatusVariant(currentSeason.status)" size="sm">{{ seasonStatusLabel(currentSeason.status) }}</Badge>
          </div>
          <div class="h-1.5 bg-line rounded-full overflow-hidden mb-3"><div class="h-full bg-accent rounded-full fill" :style="{width:(stats.currentRoundNo/stats.total*100)+'%'}"></div></div>
          <div class="flex flex-wrap gap-2">
            <Button v-if="canCreate" variant="primary" size="sm" @click="openCreate">+ 创建第 {{ nextRoundNo }} 轮</Button>
          </div>
        </Card>

        <!-- Current round -->
        <Card v-if="stats.currentRound" padding="md">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h3 class="sec-title !mb-0">第 {{ stats.currentRound.roundNo }} 轮 · {{ stats.currentRound.status==='in_progress'?'进行中':'待开始' }}</h3>
              <Badge
                v-if="requiresBeforeRoundDice && getS5RoundDice(stats.currentRound.roundNo)"
                :variant="getS5RoundDice(stats.currentRound.roundNo).mode === 'mutation' ? 'danger' : 'success'"
                size="sm"
                class="mt-2"
              >
                骰子 {{ getS5RoundDice(stats.currentRound.roundNo).dice }} · {{ getDiceModeLabel(getS5RoundDice(stats.currentRound.roundNo).mode) }}
              </Badge>
            </div>
            <button v-if="canDeleteCurrentRound" class="w-7 h-7 border-none rounded-full bg-transparent text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast shrink-0 active:scale-90 hover:bg-danger-subtle hover:text-danger" @click="handleDeleteRound(stats.currentRound)" title="删除轮次">
              <Trash2 :size="14" />
            </button>
          </div>
          <div class="flex flex-col gap-2">
            <div v-for="m in getRoundMatches(stats.currentRound.id).filter(m=>m.status!==STATUS.COMPLETED)" :key="m.id" class="flex items-center gap-2 py-2.5 border-b border-line-light last:border-b-0 pl-2.5" :class="{'m-row-live':m.status===STATUS.IN_PROGRESS}">
              <span class="flex-1 text-sm font-medium truncate" :class="{'cursor-pointer':m._playable}" @click="m._playable && goScoring(m.id)">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
              <span class="text-sm font-semibold font-mono text-accent" v-if="getScore(m.id)">{{ getScore(m.id) }}</span>
              <Badge v-else-if="m.status===STATUS.PENDING" variant="warning" size="sm">待打</Badge>
              <Badge v-else variant="success" size="sm">Live</Badge>
              <button v-if="m.status===STATUS.IN_PROGRESS && m._playable" class="m-go" @click="goScoring(m.id)">记分</button>
              <button v-else-if="m.status===STATUS.PENDING && m._playable" class="m-go" @click="goScoring(m.id)">开始</button>
            </div>
          </div>
        </Card>

        <div v-else-if="stats.completed===0" class="text-center p-4 text-sm text-fg-muted">暂无轮次，创建第一轮开始比赛</div>
        <div v-else-if="stats.completed===stats.total" class="text-center p-4 text-sm text-fg-muted">全部轮次已完成</div>

        <!-- Create button between current round and records -->
        <Button v-if="canCreate && stats.currentRound" variant="primary" size="md" block @click="openCreate">+ 创建第 {{ nextRoundNo }} 轮</Button>

        <!-- Round-by-round history: all rounds with completed matches -->
        <Card v-if="completedRounds.length" padding="md">
          <h3 class="sec-title">比赛记录</h3>
          <div class="flex flex-col gap-3">
            <div v-for="round in [...completedRounds].reverse()" :key="round.id" class="flex flex-col gap-1 pt-4 border-t-2 border-line first:border-t-0 first:pt-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-bold font-mono">R{{ round.roundNo }}</span>
                <Badge :variant="round.status==='completed'?'muted':'success'" size="sm">{{ round.status==='completed'?'已完成':'进行中' }}</Badge>
              </div>
              <div class="flex flex-col gap-1">
                <div v-for="m in getRoundMatches(round.id).filter(m=>m.status===STATUS.COMPLETED)" :key="m.id" class="flex items-center gap-2 py-2.5 pl-2.5 border-b border-line-light last:border-b-0 cursor-pointer active:opacity-70" @click="goScoring(m.id)">
                  <span class="flex-1 text-sm font-medium truncate">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
                  <span class="text-sm font-semibold font-mono text-accent" v-if="getScore(m.id)">{{ getScore(m.id) }}</span>
                  <Badge v-else-if="m.status===STATUS.PENDING" variant="warning" size="sm">待打</Badge>
                  <Badge v-else variant="success" size="sm">Live</Badge>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </template>

      <!-- Create round sheet -->
      <Sheet :show="showCreate" title="创建下一轮" @close="showCreate=false">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-fg-secondary">为「{{ currentSeason?.name }}」创建第 {{ nextRoundNo }} 轮</p>
          <div v-if="requiresBeforeRoundDice" class="p-3 rounded-lg border flex flex-col gap-3" :class="pendingRoundDice ? 'border-accent bg-accent-subtle' : 'border-line bg-canvas'">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h4 class="text-sm font-semibold text-fg">赛前投骰</h4>
                <p class="mt-1 text-xs text-fg-secondary">{{ pendingRoundDice ? getDiceModeLabel(pendingRoundDice.mode) : '待投骰' }}</p>
              </div>
              <Badge :variant="pendingRoundDice?.mode === 'mutation' ? 'danger' : pendingRoundDice ? 'success' : 'muted'" size="sm">
                {{ pendingRoundDice ? `骰子 ${pendingRoundDice.dice}` : '未完成' }}
              </Badge>
            </div>
            <button class="h-12 rounded-lg border border-line bg-surface flex items-center justify-center gap-2 text-accent font-semibold cursor-pointer transition-all duration-fast active:scale-[0.98]" @click="rollRoundDice">
              <Dice5 :size="18" />
              <span class="text-xl font-mono">{{ pendingRoundDice?.dice || '?' }}</span>
            </button>
          </div>
          <div class="flex flex-col gap-1 p-3 bg-canvas rounded-md" v-if="previewPairings.length>0">
            <p class="text-xs text-fg-muted mb-1">{{ pairingPreviewNote }}</p>
            <div v-for="(p,i) in previewPairings" :key="i" class="flex gap-2 text-sm">
              <span class="font-semibold text-fg-muted font-mono">M{{ i+1 }}</span>
              <span>{{ getTeams(p.teamA) }} vs {{ getTeams(p.teamB) }}</span>
            </div>
          </div>
          <Button v-if="supportsRandomPairings" variant="secondary" size="sm" @click="shufflePreview"><RefreshCw :size="14" class="inline mr-1" />重新随机</Button>
          <div class="flex gap-3 [&>*]:flex-1">
            <Button variant="secondary" size="md" @click="showCreate=false">取消</Button>
            <Button variant="primary" size="md" :loading="creating" :disabled="requiresBeforeRoundDice && !pendingRoundDice" @click="createNextRound">确认</Button>
          </div>
        </div>
      </Sheet>

      <!-- Edit round sheet -->
      <Sheet :show="showEditRound" title="编辑轮次" @close="showEditRound=false">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-fg-secondary">R{{ editingRound?.roundNo }} · 当前状态: {{ editingRound?.status==='completed'?'已完成':editingRound?.status==='in_progress'?'进行中':'待开始' }}</p>
          <div class="flex gap-3 [&>*]:flex-1">
            <Button variant="secondary" size="md" @click="showEditRound=false">取消</Button>
            <Button variant="primary" size="md" @click="saveRoundEdit">保存</Button>
          </div>
        </div>
      </Sheet>

      <Sheet :show="showSeasonManager" title="创建赛季" @close="showSeasonManager = false">
        <SeasonPresetManager @created="showSeasonManager = false" @close="showSeasonManager = false" />
      </Sheet>
    </template>

    <!-- ====== FRIENDLY TAB ====== -->
    <template v-if="parentTab==='friendly'">
      <Button variant="primary" size="md" block @click="showFriendlyCreate=true">+ 发起友谊赛</Button>

      <!-- Live friendly -->
      <Card v-if="friendlyLive.length>0" padding="md">
        <h3 class="sec-title">进行中</h3>
        <div class="flex flex-col gap-2">
          <div v-for="m in friendlyLive" :key="m.id" class="flex items-center gap-2 py-2.5 border-b border-line-light last:border-b-0 cursor-pointer active:opacity-70 active:bg-surface-hover" :class="{'!border-success !bg-success-subtle':m.status===STATUS.IN_PROGRESS}" @click="goScoring(m.id)">
            <span class="flex-1 text-sm font-medium truncate">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
            <span class="text-sm font-semibold font-mono text-accent" v-if="getScore(m.id)">{{ getScore(m.id) }}</span>
            <Badge v-else variant="warning" size="sm">待打</Badge>
            <button class="w-7 h-7 border-none rounded-full bg-transparent text-fg-muted flex items-center justify-center cursor-pointer transition-all duration-fast shrink-0 active:scale-90 hover:bg-danger-subtle hover:text-danger" @click.stop="handleDeleteMatch(m)" title="删除">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </Card>

      <!-- Friendly history -->
      <Card v-if="friendlyHistory.length>0" padding="md">
        <h3 class="sec-title">友谊赛记录</h3>
        <div class="flex flex-col gap-2">
          <div v-for="m in friendlyHistory" :key="m.id" class="flex items-center gap-2 py-2.5 border-b border-line-light last:border-b-0 cursor-pointer active:opacity-70 active:bg-surface-hover" @click="goScoring(m.id)">
            <span class="text-xs text-fg-muted min-w-[42px] shrink-0">{{ m.date?.slice(5) || '—' }}</span>
            <span class="flex-1 text-sm font-medium truncate">{{ getTeams(m.teamA) }} vs {{ getTeams(m.teamB) }}</span>
            <span class="text-sm font-semibold font-mono text-accent" v-if="getScore(m.id)">{{ getScore(m.id) }}</span>
          </div>
        </div>
      </Card>

      <EmptyState v-if="friendlyMatches.length===0" icon="Dumbbell" title="暂无友谊赛" description="点击上方按钮发起" />

      <!-- Create friendly sheet -->
      <Sheet :show="showFriendlyCreate" title="发起友谊赛" @close="showFriendlyCreate=false">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-secondary">A 队</h4>
            <div class="flex flex-wrap gap-2">
              <button v-for="p in playersStore.players" :key="'a'+p.id" class="flex items-center gap-2 px-3 py-2 rounded-full border border-line bg-canvas text-sm cursor-pointer transition-all duration-fast active:scale-95" :class="{'bg-accent-subtle border-accent text-accent':isSelected(p.id,'teamA'), 'opacity-35 cursor-not-allowed':isPlayerDisabled(p.id,'teamA')}" :disabled="isPlayerDisabled(p.id,'teamA')" @click="togglePlayer(p.id,'teamA')"><Avatar :name="p.name" size="sm"/><span>{{p.name}}</span></button>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-secondary">B 队</h4>
            <div class="flex flex-wrap gap-2">
              <button v-for="p in playersStore.players" :key="'b'+p.id" class="flex items-center gap-2 px-3 py-2 rounded-full border border-line bg-canvas text-sm cursor-pointer transition-all duration-fast active:scale-95" :class="{'bg-accent-subtle border-accent text-accent':isSelected(p.id,'teamB'), 'opacity-35 cursor-not-allowed':isPlayerDisabled(p.id,'teamB')}" :disabled="isPlayerDisabled(p.id,'teamB')" @click="togglePlayer(p.id,'teamB')"><Avatar :name="p.name" size="sm"/><span>{{p.name}}</span></button>
            </div>
          </div>
          <Input label="日期" type="date" v-model="newFriendly.date" />
          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-fg-secondary uppercase tracking-wider">局数</label>
            <div class="flex gap-2">
              <button class="flex-1 p-2.5 border border-line rounded-lg bg-canvas text-sm cursor-pointer transition-all duration-fast" :class="newFriendly.bestOf===1 ? 'border-accent bg-accent-subtle text-accent font-medium' : ''" @click="newFriendly.bestOf=1">一局定胜负</button>
              <button class="flex-1 p-2.5 border border-line rounded-lg bg-canvas text-sm cursor-pointer transition-all duration-fast" :class="newFriendly.bestOf===3 ? 'border-accent bg-accent-subtle text-accent font-medium' : ''" @click="newFriendly.bestOf=3">三局两胜</button>
            </div>
          </div>
          <div class="flex gap-3 [&>*]:flex-1">
            <Button variant="secondary" size="md" @click="showFriendlyCreate=false">取消</Button>
            <Button variant="primary" size="md" @click="createFriendly">创建</Button>
          </div>
        </div>
      </Sheet>
    </template>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.fill { transition:width 0.5s var(--ease-out); }
.sec-title { @apply text-xs font-semibold text-fg-secondary uppercase tracking-wider mb-3; }
.m-row-live { @apply relative rounded-md bg-success-subtle border border-success/30; padding-left: 0.625rem; padding-right: 0.375rem; }
.m-go { @apply px-2.5 py-1 border border-accent rounded-lg bg-accent-subtle text-accent text-xs cursor-pointer font-medium transition-all duration-fast active:scale-95; }
</style>
