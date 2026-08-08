<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePlayersStore, useMatchesStore, useSeasonsStore } from '@/stores'
import { STATUS, BEST_OF_OPTIONS } from '@/constants'
import { getRule } from '@/rules'
import s6Rule, { KING_FORMS, TREASURY_CARDS, PRE_GAME_CARDS, ANYTIME_CARDS } from '@/rules/s6'
import Card from '@/components/ui/Card.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'
import Sheet from '@/components/ui/Sheet.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import GameScoreInput from '@/components/match/GameScoreInput.vue'
import CompletedGamesList from '@/components/match/CompletedGamesList.vue'
import EndGameConfirmSheet from '@/components/match/EndGameConfirmSheet.vue'
import { Trophy, Dumbbell, Pause, ArrowLeft, Crown, Gem, Zap, History } from 'lucide-vue-next'
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
  const rule = season.value?.ruleId ? getRule(season.value.ruleId) : null
  if (rule && round.value && typeof rule.getGameConfig === 'function') {
    return rule.getGameConfig(round.value.roundNo, { season: season.value, match: match.value, game: currentGame.value })
  }
  return { scoringMode: 'standard', targetScore: 21, maxScore: 30, requiresWinner: false, supportsPierce: false }
})
const targetScore = computed(() => gameConfig.value.targetScore || 21)
const maxScore = computed(() => gameConfig.value.maxScore || (targetScore.value === 15 ? 21 : 30))
const requiresWinner = computed(() => !!gameConfig.value.requiresWinner)
const supportsPierce = computed(() => !!gameConfig.value.supportsPierce)

// S6 王形态提示：上篇王参与的比赛中展示生效中的形态规则（局内人工记分）
const kingFormHint = computed(() => {
  if (season.value?.ruleId !== 's6') return null
  const { kingId, kingForm } = gameConfig.value
  const form = KING_FORMS[kingForm]
  if (!kingId || !form) return null
  const inMatch = match.value?.teamA?.includes(kingId) || match.value?.teamB?.includes(kingId)
  if (!inMatch) return null
  return `${form.name}形态：${form.effect}`
})

// ---- S6 下篇（王之宝库卡片效果执行）----
const isS6Combo = computed(() =>
  season.value?.ruleId === 's6' && !!round.value && s6Rule.isComboRound(round.value.roundNo)
)
const s6Context = computed(() => ({ season: season.value, match: match.value, round: round.value }))
const matchTreasury = computed(() =>
  isS6Combo.value ? s6Rule.getMatchTreasury(matchId.value, s6Context.value) : null
)

function sideName(side) {
  return side === 'a' ? (teamAPlayers.value.join('/') || 'A队') : (teamBPlayers.value.join('/') || 'B队')
}

// 暗选目标局：比赛未开始 → 第 1 局（开始前必须提交）；进行中 → 当前局的下一局
// （服务端只允许在该局 pending/未创建时提交暗选）
const secretGameNo = computed(() => {
  if (!isS6Combo.value || isMatchOver.value) return null
  if (match.value?.status === STATUS.PENDING) return 1
  if (currentGame.value) return currentGame.value.gameNo + 1
  return null
})
const secretState = computed(() => {
  const gameNo = secretGameNo.value
  if (!gameNo || gameNo > bestOf.value) return null
  return s6Rule.getPendingSecretState(matchId.value, gameNo, s6Context.value)
})

const showSecretSheet = ref(false)
const secretSide = ref('a')
const secretSubmitting = ref(false)
const secretOptions = computed(() => {
  const inventory = matchTreasury.value?.sides?.[secretSide.value]?.inventory || {}
  return PRE_GAME_CARDS.map(cardId => ({
    cardId,
    ...TREASURY_CARDS[cardId],
    remaining: inventory[cardId] || 0
  }))
})

function openSecretSheet(side) {
  secretSide.value = side
  showSecretSheet.value = true
}

async function submitSecret(cardId) {
  if (!secretState.value || secretSubmitting.value) return
  secretSubmitting.value = true
  try {
    await seasonsStore.recordAction(season.value.id, 's6_card_activate', {
      matchId: matchId.value,
      gameNo: secretState.value.gameNo,
      side: secretSide.value,
      cardId
    })
    toast.show(cardId ? `${TREASURY_CARDS[cardId].name}已暗选` : '已提交不使用', 'success')
    showSecretSheet.value = false
  } catch (e) { toast.show(e.message, 'error') }
  secretSubmitting.value = false
}

