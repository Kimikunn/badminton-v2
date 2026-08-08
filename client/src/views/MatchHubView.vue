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
import { KING_FORMS, TREASURY_CARDS, getComboLabelsByRound, getSoulSeedMap, getSoulTierLabel, getTierCap, getAllowedPicks, getPlayerPickCount, isComboBondComplete } from '@/rules/s6'
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
import { BarChart3, Dumbbell, Trash2, RefreshCw, Dice5, Crown } from 'lucide-vue-next'
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
// 创建下一轮前的强制流程（S6：上篇王选 / 下篇灵魂契合；其余规则回退到 lifecycle 静态声明）
const beforeRoundRequirement = computed(() =>
  typeof currentRule.value?.getBeforeRoundRequirement === 'function'
    ? currentRule.value.getBeforeRoundRequirement(nextRoundNo.value)
    : beforeRoundLifecycle.value
)
const isFixedComboRound = computed(() =>
  (currentSeason.value?.ruleId === 's4' || currentSeason.value?.ruleId === 's6') && nextRoundNo.value >= 5
)
const supportsRandomPairings = computed(() => !isFixedComboRound.value)
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

// === S6 王选（上篇 1-4 轮，创建轮次前强制） ===
const KING_DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const showKingSelect = ref(false)
const kingRolls = ref({})
const kingForm = ref('')
const kingSubmitting = ref(false)

const requiresKingSelection = computed(() =>
  beforeRoundRequirement.value?.required &&
  beforeRoundRequirement.value?.type === 'king_selection'
)
const kingRollEntries = computed(() =>
  (currentSeason.value?.participants || []).map(pid => ({ playerId: pid, dice: kingRolls.value[pid] || null }))
)
const allKingRolled = computed(() =>
  kingRollEntries.value.length === 4 && kingRollEntries.value.every(e => e.dice)
)
const tiedKingIds = computed(() => {
  if (!allKingRolled.value) return []
  const max = Math.max(...kingRollEntries.value.map(e => e.dice))
  const winners = kingRollEntries.value.filter(e => e.dice === max)
  return winners.length > 1 ? winners.map(e => e.playerId) : []
})
const electedKingId = computed(() => {
  if (!allKingRolled.value || tiedKingIds.value.length) return null
  const max = Math.max(...kingRollEntries.value.map(e => e.dice))
  return kingRollEntries.value.find(e => e.dice === max)?.playerId || null
})

function rollKingDice(playerId) {
  if (kingRolls.value[playerId]) return
  kingRolls.value = { ...kingRolls.value, [playerId]: Math.floor(Math.random() * 6) + 1 }
}

function rerollTiedKings() {
  const next = { ...kingRolls.value }
  tiedKingIds.value.forEach(pid => { delete next[pid] })
  kingRolls.value = next
}

async function submitKingSelection() {
  if (!electedKingId.value) { toast.show('请先完成王选掷骰', 'warning'); return }
  if (!kingForm.value) { toast.show('请为王选择形态', 'warning'); return }
  kingSubmitting.value = true
  try {
    const roundNo = nextRoundNo.value
    const rolls = kingRollEntries.value.map(e => ({ playerId: e.playerId, dice: e.dice }))
    const rollRes = await seasonsStore.recordAction(currentSeason.value.id, 's6_king_roll', { roundNo, rolls })
    if (!rollRes?.success) throw new Error(rollRes?.error || '王选掷骰提交失败')
    const formRes = await seasonsStore.recordAction(currentSeason.value.id, 's6_king_form', { roundNo, form: kingForm.value })
    if (!formRes?.success) throw new Error(formRes?.error || '王形态提交失败')
    toast.show(`第 ${roundNo} 轮王选完成`, 'success')
    showKingSelect.value = false
    openCreateRoundSheet()
  } catch (e) {
    toast.show(e.message || '王选提交失败', 'error')
  } finally {
    kingSubmitting.value = false
  }
}

// === S6 灵魂契合（下篇 5-7 轮，创建轮次前强制） ===
const showSoulBond = ref(false)
const soulComboLabel = ref('')
const soulStaging = ref({}) // { [playerId]: { rollChoice, dice, rerollSource } } 本地投掷暂存（未提交）
const soulSubmitting = ref(false)
const reforgeState = ref(null) // { playerId, newDice } 重铸二选一进项

