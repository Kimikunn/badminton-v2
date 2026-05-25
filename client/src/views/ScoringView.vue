<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayersStore, useMatchesStore, useSeasonsStore } from '@/stores'
import { STATUS, BEST_OF_OPTIONS } from '@/constants'
import { getRule } from '@/rules'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import GameScoreInput from '@/components/match/GameScoreInput.vue'
import CompletedGamesList from '@/components/match/CompletedGamesList.vue'
import EndGameConfirmSheet from '@/components/match/EndGameConfirmSheet.vue'
import { Trophy, Dumbbell, Pause, ArrowLeft } from 'lucide-vue-next'
import { useToast } from '@/composables/useToast'
import { useConfirm } from '@/composables/useConfirm'
import { useScoringValidation } from '@/composables/useScoringValidation'

const route = useRoute()
const router = useRouter()
const playersStore = usePlayersStore()
const matchesStore = useMatchesStore()
const seasonsStore = useSeasonsStore()
const toast = useToast()
const { confirm: confirmAction } = useConfirm()
const currentValidation = useScoringValidation()
const editValidation = useScoringValidation()

const matchId = computed(() => route.params.matchId)
const isLoading = ref(true)

const match = computed(() => matchesStore.getMatchById(matchId.value))
const games = computed(() => matchesStore.getGamesByMatch(matchId.value))
const completedGames = computed(() => games.value.filter(g => g.status === STATUS.COMPLETED))
const currentGame = computed(() => games.value.find(g => g.status === STATUS.IN_PROGRESS))
const matchScore = computed(() => matchesStore.getMatchScore(matchId.value))
const bestOf = computed(() => matchesStore.getMatchBestOf(matchId.value))
const season = computed(() => match.value?.seasonId ? seasonsStore.getSeasonById(match.value.seasonId) : null)
const round = computed(() => match.value?.roundId ? seasonsStore.getRoundById(match.value.roundId) : null)
const gameConfig = computed(() => {
  if (season.value?.ruleId === 's5' && round.value) {
    return getRule('s5').getGameConfig(round.value.roundNo, { season: season.value })
  }
  return { scoringMode: 'standard', targetScore: 21, maxScore: 30, requiresWinner: false, supportsPierce: false }
})
const targetScore = computed(() => gameConfig.value.targetScore || 21)
const maxScore = computed(() => gameConfig.value.maxScore || (targetScore.value === 15 ? 21 : 30))
const requiresWinner = computed(() => !!gameConfig.value.requiresWinner)
const supportsPierce = computed(() => !!gameConfig.value.supportsPierce)

const teamAPlayers = computed(() => match.value?.teamA?.map(id => playersStore.getPlayerName(id)) || [])
const teamBPlayers = computed(() => match.value?.teamB?.map(id => playersStore.getPlayerName(id)) || [])

const isMatchOver = computed(() => match.value?.status === STATUS.COMPLETED)
const hasCurrentGame = computed(() => !!currentGame.value)

const scoreA = ref(0)
const scoreB = ref(0)
const selectedWinner = ref(null)
const pierceTeam = ref('')

// Edit completed game refs (declared early for watch)
const editingGame = ref(null)
const editForm = ref({ scoreA: 0, scoreB: 0, winner: null, pierceTeam: '' })

function winnerLabel(winner) {
  return winner === 'a' ? teamAPlayers.value.join('/') : teamBPlayers.value.join('/')
}

function teamLabel(team) {
  if (team === 'a') return teamAPlayers.value.join('/') || 'A队'
  if (team === 'b') return teamBPlayers.value.join('/') || 'B队'
  return '未知队伍'
}

function teamShortLabel(team) {
  if (team === 'a') return 'A队'
  if (team === 'b') return 'B队'
  return ''
}

function getGameRuleEvents(game, type = null) {
  const events = Array.isArray(game?.ruleEvents) ? game.ruleEvents : []
  return type ? events.filter(event => event.type === type) : events
}

function getRuleEventBadges(game) {
  return getGameRuleEvents(game).map(event => {
    if (event.type === 'pierce') {
      return { id: event.id, label: `贯穿 · ${teamShortLabel(event.payload?.team)}`, variant: 'purple' }
    }
    if (event.type === 'resistance') {
      return { id: event.id, label: '抵抗', variant: 'warning' }
    }
    return { id: event.id, label: event.type, variant: 'muted' }
  })
}

function getRuleEventNotices(events = []) {
  return events.map(event => {
    if (event.type === 'pierce') return `贯穿已记录：${teamLabel(event.payload?.team)}`
    if (event.type === 'resistance') return '抵抗已记录'
    return ''
  }).filter(Boolean)
}