// 第 1 局双方暗选亮出后才允许开始比赛（服务端只接受 pending 局的暗选）
const canStartS6Match = computed(() =>
  isS6Combo.value && match.value?.status === STATUS.PENDING && !!secretState.value?.revealed
)
const startingMatch = ref(false)
async function handleStartMatch() {
  startingMatch.value = true
  try {
    const ok = await matchesStore.startMatch(matchId.value)
    if (!ok) toast.show('开始失败', 'error')
  } catch (e) { toast.show(e.message || '开始失败', 'error') }
  startingMatch.value = false
}

// 名刀提示：使用后展示到下一球比分变动/换局为止
const bladeUsedSide = ref(null)

// 局中提示条：本局已亮出的暗选效果 + 天选 + 名刀（中性色，仅提示，局内人工记分）
const effectHints = computed(() => {
  if (!isS6Combo.value || isMatchOver.value) return []
  const effects = gameConfig.value.activeEffects
  if (!effects) return []
  const hints = []
  if (effects.blast) hints.push({ id: 'blast', text: '爆破：每球得 2 分，先到 11 分结束（封顶 12）' })
  if (effects.block) hints.push({ id: 'block', text: `阻碍：${sideName(effects.block)}启用，对方本局获胜无法获得终结分` })
  if (effects.charge) hints.push({ id: 'charge', text: `进击：${sideName(effects.charge)}本局获胜额外获得一次连胜计数` })
  if (effects.stardust) hints.push({ id: 'stardust', text: `星尘卡：${sideName(effects.stardust)}本局获胜 +2 星尘（净胜 ≥7 再 +1），失败阻挡对方一次连胜计数` })
  if (effects.storage) hints.push({ id: 'storage', text: `存储器：${sideName(effects.storage)}本局结束后录入额外球得分（胜 5 球 / 负 3 球）` })
  if (effects.chosenA) hints.push({ id: 'chosenA', text: `天选：${sideName('a')}每局 2:0 开局` })
  if (effects.chosenB) hints.push({ id: 'chosenB', text: `天选：${sideName('b')}每局 2:0 开局` })
  if (bladeUsedSide.value) hints.push({ id: 'blade', text: '名刀已启用：下一球对方得分无效' })
  return hints
})

// 随时卡（暂停卡/名刀/高级暂停卡）：比赛进行中按方使用，确认后记录并扣库存
const anytimeRows = computed(() => {
  if (!matchTreasury.value || match.value?.status !== STATUS.IN_PROGRESS) return []
  return ['a', 'b']
    .map(side => ({
      side,
      cards: ANYTIME_CARDS
        .map(cardId => ({
          cardId,
          ...TREASURY_CARDS[cardId],
          remaining: matchTreasury.value.sides[side].inventory[cardId] || 0
        }))
        .filter(card => card.remaining > 0)
    }))
    .filter(row => row.cards.length > 0)
})
const cardUsing = ref(false)
async function useAnytimeCard(side, card) {
  const ok = await confirmAction({
    title: `使用${card.name}`,
    message: `${card.effect}\n确认为${sideName(side)}使用 1 次（剩余 ${card.remaining} 次）？`,
    confirmText: '使用'
  })
  if (!ok) return
  cardUsing.value = true
  try {
    await seasonsStore.recordAction(season.value.id, 's6_card_use', {
      matchId: matchId.value,
      side,
      cardId: card.cardId
    })
    if (card.cardId === 'blade') bladeUsedSide.value = side
    toast.show(`${card.name}已记录`, 'success')
  } catch (e) { toast.show(e.message, 'error') }
  cardUsing.value = false
}