const requiresSoulBond = computed(() =>
  beforeRoundRequirement.value?.required &&
  beforeRoundRequirement.value?.type === 'soul_bond'
)
const soulComboLabels = computed(() => getComboLabelsByRound(nextRoundNo.value))
const soulSeeds = computed(() => getSoulSeedMap(currentSeason.value) || {})
const soulBondData = computed(() =>
  currentSeason.value?.comebackData?.s6?.soulBond?.[String(nextRoundNo.value)] || {}
)
const soulRoundComplete = computed(() =>
  soulComboLabels.value.length > 0 &&
  soulComboLabels.value.every(label => isComboBondComplete(soulBondData.value[label]))
)

function getSoulCombo(label) {
  return soulBondData.value[label] || null
}
const soulActiveCombo = computed(() => getSoulCombo(soulComboLabel.value))
const soulActivePlayerIds = computed(() => getComboPlayerIds(soulComboLabel.value))
const soulActiveRolled = computed(() => (soulActiveCombo.value?.rolls || []).length === 2)
function getComboPlayerIds(label) {
  return String(label).split('').map(key => soulSeeds.value[key]).filter(Boolean)
}
function getSoulRoll(combo, playerId) {
  return combo?.rolls?.find(roll => roll.playerId === playerId) || null
}

// 凯旋重投名额：上篇（1-4 轮）标准排名前二各 1 次
const triumphTop2 = computed(() => {
  if (currentSeason.value?.ruleId !== 's6') return []
  const topRounds = rounds.value.filter(r => r.roundNo >= 1 && r.roundNo <= 4 && r.status === STATUS.COMPLETED)
  if (topRounds.length < 4) return []
  const topRoundIds = new Set(topRounds.map(r => r.id))
  const topMatches = seasonMatches.value.filter(m => topRoundIds.has(m.roundId))
  const rule = getRule('s6')
  const rankings = rule.calcRankings(
    currentSeason.value.participants || [],
    topMatches,
    mid => matchesStore.getGamesByMatch(mid),
    id => playersStore.getPlayerById(id),
    { season: currentSeason.value, rounds: topRounds }
  )
  return rankings.slice(0, 2).map(row => row.id)
})

// S5 贯穿碎片：最近一个 S5 赛季 pierceCounts[playerId] - 3 > 0（与服务端口径一致）
const s5ShardCounts = computed(() => {
  const s5 = [...seasonsStore.seasons]
    .filter(s => s.ruleId === 's5')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]
  const counts = s5?.comebackData?.s5?.pierceCounts || {}
  const shards = {}
  Object.entries(counts).forEach(([playerId, count]) => {
    const remaining = Number(count) - 3
    if (remaining > 0) shards[playerId] = remaining
  })
  return shards
})

// 已消耗的重投次数（跨所有轮次/组合累计）
function getUsedRerollCount(playerId, source) {
  const soulBond = currentSeason.value?.comebackData?.s6?.soulBond || {}
  let used = 0
  Object.values(soulBond).forEach(roundBond => {
    Object.values(roundBond || {}).forEach(combo => {
      used += (combo.rerollsUsed || []).filter(entry => entry.playerId === playerId && entry.source === source).length
    })
  })
  return used
}

// 选手可用的重投令牌（凯旋 / S5 贯穿碎片）
function getRerollTokens(playerId) {
  const tokens = []
  if (triumphTop2.value.includes(playerId)) {
    tokens.push({ source: 'triumph', name: '凯旋', total: 1 })
  }
  const shards = s5ShardCounts.value[playerId] || 0
  if (shards > 0) {
    tokens.push({ source: 's5_shard', name: '贯穿碎片', total: shards })
  }
  return tokens
    .map(token => ({ ...token, remaining: token.total - getUsedRerollCount(playerId, token.source) }))
    .filter(token => token.remaining > 0)
}

function rollLocalDice(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
}

// 选择投 1/2 次后立即在本地掷骰（提交前可重掷，不消耗任何服务端状态）
function startSoulRoll(playerId, rollChoice) {
  const staging = soulStaging.value[playerId]
  soulStaging.value = {
    ...soulStaging.value,
    [playerId]: {
      rollChoice,
      dice: rollLocalDice(rollChoice),
      rerollSource: staging?.rerollSource || null
    }
  }
}