function getPierceTeam(game) {
  return getGameRuleEvents(game, 'pierce')[0]?.payload?.team || ''
}

function validationOptions(winner = selectedWinner.value) {
  return {
    targetScore: targetScore.value,
    maxScore: maxScore.value,
    scoringMode: gameConfig.value.scoringMode,
    winnerOverride: winner
  }
}

watch(currentGame, (g) => {
  if (g) {
    scoreA.value = g.scoreA || 0
    scoreB.value = g.scoreB || 0
    selectedWinner.value = null
    pierceTeam.value = ''
  }
}, { immediate: true })

// 实时验证当前局比分
watch([scoreA, scoreB, selectedWinner], ([a, b]) => {
  if (!hasCurrentGame.value || isMatchOver.value) return
  if (a === 0 && b === 0) {
    currentValidation.clearValidation()
    return
  }
  currentValidation.validateGameScore(a, b, validationOptions())
})

// 实时验证编辑框比分
watch(() => [editForm.value.scoreA, editForm.value.scoreB, editForm.value.winner], ([a, b, winner]) => {
  editValidation.validateGameScore(a, b, validationOptions(winner))
}, { immediate: true })

async function ensureStarted() {
  if (!match.value || match.value.status !== STATUS.PENDING) return true
  try { await matchesStore.startMatch(matchId.value); return true }
  catch(e) { toast.show('开始失败', 'error'); return false }
}

const saving = ref(false)
const showEndConfirm = ref(false)

// 输入框边框动态类
const scoreInputBorderClass = computed(() => {
  if (!hasCurrentGame.value || isMatchOver.value) return 'border-line'
  if (!currentValidation.isValid.value && (scoreA.value > 0 || scoreB.value > 0)) {
    return 'border-[var(--color-danger)]'
  }
  if (currentValidation.validation.value.canEnd) {
    return 'border-[var(--color-success)]'
  }
  return 'border-line'
})

function openEndConfirm() {
  const a = Number(scoreA.value) || 0
  const b = Number(scoreB.value) || 0
  if (a === 0 && b === 0) { toast.show('请先记录比分', 'warning'); return }

  const result = currentValidation.validateGameScore(a, b, validationOptions())
  if (!result.canEnd) {
    toast.show(result.reason, 'warning')
    return
  }
  showEndConfirm.value = true
}

async function handleEndGame() {
  if (!currentGame.value) return
  saving.value = true
  try {
    const res = await matchesStore.endGame(
      currentGame.value.id, scoreA.value, scoreB.value, selectedWinner.value,
      { pierceTeam: pierceTeam.value || null }
    )
    await seasonsStore.init({ force: true })
    const notices = getRuleEventNotices(res.data?.ruleEvents)
    toast.show(notices.length ? notices.join('，') : '本局结束', 'success')
    showEndConfirm.value = false
  } catch(e) { toast.show(e.message, 'error') }
  saving.value = false
}

async function handleRevertLast() {
  const last = completedGames.value[completedGames.value.length - 1]
  if (!last) return
  const ok = await confirmAction({
    title: '撤回本局',
    message: `确认撤回 G${last.gameNo}（${last.scoreA}:${last.scoreB}）？\n撤回后可重新记分。`,
    confirmText: '撤回'
  })
  if (!ok) return
  try { await matchesStore.revertGame(last.id); toast.show('已撤回', 'success') }
  catch(e) { toast.show(e.message, 'error') }
}

const showEdit = ref(false)
function openEdit(g) {
  editingGame.value = g
  editForm.value = { scoreA: g.scoreA || 0, scoreB: g.scoreB || 0, winner: g.winner || null, pierceTeam: getPierceTeam(g) }
  editValidation.validateGameScore(g.scoreA || 0, g.scoreB || 0, validationOptions(editForm.value.winner))
  showEdit.value = true
}
async function saveEdit() {
  const result = editValidation.validateGameScore(editForm.value.scoreA, editForm.value.scoreB, validationOptions(editForm.value.winner))
  if (!result.canEnd) {
    toast.show(result.reason, 'warning')
    return
  }
  try {
    const res = await matchesStore.updateCompletedGameScore(
      editingGame.value.id,
      Number(editForm.value.scoreA), Number(editForm.value.scoreB),
      editForm.value.winner,
      { pierceTeam: editForm.value.pierceTeam || null }
    )
    await seasonsStore.init({ force: true })
    const notices = getRuleEventNotices(res.data?.ruleEvents)
    toast.show(notices.length ? notices.join('，') : '已更新', 'success')
    showEdit.value = false
  } catch (e) { toast.show(e.message, 'error') }
}