// 存储器：该局结束后录入启用方额外球得分（胜 0-5 / 负 0-3）
const storagePrompts = computed(() => {
  if (!matchTreasury.value) return []
  const prompts = []
  for (const side of ['a', 'b']) {
    for (const entry of matchTreasury.value.sides[side].activations) {
      if (entry.timing !== 'pre_game' || entry.cardId !== 'storage' || entry.consumed) continue
      const game = games.value.find(g => g.gameNo === entry.gameNo)
      if (game?.status !== STATUS.COMPLETED) continue
      const won = game.winner === side
      prompts.push({ side, gameNo: entry.gameNo, won, max: won ? 5 : 3 })
    }
  }
  return prompts
})
const storagePoints = ref({})
const storageSubmitting = ref(false)
function storageKey(prompt) {
  return `${prompt.side}-${prompt.gameNo}`
}
function storageOptions(max) {
  return Array.from({ length: max + 1 }, (_, i) => ({ key: String(i), label: String(i) }))
}
async function submitStorage(prompt) {
  const points = Number(storagePoints.value[storageKey(prompt)] ?? 0)
  if (!Number.isInteger(points) || points < 0 || points > prompt.max) {
    toast.show(`请输入 0-${prompt.max} 的整数`, 'warning')
    return
  }
  storageSubmitting.value = true
  try {
    await seasonsStore.recordAction(season.value.id, 's6_storage_record', {
      matchId: matchId.value,
      gameNo: prompt.gameNo,
      side: prompt.side,
      points
    })
    toast.show('存储器得分已记录', 'success')
  } catch (e) { toast.show(e.message, 'error') }
  storageSubmitting.value = false
}

// 时空裂隙：本场存在未消耗的 rift 暗选且第七局未完成时，代替普通撤回
const riftAvailable = computed(() => {
  if (!matchTreasury.value || isMatchOver.value) return false
  if (completedGames.value.some(g => g.gameNo >= bestOf.value)) return false
  if (!completedGames.value.length) return false
  return ['a', 'b'].some(side =>
    matchTreasury.value.sides[side].activations.some(entry =>
      entry.timing === 'pre_game' && entry.cardId === 'rift' && !entry.consumed))
})
const riftSubmitting = ref(false)
async function handleRift(gamesToRevert) {
  const ok = await confirmAction({
    title: '时空裂隙',
    message: `确认回溯最近 ${gamesToRevert} 局？\n时空裂隙将被消耗，被回溯的局可重新记分。`,
    confirmText: '回溯'
  })
  if (!ok) return
  riftSubmitting.value = true
  try {
    await seasonsStore.recordAction(season.value.id, 's6_rift', { matchId: matchId.value, games: gamesToRevert })
    await matchesStore.init({ force: true })
    toast.show(`已回溯 ${gamesToRevert} 局`, 'success')
  } catch (e) { toast.show(e.message, 'error') }
  riftSubmitting.value = false
}

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
    // S6 爆破局：11 分制无加分（封顶 12）
    noDeuce: !!gameConfig.value.activeEffects?.blast,
    winnerOverride: winner
  }
}

// 比分录入提示（编辑弹窗占位文案）
const scoreRuleHint = computed(() =>
  gameConfig.value.activeEffects?.blast ? '爆破局先到 11 分结束（封顶 12，每球 2 分）' : '需符合21分制规则'
)

watch(currentGame, (g) => {
  bladeUsedSide.value = null
  if (g) {
    scoreA.value = g.scoreA || 0
    scoreB.value = g.scoreB || 0
    selectedWinner.value = null
    pierceTeam.value = ''
  }
}, { immediate: true })