function shuffleSoulStaging(playerId) {
  const staging = soulStaging.value[playerId]
  if (!staging) return
  soulStaging.value = {
    ...soulStaging.value,
    [playerId]: { ...staging, dice: rollLocalDice(staging.rollChoice) }
  }
}

function clearSoulStaging(playerId) {
  const next = { ...soulStaging.value }
  delete next[playerId]
  soulStaging.value = next
}

async function submitSoulRoll(playerId) {
  const staging = soulStaging.value[playerId]
  if (!staging?.dice?.length) return
  soulSubmitting.value = true
  try {
    const res = await seasonsStore.recordAction(currentSeason.value.id, 's6_soul_roll', {
      roundNo: nextRoundNo.value,
      comboLabel: soulComboLabel.value,
      playerId,
      rollChoice: staging.rollChoice,
      dice: staging.dice,
      rerollSource: staging.rerollSource || undefined
    })
    if (!res?.success) throw new Error(res?.error || '灵魂投掷提交失败')
    clearSoulStaging(playerId)
    toast.show(staging.rerollSource ? '重投完成' : '灵魂投掷完成', 'success')
  } catch (e) {
    toast.show(e.message || '灵魂投掷提交失败', 'error')
  } finally {
    soulSubmitting.value = false
  }
}

async function startSoulReroll(playerId, token) {
  const ok = await confirmAction({
    title: '重投确认',
    message: `${playersStore.getPlayerName(playerId)} 将消耗 1 次「${token.name}」重投机会（剩余 ${token.remaining} 次），重投后原点数作废。`,
    confirmText: '重投'
  })
  if (!ok) return
  // 进入暂存态：重新选择投 1/2 次后提交（带 rerollSource）
  soulStaging.value = {
    ...soulStaging.value,
    [playerId]: { rollChoice: null, dice: [], rerollSource: token.source }
  }
}

async function submitSoulPick(playerId, cardId) {
  soulSubmitting.value = true
  try {
    const res = await seasonsStore.recordAction(currentSeason.value.id, 's6_soul_pick', {
      roundNo: nextRoundNo.value,
      comboLabel: soulComboLabel.value,
      playerId,
      cardId
    })
    if (!res?.success) throw new Error(res?.error || '奖励选择提交失败')
    toast.show(`已选择「${TREASURY_CARDS[cardId]?.name || cardId}」`, 'success')
  } catch (e) {
    toast.show(e.message || '奖励选择提交失败', 'error')
  } finally {
    soulSubmitting.value = false
  }
}

// 重铸：本地重投一次，选手在 原点数/新点数 中二选一后提交
function startReforge(playerId) {
  reforgeState.value = { playerId, newDice: rollLocalDice(1)[0] }
}

async function submitReforge(keptDice) {
  const state = reforgeState.value
  if (!state) return
  soulSubmitting.value = true
  try {
    const res = await seasonsStore.recordAction(currentSeason.value.id, 's6_reforge', {
      roundNo: nextRoundNo.value,
      comboLabel: soulComboLabel.value,
      playerId: state.playerId,
      dice: keptDice
    })
    if (!res?.success) throw new Error(res?.error || '重铸提交失败')
    reforgeState.value = null
    toast.show('重铸完成', 'success')
  } catch (e) {
    toast.show(e.message || '重铸提交失败', 'error')
  } finally {
    soulSubmitting.value = false
  }
}

// 可选奖励卡片（重铸走专门流程、天选自动触发，均不在选择网格中）
const PICKABLE_CARD_IDS = Object.values(TREASURY_CARDS)
  .filter(card => card.tier !== 'chosen' && card.id !== 'reforge')
  .map(card => card.id)

// 卡片对某选手是否可点：返回 null 表示可选，否则为禁用原因
function getCardDisabledReason(combo, playerId, card) {
  if (card.tier > getTierCap(combo?.unlockTier)) {
    const tier = { 2: '第二阶（7-9）', 3: '第三阶（10-12）' }[card.tier] || ''
    return `未解锁${tier}`
  }
  if ((combo?.picks || []).some(pick => pick.cardId === card.id)) return '已被选择'
  if (getPlayerPickCount(combo, playerId) >= getAllowedPicks(combo, playerId)) return '次数已用完'
  return null
}