async function goBack() {
  if (hasCurrentGame.value && !isMatchOver.value && currentGame.value) {
    const a = parseInt(scoreA.value) || 0
    const b = parseInt(scoreB.value) || 0
    if (a > 0 || b > 0) {
      try { await matchesStore.setGameScore(matchId.value, a, b) }
      catch(e) { /* ignore */ }
    }
  }
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/matches')
  }
}

onMounted(async () => { await ensureStarted(); isLoading.value = false })
</script>

<template>
  <div class="p-4 flex flex-col gap-4 min-h-dvh">
    <div v-if="isLoading" class="text-center p-16 text-fg-muted">加载中...</div>
    <EmptyState v-else-if="!match" icon="Dumbbell" title="比赛未找到" action-label="返回" @action="goBack" />

    <template v-else>
      <!-- Header -->
      <div class="flex items-center gap-2">
        <button class="w-9 h-9 rounded-full bg-surface-hover text-fg-secondary flex items-center justify-center cursor-pointer border-none transition-transform duration-fast active:scale-90" @click="goBack">
          <ArrowLeft :size="20" />
        </button>
        <div class="flex items-center gap-2">
          <Badge :variant="isMatchOver?'muted':'success'" size="sm">{{ isMatchOver?'已结束':'进行中' }}</Badge>
          <span class="text-sm text-fg-muted">{{ BEST_OF_OPTIONS.find(o=>o.value===bestOf)?.label }}</span>
        </div>
        <span class="ml-auto text-lg font-bold font-mono text-fg">{{ matchScore.scoreA }}:{{ matchScore.scoreB }}</span>
      </div>

      <GameScoreInput
        v-model:score-a="scoreA"
        v-model:score-b="scoreB"
        :match-score="matchScore"
        :team-a-players="teamAPlayers"
        :team-b-players="teamBPlayers"
        :best-of="bestOf"
        :max-score="maxScore"
        :has-current-game="hasCurrentGame"
        :is-match-over="isMatchOver"
        :border-class="scoreInputBorderClass"
      />

      <!-- Validation hint -->
      <p v-if="hasCurrentGame && !isMatchOver && currentValidation.errorMessage" class="text-xs text-center text-[var(--color-danger)] -mt-2 mb-1 min-h-[1.25rem] leading-tight">
        {{ currentValidation.errorMessage }}
      </p>

      <Card v-if="hasCurrentGame && !isMatchOver && requiresWinner" padding="sm">
        <div class="flex flex-col gap-3">
          <div>
            <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">秩序 · 抵抗</h3>
            <p class="text-xs text-fg-muted mt-1">抵抗局需要选择本局胜方，分高者不一定获胜。</p>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="rule-choice" :class="{ active: selectedWinner === 'a' }" @click="selectedWinner='a'">{{ teamAPlayers.join('/') }}</button>
            <button class="rule-choice" :class="{ active: selectedWinner === 'b' }" @click="selectedWinner='b'">{{ teamBPlayers.join('/') }}</button>
          </div>
          <div v-if="supportsPierce" class="flex flex-col gap-2">
            <span class="text-xs font-medium text-fg-secondary">贯穿触发</span>
            <div class="grid grid-cols-3 gap-2">
              <button class="rule-choice" :class="{ active: pierceTeam === '' }" @click="pierceTeam=''">无</button>
              <button class="rule-choice" :class="{ active: pierceTeam === 'a' }" @click="pierceTeam='a'">A队</button>
              <button class="rule-choice" :class="{ active: pierceTeam === 'b' }" @click="pierceTeam='b'">B队</button>
            </div>
          </div>
        </div>
      </Card>

      <CompletedGamesList
        :games="completedGames"
        :has-current-game="hasCurrentGame"
        :is-match-over="isMatchOver"
        :get-rule-event-badges="getRuleEventBadges"
        @edit-game="openEdit"
        @revert-last="handleRevertLast"
      />

      <!-- Actions -->
      <div class="mt-auto pt-4 flex flex-col gap-2" v-if="!isMatchOver">
        <template v-if="hasCurrentGame">
          <Button variant="primary" size="lg" block @click="openEndConfirm">结束本局</Button>
          <Button variant="ghost" size="md" block @click="goBack">暂停</Button>
        </template>
        <EmptyState v-else icon="Pause" title="无进行中的局" description="撤回最后一局后重新记分" />
      </div>

      <!-- Result -->
      <Card v-if="isMatchOver" padding="md">
        <div class="text-center p-4">
          <Trophy :size="32" class="text-2xl block mb-2 text-accent" />
          <p class="text-lg font-semibold text-fg">{{ match.winner==='a' ? teamAPlayers.join(' ') : teamBPlayers.join(' ') }} 获胜</p>
          <Button variant="secondary" size="sm" @click="goBack" class="mt-3">返回</Button>
        </div>
      </Card>
    </template>

    <EndGameConfirmSheet
      :show="showEndConfirm"
      :score-a="scoreA"
      :score-b="scoreB"
      :winner-name="winnerLabel(currentValidation.validation.value.winner)"
      :saving="saving"
      @close="showEndConfirm=false"
      @confirm="handleEndGame"
    />

    <!-- Edit game -->
    <Teleport to="body">
      <div v-if="showEdit" class="overlay" @click.self="showEdit=false">
        <div class="sheet">
          <h3 class="text-lg font-semibold mb-2 text-fg">修改 G{{ editingGame?.gameNo }} 比分</h3>
          <div class="flex items-center gap-3 mb-3">
            <div class="flex-1 text-center">
              <label class="block text-sm font-medium text-fg mb-1">{{ teamAPlayers.join('/') }}</label>
              <input type="number" class="fld"
                :class="{'!border-[var(--color-danger)]': !editValidation.isValid.value, '!border-[var(--color-success)]': editValidation.validation.value.canEnd}"
                v-model.number="editForm.scoreA" />
            </div>
            <span class="text-sm text-fg-muted font-bold pt-6">VS</span>
            <div class="flex-1 text-center">
              <label class="block text-sm font-medium text-fg mb-1">{{ teamBPlayers.join('/') }}</label>
              <input type="number" class="fld"
                :class="{'!border-[var(--color-danger)]': !editValidation.isValid.value, '!border-[var(--color-success)]': editValidation.validation.value.canEnd}"
                v-model.number="editForm.scoreB" />
            </div>
          </div>
          <p class="text-xs mb-4 min-h-[1.25rem] leading-tight" :class="editValidation.errorMessage ? 'text-[var(--color-danger)]' : 'text-fg-muted'">
            {{ editValidation.errorMessage || '需符合21分制规则' }}
          </p>
          <div v-if="requiresWinner" class="mb-4 flex flex-col gap-2">
            <span class="text-xs font-medium text-fg-secondary">本局胜方</span>
            <div class="grid grid-cols-2 gap-2">
              <button class="rule-choice" :class="{ active: editForm.winner === 'a' }" @click="editForm.winner='a'">{{ teamAPlayers.join('/') }}</button>
              <button class="rule-choice" :class="{ active: editForm.winner === 'b' }" @click="editForm.winner='b'">{{ teamBPlayers.join('/') }}</button>
            </div>
          </div>
          <div v-if="supportsPierce" class="mb-4 flex flex-col gap-2">
            <span class="text-xs font-medium text-fg-secondary">贯穿触发</span>
            <div class="grid grid-cols-3 gap-2">
              <button class="rule-choice" :class="{ active: editForm.pierceTeam === '' }" @click="editForm.pierceTeam=''">无</button>
              <button class="rule-choice" :class="{ active: editForm.pierceTeam === 'a' }" @click="editForm.pierceTeam='a'">A队</button>
              <button class="rule-choice" :class="{ active: editForm.pierceTeam === 'b' }" @click="editForm.pierceTeam='b'">B队</button>
            </div>
          </div>
          <div class="flex gap-3">
            <Button variant="secondary" size="md" class="flex-1" @click="showEdit=false">取消</Button>
            <Button variant="primary" size="md" class="flex-1" @click="saveEdit">保存</Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@reference "@/styles/global.css";
/* Edit game overlay — complex fixed positioning */
.overlay { position:fixed; inset:0; z-index:100; display:flex; align-items:flex-end; justify-content:center; background:rgba(0,0,0,0.4); backdrop-filter:blur(8px); }
.sheet { @apply w-full max-w-[480px]; background:var(--color-surface); border-radius:var(--radius-xl) var(--radius-xl) 0 0; padding:var(--space-6) var(--space-5) calc(var(--space-5) + var(--safe-bottom)); }

/* Handle */
.sheet::before { content:''; display:block; width:36px; height:5px; border-radius:9999px; background:var(--color-border); margin:0 auto var(--space-4); }

/* Form field */
.fld { @apply w-full p-2.5 text-center text-2xl font-bold font-mono border border-line rounded-lg bg-canvas text-fg outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-subtle transition-[border-color,box-shadow] duration-fast; }
.rule-choice { @apply min-h-9 px-3 py-2 rounded-lg border border-line bg-canvas text-sm text-fg-secondary font-medium cursor-pointer transition-all duration-fast active:scale-[0.98]; }
.rule-choice.active { @apply border-accent bg-accent-subtle text-accent; }
</style>