// 实时验证当前局比分
watch([scoreA, scoreB, selectedWinner], ([a, b]) => {
  bladeUsedSide.value = null
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
  // S6 下篇：第 1 局暗选须在比赛开始前提交，改为双方亮出后手动开始
  if (isS6Combo.value) return true
  try { await matchesStore.startMatch(matchId.value); return true }
  catch(e) { toast.show('开始失败', 'error'); return false }
}

const saving = ref(false)
const showEndConfirm = ref(false)

// 输入框边框动态类
const scoreInputBorderClass = computed(() => {
  if (!hasCurrentGame.value || isMatchOver.value) return 'border-line'
  if (!currentValidation.isValid.value && (scoreA.value > 0 || scoreB.value > 0)) {
    return '!border-danger'
  }
  if (currentValidation.validation.value.canEnd) {
    return '!border-success'
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

      <!-- S6 下篇：局前暗选（双方提交后同时亮出；亮出前只展示"已暗选"） -->
      <Card v-if="secretState" padding="sm">
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <Gem :size="14" class="text-fg-secondary shrink-0" />
            <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">G{{ secretState.gameNo }} 局前暗选</h3>
            <Badge v-if="secretState.revealed" variant="accent" size="sm">已亮出</Badge>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div v-for="side in ['a', 'b']" :key="side" class="flex flex-col items-center gap-1.5 min-w-0">
              <span class="text-xs text-fg-muted truncate max-w-full">{{ sideName(side) }}</span>
              <span
                v-if="secretState.revealed"
                class="text-sm font-semibold text-fg"
              >{{ (side === 'a' ? secretState.aCard : secretState.bCard) ? TREASURY_CARDS[side === 'a' ? secretState.aCard : secretState.bCard]?.name : '不使用' }}</span>
              <Badge v-else-if="side === 'a' ? secretState.aSubmitted : secretState.bSubmitted" variant="muted" size="sm">已暗选</Badge>
              <Button v-else variant="secondary" size="sm" @click="openSecretSheet(side)">录入暗选</Button>
            </div>
          </div>
        </div>
      </Card>

      <!-- Validation hint -->
      <p v-if="hasCurrentGame && !isMatchOver && currentValidation.errorMessage" class="text-xs text-center text-danger -mt-2 mb-1 min-h-[1.25rem] leading-tight">
        {{ currentValidation.errorMessage }}
      </p>

      <!-- S6 王形态规则提示（中性色，仅提示，局内人工记分） -->
      <div v-if="kingFormHint && !isMatchOver" class="flex items-center gap-2 p-3 rounded-lg bg-surface-hover border border-line-light">
        <Crown :size="14" class="text-fg-secondary shrink-0" />
        <p class="text-xs text-fg-secondary leading-relaxed">{{ kingFormHint }}</p>
      </div>

      <!-- S6 下篇：本局已亮出的卡片效果提示（中性色，仅提示，局内人工记分） -->
      <div
        v-for="hint in effectHints" :key="hint.id"
        class="flex items-center gap-2 p-3 rounded-lg bg-surface-hover border border-line-light"
      >
        <Gem :size="14" class="text-fg-secondary shrink-0" />
        <p class="text-xs text-fg-secondary leading-relaxed">{{ hint.text }}</p>
      </div>

      <!-- S6 下篇：随时卡（暂停卡/名刀/高级暂停卡）使用入口 -->
      <Card v-if="anytimeRows.length" padding="sm">
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <Zap :size="14" class="text-fg-secondary shrink-0" />
            <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">随时卡</h3>
          </div>
          <div v-for="row in anytimeRows" :key="row.side" class="flex flex-col gap-1.5">
            <span class="text-xs text-fg-muted truncate">{{ sideName(row.side) }}</span>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="card in row.cards" :key="card.cardId"
                class="px-3 min-h-9 rounded-lg border border-line-light bg-canvas text-sm text-fg-secondary font-medium cursor-pointer transition-all duration-fast active:scale-95 disabled:opacity-50"
                :disabled="cardUsing"
                @click="useAnytimeCard(row.side, card)"
              >{{ card.name }} ×{{ card.remaining }}</button>
            </div>
          </div>
        </div>
      </Card>

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
        :hide-revert="riftAvailable"
        @edit-game="openEdit"
        @revert-last="handleRevertLast"
      />

      <!-- S6 下篇：存储器额外球得分录入（该局结束后，胜 0-5 / 负 0-3） -->
      <Card v-for="prompt in storagePrompts" :key="storageKey(prompt)" padding="sm">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <Gem :size="14" class="text-fg-secondary shrink-0" />
            <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">存储器 · G{{ prompt.gameNo }}</h3>
          </div>
          <p class="text-xs text-fg-muted">
            {{ sideName(prompt.side) }}本局{{ prompt.won ? '获胜' : '失败' }}，录入额外球得分（0-{{ prompt.max }}），自动累积到下一局开局
          </p>
          <SegmentedControl
            :model-value="storagePoints[storageKey(prompt)] ?? '0'"
            :options="storageOptions(prompt.max)"
            size="sm"
            @update:model-value="v => storagePoints[storageKey(prompt)] = v"
          />
          <Button variant="primary" size="sm" :loading="storageSubmitting" @click="submitStorage(prompt)">记录得分</Button>
        </div>
      </Card>

      <!-- S6 下篇：时空裂隙（代替普通撤回，回溯最近 1-2 局） -->
      <Card v-if="riftAvailable" padding="sm">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <History :size="14" class="text-fg-secondary shrink-0" />
            <h3 class="text-xs font-semibold text-fg-secondary uppercase tracking-wide">时空裂隙</h3>
          </div>
          <p class="text-xs text-fg-muted">回溯最近 1-2 局重新记分，启用后消耗；第七局结束后不可用。</p>
          <div class="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="md" :loading="riftSubmitting" @click="handleRift(1)">回溯 1 局</Button>
            <Button variant="secondary" size="md" :disabled="completedGames.length < 2 || riftSubmitting" @click="handleRift(2)">回溯 2 局</Button>
          </div>
        </div>
      </Card>

      <!-- Actions -->
      <div class="mt-auto pt-4 flex flex-col gap-2" v-if="!isMatchOver">
        <template v-if="isS6Combo && match?.status === STATUS.PENDING">
          <Button variant="primary" size="lg" block :disabled="!canStartS6Match" :loading="startingMatch" @click="handleStartMatch">
            {{ canStartS6Match ? '开始比赛' : '请先完成 G1 双方暗选' }}
          </Button>
          <Button variant="ghost" size="md" block @click="goBack">返回</Button>
        </template>
        <template v-else-if="hasCurrentGame">
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

    <!-- S6 下篇：局前暗选录入（选择卡片或"不使用"，提交即扣库存） -->
    <Sheet
      :show="showSecretSheet"
      :title="`G${secretState?.gameNo ?? ''} 暗选 · ${sideName(secretSide)}`"
      @close="showSecretSheet = false"
    >
      <div class="flex flex-col gap-2">
        <button
          v-for="opt in secretOptions" :key="opt.cardId"
          class="p-3 rounded-lg border border-line-light bg-canvas text-left cursor-pointer transition-all duration-fast active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          :disabled="opt.remaining <= 0 || secretSubmitting"
          @click="submitSecret(opt.cardId)"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-fg">{{ opt.name }}</span>
            <span class="text-xs text-fg-muted shrink-0">剩余 {{ opt.remaining }}</span>
          </div>
          <p class="text-xs text-fg-muted mt-1">{{ opt.effect }}</p>
        </button>
        <button
          class="p-3 rounded-lg border border-line-light bg-canvas text-left cursor-pointer transition-all duration-fast active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          :disabled="secretSubmitting"
          @click="submitSecret(null)"
        >
          <span class="text-sm font-semibold text-fg">不使用</span>
          <p class="text-xs text-fg-muted mt-1">本局不启用任何局前卡片</p>
        </button>
      </div>
    </Sheet>

    <!-- Edit game -->
    <Teleport to="body">
      <div v-if="showEdit" class="overlay" @click.self="showEdit=false">
        <div class="sheet">
          <h3 class="text-lg font-semibold mb-2 text-fg">修改 G{{ editingGame?.gameNo }} 比分</h3>
          <div class="flex items-center gap-3 mb-3">
            <div class="flex-1 text-center">
              <label class="block text-sm font-medium text-fg mb-1">{{ teamAPlayers.join('/') }}</label>
              <input type="number" class="fld"
                :class="{'!border-danger': !editValidation.isValid.value, '!border-success': editValidation.validation.value.canEnd}"
                v-model.number="editForm.scoreA" />
            </div>
            <span class="text-sm text-fg-muted font-bold pt-6">VS</span>
            <div class="flex-1 text-center">
              <label class="block text-sm font-medium text-fg mb-1">{{ teamBPlayers.join('/') }}</label>
              <input type="number" class="fld"
                :class="{'!border-danger': !editValidation.isValid.value, '!border-success': editValidation.validation.value.canEnd}"
                v-model.number="editForm.scoreB" />
            </div>
          </div>
          <p class="text-xs mb-4 min-h-[1.25rem] leading-tight" :class="editValidation.errorMessage ? 'text-danger' : 'text-fg-muted'">
            {{ editValidation.errorMessage || scoreRuleHint }}
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