function openSoulBond() {
  soulStaging.value = {}
  reforgeState.value = null
  soulComboLabel.value = soulComboLabels.value[0] || ''
  showSoulBond.value = true
}

function proceedCreateRound() {
  showSoulBond.value = false
  openCreateRoundSheet()
}

function generatePreview() {
  const parts = currentSeason.value?.participants || []
  if (parts.length < 4) return []

  if (isFixedComboRound.value) {
    // S4：按选手 ID 排序；S6：按灵魂契合种子口径（s6.seeds 或服务端同款 ID 排序兜底）
    const ordered = currentSeason.value?.ruleId === 's6'
      ? Object.values(getSoulSeedMap(currentSeason.value) || {})
      : [...parts].sort()
    if (ordered.length < 4) return []
    const combos = {
      5: { teamA: [ordered[0], ordered[1]], teamB: [ordered[2], ordered[3]] },
      6: { teamA: [ordered[0], ordered[2]], teamB: [ordered[1], ordered[3]] },
      7: { teamA: [ordered[0], ordered[3]], teamB: [ordered[1], ordered[2]] }
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
  if (requiresKingSelection.value) {
    kingRolls.value = {}
    kingForm.value = ''
    showKingSelect.value = true
    return
  }
  if (requiresSoulBond.value) {
    openSoulBond()
    return
  }
  openCreateRoundSheet()
}

function openCreateRoundSheet() {
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

      <!-- S6 王选 sheet（上篇 1-4 轮创建前强制） -->
      <Sheet :show="showKingSelect" :title="`第 ${nextRoundNo} 轮 · 王选`" @close="showKingSelect=false">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-fg-secondary">4 名参赛者依次投骰，最高点数唯一者成为本轮的王，再由王选择形态。</p>
          <div class="flex flex-col gap-2">
            <div
              v-for="entry in kingRollEntries" :key="entry.playerId"
              class="flex items-center gap-3 p-3 rounded-lg border"
              :class="electedKingId === entry.playerId ? 'border-accent bg-accent-subtle' : 'border-line bg-canvas'"
            >
              <Avatar :name="playersStore.getPlayerName(entry.playerId)" size="sm" />
              <span class="flex-1 min-w-0 text-sm font-medium text-fg truncate">{{ playersStore.getPlayerName(entry.playerId) }}</span>
              <Crown v-if="electedKingId === entry.playerId" :size="16" class="text-accent shrink-0" />
              <span v-if="entry.dice" class="text-2xl leading-none text-fg">{{ KING_DICE_FACES[entry.dice - 1] }}</span>
              <button
                v-else
                class="px-3 py-1.5 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95"
                @click="rollKingDice(entry.playerId)"
              >投骰</button>
            </div>
          </div>
          <div v-if="tiedKingIds.length" class="flex items-center justify-between gap-3 p-3 rounded-lg bg-warning-subtle border border-warning/30">
            <p class="text-xs text-warning">最高点数并列，请重投并列者</p>
            <button
              class="px-3 py-1.5 rounded-lg border border-warning text-warning text-xs font-medium cursor-pointer transition-all duration-fast active:scale-95 shrink-0"
              @click="rerollTiedKings"
            >重投并列者</button>
          </div>
          <template v-if="electedKingId">
            <div class="flex items-center gap-2 p-3 rounded-lg bg-accent-subtle border border-accent/30">
              <Crown :size="16" class="text-accent shrink-0" />
              <span class="text-sm font-semibold text-fg">本轮的王：{{ playersStore.getPlayerName(electedKingId) }}</span>
            </div>
            <div class="flex flex-col gap-2">
              <h4 class="text-xs font-semibold uppercase tracking-wider text-fg-secondary">王选择形态</h4>
              <button
                v-for="form in Object.values(KING_FORMS)" :key="form.id"
                class="flex flex-col gap-1 p-3 rounded-lg border text-left cursor-pointer transition-all duration-fast active:scale-95"
                :class="kingForm === form.id ? 'border-accent bg-accent-subtle' : 'border-line bg-canvas'"
                @click="kingForm = form.id"
              >
                <span class="text-sm font-semibold" :class="kingForm === form.id ? 'text-accent' : 'text-fg'">{{ form.name }}</span>
                <span class="text-xs text-fg-muted">{{ form.effect }}</span>
              </button>
            </div>
          </template>
          <div class="flex gap-3 [&>*]:flex-1">
            <Button variant="secondary" size="md" @click="showKingSelect=false">取消</Button>
            <Button variant="primary" size="md" :loading="kingSubmitting" :disabled="!electedKingId || !kingForm" @click="submitKingSelection">确认王选</Button>
          </div>
        </div>
      </Sheet>

      <!-- S6 灵魂契合 sheet（下篇 5-7 轮创建前强制） -->
      <Sheet :show="showSoulBond" :title="`第 ${nextRoundNo} 轮 · 灵魂契合`" @close="showSoulBond=false">
        <div class="flex flex-col gap-4">
          <p class="text-sm text-fg-secondary">组合双方各选投 1 次或 2 次（2 次以第二次为准），点数求和（同点 +1）解锁王之宝库阶层并选择奖励。两个组合均完成后才能创建本轮。</p>

          <!-- 组合切换 -->
          <SegmentedControl
            v-model="soulComboLabel"
            :options="soulComboLabels.map(l => ({ key: l, label: `${l}组合${isComboBondComplete(getSoulCombo(l)) ? ' ✓' : ''}` }))"
            size="sm"
          />

          <div class="flex flex-col gap-3">
            <!-- 双方掷骰 -->
            <div
              v-for="pid in soulActivePlayerIds" :key="pid"
              class="flex flex-col gap-2 p-3 rounded-lg border border-line bg-canvas"
            >
              <div class="flex items-center gap-2">
                <Avatar :name="playersStore.getPlayerName(pid)" size="sm" />
                <span class="flex-1 min-w-0 text-sm font-medium text-fg truncate">{{ playersStore.getPlayerName(pid) }}</span>
                <Badge v-if="getSoulRoll(soulActiveCombo, pid)" variant="success" size="sm">已投掷</Badge>
                <Badge v-else variant="muted" size="sm">待投掷</Badge>
              </div>

              <!-- 已提交的点数 -->
              <div v-if="getSoulRoll(soulActiveCombo, pid)" class="flex items-center gap-2 flex-wrap">
                <span class="text-2xl leading-none text-fg">{{ getSoulRoll(soulActiveCombo, pid).dice.map(d => KING_DICE_FACES[d - 1]).join(' ') }}</span>
                <span class="text-xs text-fg-muted">判定 <span class="text-sm font-bold text-fg">{{ getSoulRoll(soulActiveCombo, pid).used }}</span></span>
                <Badge v-if="getSoulRoll(soulActiveCombo, pid).rollChoice === 2" variant="muted" size="sm">第二次为准</Badge>
                <Badge v-if="getSoulRoll(soulActiveCombo, pid).reforged" variant="accent" size="sm">已重铸</Badge>
              </div>

              <!-- 本地暂存：选次数 → 掷骰 → 提交 -->
              <template v-else-if="soulStaging[pid]">
                <div v-if="soulStaging[pid].dice.length" class="flex items-center gap-3 flex-wrap">
                  <span
                    v-for="(d, i) in soulStaging[pid].dice" :key="i"
                    class="text-2xl leading-none"
                    :class="soulStaging[pid].rollChoice === 2 && i === 0 ? 'text-fg-muted' : 'text-fg'"
                  >{{ KING_DICE_FACES[d - 1] }}</span>
                  <Badge v-if="soulStaging[pid].rollChoice === 2" variant="muted" size="sm">第二次为准</Badge>
                  <Badge v-if="soulStaging[pid].rerollSource" variant="warning" size="sm">重投</Badge>
                </div>
                <div class="flex gap-2 flex-wrap">
                  <template v-if="!soulStaging[pid].dice.length">
                    <button class="flex-1 px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95" @click="startSoulRoll(pid, 1)">投 1 次</button>
                    <button class="flex-1 px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95" @click="startSoulRoll(pid, 2)">投 2 次</button>
                    <button class="px-3 py-2 rounded-lg border border-line text-fg-muted text-sm cursor-pointer transition-all duration-fast active:scale-95" @click="clearSoulStaging(pid)">取消</button>
                  </template>
                  <template v-else>
                    <button class="px-3 py-2 rounded-lg border border-line text-fg-secondary text-sm cursor-pointer transition-all duration-fast active:scale-95" :disabled="soulSubmitting" @click="shuffleSoulStaging(pid)">重掷</button>
                    <button class="px-3 py-2 rounded-lg border border-line text-fg-muted text-sm cursor-pointer transition-all duration-fast active:scale-95" :disabled="soulSubmitting" @click="clearSoulStaging(pid)">撤销</button>
                    <Button variant="primary" size="sm" class="flex-1" :loading="soulSubmitting" @click="submitSoulRoll(pid)">提交投掷</Button>
                  </template>
                </div>
              </template>

              <!-- 未开始：选择投 1 / 2 次 -->
              <div v-else class="flex gap-2">
                <button class="flex-1 px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95" @click="startSoulRoll(pid, 1)">投 1 次</button>
                <button class="flex-1 px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95" @click="startSoulRoll(pid, 2)">投 2 次</button>
              </div>
            </div>

            <!-- 判定结果 -->
            <div v-if="soulActiveRolled" class="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-accent-subtle border border-accent/30">
              <span class="text-sm font-semibold text-fg">总点数 <span class="text-lg font-bold text-accent">{{ soulActiveCombo.total }}</span></span>
              <Badge v-if="soulActiveCombo.rolls[0].used === soulActiveCombo.rolls[1].used" variant="accent" size="sm">同点 +1</Badge>
              <Badge variant="accent" size="sm">{{ getSoulTierLabel(soulActiveCombo.unlockTier) }}</Badge>
              <span v-if="!soulActiveCombo.unlockTier" class="text-xs text-fg-muted">未解锁宝库奖励，无需选奖</span>
            </div>

            <!-- 天选 -->
            <div v-if="soulActiveRolled && soulActiveCombo.unlockTier === 'chosen'" class="p-3 rounded-lg bg-warning-subtle border border-warning/30">
              <p class="text-sm font-semibold text-warning">天选达成！该组合本轮 7 局每局 2:0 开局（自动触发，不占选择次数）</p>
            </div>

            <!-- 重投入口（选奖前可用） -->
            <div v-if="soulActiveRolled && !(soulActiveCombo.picks || []).length" class="flex flex-col gap-2">
              <template v-for="pid in soulActivePlayerIds" :key="'reroll-' + pid">
                <div v-if="getRerollTokens(pid).length" class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs text-fg-muted">{{ playersStore.getPlayerName(pid) }} 可重投：</span>
                  <button
                    v-for="token in getRerollTokens(pid)" :key="token.source"
                    class="px-3 py-1.5 rounded-lg border border-warning text-warning text-xs font-medium cursor-pointer transition-all duration-fast active:scale-95"
                    :disabled="soulSubmitting || !!soulStaging[pid]"
                    @click="startSoulReroll(pid, token)"
                  >{{ token.name }}重投（剩 {{ token.remaining }} 次）</button>
                </div>
              </template>
            </div>

            <!-- 奖励选择 -->
            <template v-if="soulActiveRolled && soulActiveCombo.unlockTier">
              <div v-for="pid in soulActivePlayerIds" :key="'pick-' + pid" class="flex flex-col gap-2 p-3 rounded-lg border border-line bg-canvas">
                <div class="flex items-center gap-2">
                  <span class="flex-1 min-w-0 text-sm font-medium text-fg truncate">{{ playersStore.getPlayerName(pid) }} 选奖</span>
                  <span class="text-xs text-fg-muted">{{ getPlayerPickCount(soulActiveCombo, pid) }}/{{ getAllowedPicks(soulActiveCombo, pid) }} 次</span>
                </div>

                <!-- 已选 -->
                <div v-if="getPlayerPickCount(soulActiveCombo, pid)" class="flex flex-wrap gap-2">
                  <Badge v-for="pick in (soulActiveCombo.picks || []).filter(p => p.playerId === pid)" :key="pick.cardId + pick.playerId" variant="success" size="sm">
                    已选「{{ TREASURY_CARDS[pick.cardId]?.name || pick.cardId }}」
                  </Badge>
                </div>

                <!-- 卡片网格 -->
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="cardId in PICKABLE_CARD_IDS" :key="cardId"
                    class="flex flex-col items-start gap-0.5 p-2.5 rounded-lg border text-left cursor-pointer transition-all duration-fast active:scale-95 disabled:cursor-not-allowed"
                    :class="getCardDisabledReason(soulActiveCombo, pid, TREASURY_CARDS[cardId]) ? 'border-line-light bg-surface opacity-50' : 'border-accent bg-accent-subtle'"
                    :disabled="soulSubmitting || !!getCardDisabledReason(soulActiveCombo, pid, TREASURY_CARDS[cardId])"
                    @click="submitSoulPick(pid, cardId)"
                  >
                    <span class="text-sm font-semibold" :class="getCardDisabledReason(soulActiveCombo, pid, TREASURY_CARDS[cardId]) ? 'text-fg-muted' : 'text-accent'">
                      {{ TREASURY_CARDS[cardId].name }}<template v-if="TREASURY_CARDS[cardId].uses"> ×{{ TREASURY_CARDS[cardId].uses }}</template>
                    </span>
                    <span class="text-2xs text-fg-muted">{{ getCardDisabledReason(soulActiveCombo, pid, TREASURY_CARDS[cardId]) || `${TREASURY_CARDS[cardId].condition} · ${TREASURY_CARDS[cardId].effect}` }}</span>
                  </button>
                </div>

                <!-- 重铸（第二阶解锁，立刻重投二选一，占一次选择） -->
                <template v-if="getTierCap(soulActiveCombo.unlockTier) >= 2 && getPlayerPickCount(soulActiveCombo, pid) < getAllowedPicks(soulActiveCombo, pid)">
                  <div v-if="reforgeState?.playerId === pid" class="flex flex-col gap-2 p-2.5 rounded-lg bg-surface-hover border border-line-light">
                    <p class="text-xs text-fg-secondary">重铸：原点数 <span class="font-bold text-fg">{{ getSoulRoll(soulActiveCombo, pid)?.used }}</span>，新点数 <span class="font-bold text-accent">{{ KING_DICE_FACES[reforgeState.newDice - 1] }} {{ reforgeState.newDice }}</span></p>
                    <div class="flex gap-2">
                      <button class="flex-1 px-3 py-2 rounded-lg border border-line bg-surface text-fg text-sm cursor-pointer transition-all duration-fast active:scale-95" :disabled="soulSubmitting" @click="submitReforge(getSoulRoll(soulActiveCombo, pid)?.used)">保留原点数</button>
                      <button class="flex-1 px-3 py-2 rounded-lg border border-accent bg-accent-subtle text-accent text-sm font-medium cursor-pointer transition-all duration-fast active:scale-95" :disabled="soulSubmitting" @click="submitReforge(reforgeState.newDice)">使用新点数</button>
                      <button class="px-3 py-2 rounded-lg border border-line text-fg-muted text-sm cursor-pointer transition-all duration-fast active:scale-95" :disabled="soulSubmitting" @click="reforgeState = null">取消</button>
                    </div>
                  </div>
                  <button
                    v-else
                    class="px-3 py-2 rounded-lg border border-line bg-surface text-fg-secondary text-sm cursor-pointer transition-all duration-fast active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    :disabled="soulSubmitting || !!reforgeState"
                    @click="startReforge(pid)"
                  >重铸（重投一次骰子二选一，占 1 次选择）</button>
                </template>
              </div>
            </template>
          </div>

          <p v-if="!soulRoundComplete" class="text-xs text-fg-muted text-center">两个组合均完成灵魂判定与奖励选择后才能创建轮次</p>
          <div class="flex gap-3 [&>*]:flex-1">
            <Button variant="secondary" size="md" @click="showSoulBond=false">关闭</Button>
            <Button variant="primary" size="md" :disabled="!soulRoundComplete" @click="proceedCreateRound">创建第 {{ nextRoundNo }} 轮</Button>
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
