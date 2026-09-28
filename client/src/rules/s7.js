/**
 * s7.js — S7-王权之续（2026-09-28 新增赛季类型；显示层规则模块）
 *
 * 语义 = S6 下半赛季（组合赛阶段）独立成季：3 轮固定轮换组合赛，灵魂契合 +
 * 王之宝库 + 组合星尘。**无上篇/王选/王权/凯旋重投/月白黛青绯红**。
 * 以 s7.js 为底本 copy-adapt：组合轮 1-3（S6 为 5-7）、数据键 comebackData.s7、
 * 动作前缀 s7_*；种子缺省=选手 ID 排序（首次灵魂投掷时服务端持久化）。
 * 共享常量（宝库卡目录/阶层/契合规则/星尘规则）与 s6 同源，随本模块再导出。
 */
import { STATUS } from '@/constants'
import standardRule from './standard'
import {
  buildComboRankings, resolveComboTie, sortComboRankings, getCompletedGames
} from './comboStardust'

const COMBO_ROUND_MIN = 1
const COMBO_ROUND_MAX = 3

// 下篇组合固定对阵（与 S4 同一轮换；label 为视角方，opponentLabel 为对手）
const COMBO_CONFIGS = [
  { roundNo: 1, label: 'AB', opponentLabel: 'CD', seedKeys: ['A', 'B'], opponentSeedKeys: ['C', 'D'], perspective: 'a' },
  { roundNo: 2, label: 'AC', opponentLabel: 'BD', seedKeys: ['A', 'C'], opponentSeedKeys: ['B', 'D'], perspective: 'a' },
  { roundNo: 3, label: 'AD', opponentLabel: 'BC', seedKeys: ['A', 'D'], opponentSeedKeys: ['B', 'C'], perspective: 'a' },
  { roundNo: 1, label: 'CD', opponentLabel: 'AB', seedKeys: ['C', 'D'], opponentSeedKeys: ['A', 'B'], perspective: 'b' },
  { roundNo: 2, label: 'BD', opponentLabel: 'AC', seedKeys: ['B', 'D'], opponentSeedKeys: ['A', 'C'], perspective: 'b' },
  { roundNo: 3, label: 'BC', opponentLabel: 'AD', seedKeys: ['B', 'C'], opponentSeedKeys: ['A', 'D'], perspective: 'b' }
]

const COMBO_LABELS_BY_ROUND = {
  1: ['AB', 'CD'],
  2: ['AC', 'BD'],
  3: ['AD', 'BC']
}


// 上篇规则文案（规则 Sheet 展示用，与组件展示文字保持一致）

// 王之宝库卡片目录（客户端唯一展示文案来源，口径与服务端 TREASURY_CARDS 一致；
// uses 为每张卡的库存次数，reforge/chosen 不进库存：重铸立刻生效，天选自动触发）
export const TREASURY_CARDS = {
  pause: { id: 'pause', name: '暂停卡', tier: 1, uses: 3, condition: '随时', effect: '暂停 45 秒' },
  blade: { id: 'blade', name: '名刀', tier: 1, uses: 3, condition: '随时', effect: '启用后下一球对方得分无效' },
  block: { id: 'block', name: '阻碍', tier: 1, uses: 1, condition: '每局开始前', effect: '对方本局获胜无法获得终结分' },
  charge: { id: 'charge', name: '进击', tier: 1, uses: 1, condition: '每局开始前', effect: '本局获胜额外获得一次连胜计数' },
  pause_plus: { id: 'pause_plus', name: '高级暂停卡', tier: 2, uses: 3, condition: '随时', effect: '暂停 45 秒，回来后可选发球方和场地，无法被其他高级暂停卡覆盖' },
  reforge: { id: 'reforge', name: '重铸', tier: 2, uses: 0, condition: '立刻生效', effect: '重投一次骰子并二选一留用，占用一次奖励选择' },
  storage: { id: 'storage', name: '存储器', tier: 2, uses: 2, condition: '每局开始前', effect: '本局获胜额外再打 5 球、失败 3 球，启用方得分累积到下一局开局' },
  rift: { id: 'rift', name: '时空裂隙', tier: 3, uses: 1, condition: '每局开始前', effect: '回溯到 1 局或 2 局前；第七局打完后本轮立刻结束，无法回溯' },
  stardust: { id: 'stardust', name: '星尘卡', tier: 3, uses: 1, condition: '每局开始前', effect: '本局获胜 +2 星尘，净胜分 ≥7 再 +1；失败可阻挡对方一次连胜计数' },
  blast: { id: 'blast', name: '爆破', tier: 3, uses: 2, condition: '每局开始前', effect: '每球得 2 分，直到一方到达 11 分' },
  chosen: { id: 'chosen', name: '天选', tier: 'chosen', uses: 0, condition: '达成即自动触发', effect: '7 局比赛每局 2:0 开局，不消耗奖励选择次数' }
}

// 宝库阶层（解锁所需总点数）
export const TREASURY_TIERS = [
  { tier: 1, name: '第一阶', range: '总点数 3-6', cards: ['pause', 'blade', 'block', 'charge'] },
  { tier: 2, name: '第二阶', range: '总点数 7-9', cards: ['pause_plus', 'reforge', 'storage'] },
  { tier: 3, name: '第三阶', range: '总点数 10-12', cards: ['rift', 'stardust', 'blast'] },
  { tier: 'chosen', name: '天选', range: '总点数 13', cards: ['chosen'] }
]

// 切片三：启用条件分组（与服务端 PRE_GAME_CARDS / ANYTIME_CARDS 一致）
export const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast']
export const ANYTIME_CARDS = ['pause', 'blade', 'pause_plus']
// 爆破局目标分/封顶分（与服务端 BLAST_TARGET_SCORE / BLAST_MAX_SCORE 一致）
export const BLAST_TARGET_SCORE = 11
export const BLAST_MAX_SCORE = 12

// 切片三卡片使用规则文案（规则 Sheet 展示用）
export const CARD_PLAY_RULES = [
  { id: 'secret', title: '暗选与亮出', text: '启用条件为"每局开始前"的卡片（阻碍/进击/存储器/时空裂隙/星尘卡/爆破）由 4 名选手在局开始前各自录入本人选择（仅限本人在灵魂契合中选到的卡），也可选择"不使用"；4 人全部提交后同时亮出。第 1 局的暗选必须在比赛开始前完成。' },
  { id: 'anytime', title: '随时卡', text: '暂停卡/名刀/高级暂停卡在比赛进行中随时启用，记分页记录使用并扣减库存；名刀启用后下一球对方得分无效。' },
  { id: 'settle', title: '结算卡片', text: '阻碍/进击/星尘卡的效果在局结束后自动并入组合星尘结算；同局冲突时高阶奖励优先生效（星尘卡/阻碍先于进击）。' },
  { id: 'storage', title: '存储器', text: '该局结束后录入启用方额外球得分（胜 0-5、负 0-3），得分自动累积到下一局开局。' },
  { id: 'rift', title: '时空裂隙', text: '在记分页执行回溯 1-2 局；第七局打完后本轮立刻结束，无法回溯。' }
]

// 灵魂契合规则文案（规则 Sheet 展示用）
export const SOUL_RULES = [
  { id: 'roll', title: '灵魂投掷', text: '下篇每轮比赛前，组合双方各进行一次灵魂判定：可选投骰 1 次或 2 次，投 2 次时以第二次点数为准。' },
  { id: 'total', title: '总点数', text: '双方点数之和为判定结果；双方点数相同时，总点数 +1。' },
  { id: 'tier', title: '阶层解锁', text: '按总点数解锁王之宝库：3-6 第一阶、7-9 第二阶、10-12 第三阶、13 触发天选。解锁高阶仍可选低阶奖励。' },
  { id: 'pick', title: '奖励选择', text: '每人只可选 1 次；双方点数相同时，后投掷的选手可额外选 1 次；同一奖励不可重复选择。' },
  { id: 'reroll', title: '重投', text: '凯旋：上篇最终前两名各获得 1 次重投机会。S5 赛季每拥有一个贯穿碎片的选手可任意时刻重投 1 次。奖励选择完成后无法重投。' },
  { id: 'reforge', title: '重铸', text: '解锁第二阶（总点数 7-9）后可选择重铸：重投一次骰子并二选一留用，立刻生效并占用一次奖励选择。' },
  { id: 'chosen', title: '天选', text: '总点数 13 达成天选：7 局比赛每局 2:0 开局。达成即自动触发，不消耗奖励选择次数。' }
]

// 下篇组合星尘计分规则文案（规则 Sheet 展示用，口径同 ./comboStardust）
export const COMBO_SCORING_RULES = [
  { id: 'format', title: '赛制', text: '下篇共 3 轮固定组合赛：AB vs CD、AC vs BD、AD vs BC，每轮打满 7 局。' },
  { id: 'base', title: '小分星尘', text: '每个小分（每局获胜）得 2 星尘。' },
  { id: 'streak', title: '连胜奖励', text: '连胜 2 局 +1、连胜 3 局 +1、连胜 4 局 +2（随连胜累积，7 连胜累计 +8）。' },
  { id: 'breaker', title: '终结奖励', text: '终结对方 2 连胜及以上 +3 星尘。' },
  { id: 'cards', title: '宝库结算卡', text: '阻碍/进击/星尘卡的结算效果自动并入星尘：进击使本局获胜额外获得一次连胜计数；阻碍使对方本局获胜无法获得终结分；星尘卡获胜 +2（净胜 ≥7 再 +1）、失败阻挡对方一次连胜计数。同局冲突时高阶奖励优先生效（星尘卡/阻碍先于进击）。' },
  { id: 'tie', title: '同分裁决', text: '星尘相同时按第 7 局 → 第 1 局的逐局净胜分比较，分差大者胜出。' },
  { id: 'champion', title: '最强组合', text: '三轮结束后星尘最多的组合为最强组合。' }
]

// S7 无上篇：恒 false
export function isTopRound(roundNo) {
  return false
}

export function isComboRound(roundNo) {
  const n = Number(roundNo)
  return Number.isInteger(n) && n >= COMBO_ROUND_MIN && n <= COMBO_ROUND_MAX
}

export function getComboLabelsByRound(roundNo) {
  return COMBO_LABELS_BY_ROUND[Number(roundNo)] || []
}

// 选奖时的阶层上限：天选视同已解锁第三阶（与服务端 getTierCap 一致）
export function getTierCap(unlockTier) {
  if (unlockTier === 'chosen') return 3
  return Number(unlockTier) || 0
}

export function getSoulTierLabel(unlockTier) {
  if (unlockTier === 'chosen') return '天选'
  const tier = TREASURY_TIERS.find(item => item.tier === unlockTier)
  return tier ? tier.name : '未解锁'
}

// 每位选手可选次数：同点时后投者（rolls 中后提交的一方）多选 1 次（与服务端一致）
export function getAllowedPicks(combo, playerId) {
  const [first, second] = combo?.rolls || []
  if (first && second && first.used === second.used && second.playerId === playerId) return 2
  return 1
}

export function getPlayerPickCount(combo, playerId) {
  return (combo?.picks || []).filter(pick => pick.playerId === playerId).length
}

// 单个组合的灵魂契合是否完成：双方已投掷；解锁了奖励时每人须选满次数；
// 未解锁（总点数 2）时无需选奖即视为完成（与服务端 isComboBondComplete 一致）
export function isComboBondComplete(combo) {
  if (!combo || !Array.isArray(combo.rolls) || combo.rolls.length !== 2) return false
  if (combo.unlockTier === null || combo.unlockTier === undefined) return true
  return combo.rolls.every(roll =>
    getPlayerPickCount(combo, roll.playerId) === getAllowedPicks(combo, roll.playerId))
}

function getS7Data(context = {}) {
  return context?.season?.comebackData?.s7 || {}
}

// S7 无王选：恒 null（保留接口形状，调用方零改动）
export function getKingOrder(context = {}) {
  return null
}

// S7 无王选：某轮王恒 null
function getTopKing(roundNo, context = {}) {
  return null
}

// S7 无王权：恒空数组（保留接口形状）
export function calcTopRoundKingRights(context = {}) {
  return []
}

// 灵魂契合种子口径（与服务端 deriveSeeds 一致）：优先读已持久化的
// comebackData.s7.seeds，缺省时按选手 ID 排序。灵魂契合 Sheet 必须用这个口径，
// 否则服务端会校验"该选手不属于此组合"。
export function getSoulSeedMap(season) {
  const seeds = season?.comebackData?.s7?.seeds
  if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) return seeds
  const sorted = [...(season?.participants || [])].sort()
  if (sorted.length < 4) return null
  return { A: sorted[0], B: sorted[1], C: sorted[2], D: sorted[3] }
}

// 排名展示用种子口径：优先读 s7.seeds，缺省按选手 ID 排序（与服务端
// deriveSeeds 一致——S7 无上篇可推导，直接取参赛序）
function getComboSeedMap(context = {}) {
  const seeds = getS7Data(context)?.seeds
  if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) return seeds
  const sorted = [...(context?.participants || context?.season?.participants || [])].sort()
  if (sorted.length < 4) return null
  return { A: sorted[0], B: sorted[1], C: sorted[2], D: sorted[3] }
}

function getComboDefinitions(context) {
  const seedMap = getComboSeedMap(context)
  if (!seedMap) return []

  return COMBO_CONFIGS.map(config => ({
    ...config,
    teamA: config.seedKeys.map(key => seedMap[key]),
    teamB: config.opponentSeedKeys.map(key => seedMap[key]),
    comboName: config.seedKeys.join('+'),
    opponentName: config.opponentSeedKeys.join('+')
  }))
}

// ---- 切片三：王之宝库卡片效果执行 ----

function otherSide(side) {
  return side === 'a' ? 'b' : 'a'
}

// 下篇局状态：两个组合（side a = 该轮第一标签，side b = 第二标签，与服务端
// getComboLabelForSide / roundCreationService 对阵方向一致）的 treasury 与存储器 carry
function getComboPhaseState(roundNo, context = {}) {
  if (!isComboRound(roundNo)) return null
  const s7 = getS7Data(context)
  const labels = COMBO_LABELS_BY_ROUND[Number(roundNo)]
  if (!labels) return null
  return {
    labels,
    treasuryA: s7.treasury?.[labels[0]] || null,
    treasuryB: s7.treasury?.[labels[1]] || null,
    carry: s7.storageCarry?.[context?.match?.id] || null
  }
}

// 某方在某局已亮出的局前暗选（同方两名选手可各激活一条，逐人归属；撤回后重打的
// 同号局继承原暗选——按 (matchId, gameNo, side) 关联即可）
function findRevealedActivations(treasury, matchId, gameNo, side) {
  return (treasury?.activations || []).filter(entry =>
    entry.timing === 'pre_game' && entry.revealed
    && entry.matchId === matchId && entry.gameNo === gameNo && entry.side === side)
}

// 本局已亮出的暗选效果（镜像服务端 getActiveEffects）：值为生效方 'a'/'b'/null
function getActiveEffects(roundNo, context = {}) {
  const effects = { blast: null, block: null, charge: null, stardust: null, storage: null, chosenA: false, chosenB: false }
  const combo = getComboPhaseState(roundNo, context)
  if (!combo) return effects
  effects.chosenA = combo.treasuryA?.chosen === true
  effects.chosenB = combo.treasuryB?.chosen === true

  const gameNo = Number(context?.game?.gameNo ?? context?.gameNo)
  const matchId = context?.match?.id
  if (!Number.isInteger(gameNo) || !matchId) return effects

  for (const treasury of [combo.treasuryA, combo.treasuryB]) {
    for (const entry of treasury?.activations || []) {
      if (entry.timing !== 'pre_game' || !entry.revealed) continue
      if (entry.matchId !== matchId || entry.gameNo !== gameNo) continue
      if (Object.prototype.hasOwnProperty.call(effects, entry.cardId)) {
        effects[entry.cardId] = entry.side
      }
    }
  }
  return effects
}

// 连胜奖励表（同 comboStardust BONUS，索引 = 连胜长度，封顶 7）
// 里程碑 +1/+1/+2 循环累积：2:+1, 3:+2, 4:+4, 5:+5, 6:+6, 7:+8
const STREAK_BONUS = [0, 0, 1, 2, 4, 5, 6, 8]

// 在修正后的胜方序列上计算某一方的连胜/终结奖励。
// neutral 项（被星尘卡挡下的胜）：仍可终结对方连胜（产生终结 +3，除非被阻碍压制），
// 但不开始/延续胜方自己的连胜；dup 项（进击复制的胜）只参与连胜长度累计。
function calcSideStreaks(sequence, side) {
  const other = otherSide(side)
  let streakBonus = 0
  let breakerBonus = 0
  let curWinner = null
  let curLen = 0

  const close = () => {
    if (curWinner === side && curLen >= 2) {
      streakBonus += STREAK_BONUS[Math.min(curLen, STREAK_BONUS.length - 1)]
    }
  }

  for (const entry of sequence) {
    if (entry.neutral) {
      if (entry.winner === side && curWinner === other && curLen >= 2 && !entry.noBreaker) breakerBonus += 3
      close()
      curWinner = null
      curLen = 0
      continue
    }
    if (entry.winner === curWinner) {
      curLen++
      continue
    }
    if (entry.winner === side && curWinner === other && curLen >= 2 && !entry.noBreaker) breakerBonus += 3
    close()
    curWinner = entry.winner
    curLen = 1
  }
  close()
  return { streakBonus, breakerBonus }
}

// 组合星尘结算修正：在该场已亮出的局前暗选之上，把阻碍/进击/星尘卡的效果
// 并入星尘（裁决顺序见文件头注释）。返回覆盖字段；未调整时数值与基础口径一致。
function applyTreasurySettlement(match, getGamesByMatch, perspective, treasuryBySide) {
  const empty = { adjustments: [], cardBonus: 0 }
  if (!match || match.status !== STATUS.COMPLETED) return empty

  const games = getCompletedGames(match, getGamesByMatch)
    .slice()
    .sort((a, b) => a.gameNo - b.gameNo)
  if (!games.length) return empty

  const sequence = []
  const adjustments = []

  for (const game of games) {
    const winner = game.winner
    const entry = {
      gameNo: game.gameNo,
      winner,
      scoreA: game.scoreA || 0,
      scoreB: game.scoreB || 0,
      neutral: false,
      noBreaker: false,
      dup: false,
      flat: 0
    }
    sequence.push(entry)
    if (winner !== 'a' && winner !== 'b') continue

    const loser = otherSide(winner)
    const winnerActs = findRevealedActivations(treasuryBySide?.[winner], match.id, entry.gameNo, winner)
    const loserActs = findRevealedActivations(treasuryBySide?.[loser], match.id, entry.gameNo, loser)
    const winnerHas = cardId => winnerActs.some(act => act.cardId === cardId)
    const loserHas = cardId => loserActs.some(act => act.cardId === cardId)

    // ① 星尘卡(t3) 负方效果：对方该胜不计入连胜
    if (loserHas('stardust')) {
      entry.neutral = true
      adjustments.push({ gameNo: entry.gameNo, cardId: 'stardust', side: loser, affectedSide: winner, delta: null, display: '星尘卡·连胜被挡' })
    }
    // ① 星尘卡(t3) 胜方效果：直接 +2，净胜 ≥7 再 +1
    if (winnerHas('stardust')) {
      const diff = Math.abs(entry.scoreA - entry.scoreB)
      const bonus = diff >= 7 ? 3 : 2
      entry.flat += bonus
      adjustments.push({ gameNo: entry.gameNo, cardId: 'stardust', side: winner, affectedSide: winner, delta: bonus, display: `星尘卡 +${bonus}` })
    }
    // ② 阻碍(t3)：对方该胜不产生终结 +3
    if (loserHas('block')) {
      entry.noBreaker = true
      adjustments.push({ gameNo: entry.gameNo, cardId: 'block', side: loser, affectedSide: winner, delta: null, display: '阻碍·终结无效' })
    }
    // ③ 进击(t1)：该胜仍计入连胜时复制一次连胜计数；已被星尘卡挡下则不适用
    if (winnerHas('charge')) {
      if (!entry.neutral) {
        sequence.push({ ...entry, dup: true, flat: 0 })
        adjustments.push({ gameNo: entry.gameNo, cardId: 'charge', side: winner, affectedSide: winner, delta: null, display: '进击·连胜+1' })
      } else {
        adjustments.push({ gameNo: entry.gameNo, cardId: 'charge', side: winner, affectedSide: winner, delta: null, display: '进击·未生效' })
      }
    }
  }

  const { streakBonus, breakerBonus } = calcSideStreaks(sequence, perspective)
  const cardBonus = sequence
    .filter(entry => !entry.dup && entry.winner === perspective)
    .reduce((sum, entry) => sum + entry.flat, 0)

  return {
    streakBonus,
    breakerBonus,
    cardBonus,
    adjustments: adjustments.filter(item => item.affectedSide === perspective)
  }
}

export default {
  id: 's7',
  name: 'S6赛季规则',
  description: '王权之续：3 轮固定组合赛、灵魂契合与王之宝库（S6 下篇独立成季）',
  lifecycle: {
    beforeRound: {
      type: 'soul_bond',
      required: true,
      label: '灵魂契合'
    },
    roundStart: {
      type: 'matches'
    },
    afterRound: {
      type: 'ranking'
    }
  },

  isTopRound(roundNo) {
    return isTopRound(roundNo)
  },

  isComboRound(roundNo) {
    return isComboRound(roundNo)
  },

  // 创建第 roundNo 轮前的强制流程：上篇王选、下篇灵魂契合
  getBeforeRoundRequirement(roundNo) {
    if (isTopRound(roundNo)) return { type: 'king_selection', required: true, label: '王选' }
    if (isComboRound(roundNo)) return { type: 'soul_bond', required: true, label: '灵魂契合' }
    return null
  },

  getTopKing(roundNo, context) {
    return getTopKing(roundNo, context)
  },

  calcTopRoundKingRights(context) {
    return calcTopRoundKingRights(context)
  },

  getKingOrder(context) {
    return getKingOrder(context)
  },

  getComboLabelsByRound(roundNo) {
    return getComboLabelsByRound(roundNo)
  },

  // 该轮固定对阵的两个组合标识（如 R5 → ['AB', 'CD']）
  getComboLabelByRound(roundNo) {
    return COMBO_CONFIGS.find(config => config.roundNo === roundNo)?.label || null
  },

  getSoulBond(roundNo, context) {
    if (!isComboRound(roundNo)) return {}
    return getS7Data(context)?.soulBond?.[String(roundNo)] || {}
  },

  getTreasury(comboLabel, context) {
    return getS7Data(context)?.treasury?.[comboLabel] || null
  },

  getComboSeedMap(context) {
    return getComboSeedMap(context)
  },

  getComboDefinitions(context) {
    return getComboDefinitions(context)
  },

  calcComboRankings(matches, getGamesByMatch, rounds, context) {
    const definitions = getComboDefinitions({
      ...context,
      matches,
      rounds,
      getGamesByMatch
    })
    const rows = buildComboRankings(definitions, matches, getGamesByMatch, rounds)

    // 切片三：在基础星尘之上叠加结算卡修正（星尘优先排序，同 S4 口径）
    const treasury = getS7Data(context)?.treasury || {}
    const adjusted = rows.map(row => {
      const labels = COMBO_LABELS_BY_ROUND[row.roundNo]
      const match = row.matchId ? matches.find(item => item.id === row.matchId) : null
      if (!labels || !match) return { ...row, adjustments: [], cardBonus: 0 }
      const patch = applyTreasurySettlement(match, getGamesByMatch, row.perspective, {
        a: treasury[labels[0]] || null,
        b: treasury[labels[1]] || null
      })
      const stars = row.baseStars
        + (patch.streakBonus ?? row.streakBonus)
        + (patch.breakerBonus ?? row.breakerBonus)
        + (patch.cardBonus || 0)
      return {
        ...row,
        ...patch,
        stars,
        // 未修正口径（透明展示用）
        rawStars: row.stars,
        rawStreakBonus: row.streakBonus,
        rawBreakerBonus: row.breakerBonus
      }
    })
    return sortComboRankings(adjusted)
  },

  // 某场下篇比赛的宝库视图：双方组合标签、库存（服务端提交即扣减，即剩余次数）、
  // 本场激活记录；非下篇轮次返回 null
  getMatchTreasury(matchId, context = {}) {
    const roundNo = Number(context?.round?.roundNo ?? context?.roundNo)
    const combo = getComboPhaseState(roundNo, context)
    if (!combo) return null
    const sideView = (side, treasury) => ({
      label: side === 'a' ? combo.labels[0] : combo.labels[1],
      inventory: treasury?.inventory || {},
      chosen: treasury?.chosen === true,
      activations: (treasury?.activations || []).filter(entry => entry.matchId === matchId)
    })
    return {
      roundNo,
      sides: {
        a: sideView('a', combo.treasuryA),
        b: sideView('b', combo.treasuryB)
      }
    }
  },

  // 某局的暗选状态（逐人）：4 名选手各自的提交情况，全部提交后服务端同时亮出；
  // 亮出前不暴露 cardId。entries 按 teamA → teamB 顺序，side 由选手所在队伍推导
  getPendingSecretState(matchId, gameNo, context = {}) {
    const roundNo = Number(context?.round?.roundNo ?? context?.roundNo)
    const labels = COMBO_LABELS_BY_ROUND[roundNo] || []
    const treasury = getS7Data(context)?.treasury || {}
    const match = context?.match || {}
    const players = [
      ...(match.teamA || []).map(playerId => ({ playerId, side: 'a' })),
      ...(match.teamB || []).map(playerId => ({ playerId, side: 'b' }))
    ]
    const byPlayer = new Map()
    for (const label of labels) {
      for (const entry of treasury?.[label]?.activations || []) {
        if (entry.timing !== 'pre_game' || entry.matchId !== matchId || entry.gameNo !== gameNo) continue
        if (entry.playerId) byPlayer.set(entry.playerId, entry)
      }
    }
    const allSubmitted = players.length > 0 && players.every(p => byPlayer.has(p.playerId))
    const revealed = allSubmitted && players.every(p => byPlayer.get(p.playerId)?.revealed)
    return {
      gameNo,
      entries: players.map(({ playerId, side }) => ({
        playerId,
        side,
        submitted: byPlayer.has(playerId),
        cardId: revealed ? (byPlayer.get(playerId)?.cardId ?? null) : null
      })),
      allSubmitted,
      revealed
    }
  },

  // 选手本人拥有（灵魂契合 picks 中 playerId+cardId，任一轮次）的局前暗选卡；
  // remaining 为组合聚合库存（服务端提交即扣减），选手只看到本人选到的卡
  getPlayerPreGameCards(playerId, comboLabel, context = {}) {
    const s7 = getS7Data(context)
    const inventory = s7?.treasury?.[comboLabel]?.inventory || {}
    const owned = new Set()
    for (const roundBond of Object.values(s7?.soulBond || {})) {
      for (const pick of roundBond?.[comboLabel]?.picks || []) {
        if (pick.playerId === playerId && PRE_GAME_CARDS.includes(pick.cardId)) owned.add(pick.cardId)
      }
    }
    return [...owned].map(cardId => ({
      cardId,
      ...TREASURY_CARDS[cardId],
      remaining: inventory[cardId] || 0
    }))
  },

  getComboTieStatus(matches, getGamesByMatch, rounds, context) {
    const rankings = this.calcComboRankings(matches, getGamesByMatch, rounds, context)
    if (rankings.length === 0) {
      return { tied: false, leaders: [], rankings }
    }

    const comboRoundNos = [...new Set(COMBO_CONFIGS.map(config => config.roundNo))]
    const completedComboRounds = (rounds || [])
      .filter(round => isComboRound(round.roundNo) && round.status === STATUS.COMPLETED)
    if (completedComboRounds.length < comboRoundNos.length) {
      return { tied: false, leaders: [], rankings }
    }

    return resolveComboTie(rankings)
  },

  getGameConfig(roundNo, context = {}) {
    const king = getTopKing(roundNo, context)
    const combo = getComboPhaseState(roundNo, context)
    const activeEffects = getActiveEffects(roundNo, context)
    const blast = activeEffects.blast !== null
    const config = {
      scoringMode: 'standard',
      targetScore: blast ? BLAST_TARGET_SCORE : 21,
      maxScore: blast ? BLAST_MAX_SCORE : 30,
      requiresWinner: false,
      supportsPierce: false,
      openingScoreA: 0,
      openingScoreB: 0,
      kingId: king?.kingId || null,
      kingForm: king?.form || null,
      activeEffects
    }

    // 上篇黛青：王所在方每局 +2
    if (king?.form === 'daiqing') {
      const teamA = context?.match?.teamA || []
      const teamB = context?.match?.teamB || []
      if (teamA.includes(king.kingId)) config.openingScoreA += 2
      else if (teamB.includes(king.kingId)) config.openingScoreB += 2
    }

    // 上篇月白：王参与的局按抵抗局处理（同 S5 秩序；显式胜方，允许分低者获胜）。
    // 爆破仅下篇，与月白不会同时命中（与服务端 isYuebaiKingMatch 口径一致）
    if (king?.form === 'yuebai') {
      const teamA = context?.match?.teamA || []
      const teamB = context?.match?.teamB || []
      if (teamA.includes(king.kingId) || teamB.includes(king.kingId)) {
        config.scoringMode = 'resistance'
        config.requiresWinner = true
      }
    }

    // 下篇：天选组合每局 +2；存储器 carry 一次性带入（服务端局开始已写入局行，
    // 此处仅供展示/预览，与服务端 getOpeningScore 口径一致）
    if (combo) {
      if (combo.treasuryA?.chosen === true) config.openingScoreA += 2
      if (combo.treasuryB?.chosen === true) config.openingScoreB += 2
      if (combo.carry) {
        const points = Number(combo.carry.points || 0)
        if (combo.carry.side === 'a') config.openingScoreA += points
        else config.openingScoreB += points
      }
    }

    return config
  },

  // 上篇计分复用 standard（大分/小分/得分）
  calcPlayerScore(playerId, matches, getGamesByMatch, context) {
    return standardRule.calcPlayerScore(playerId, matches, getGamesByMatch, context)
  },

  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context) {
    return standardRule
      .calcRankings(participants, matches, getGamesByMatch, getPlayerById, context)
      .map(row => ({
        ...row,
        buffs: this.getPlayerBuffs(row.id, matches, getGamesByMatch, context)
      }))
  },

  calcWinLoss(playerId, matches) {
    return standardRule.calcWinLoss(playerId, matches)
  },

  getPlayerBuffs() {
    return []
  },

  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    const comboContext = {
      ...context,
      matches,
      rounds,
      getGamesByMatch
    }
    const seedMap = getComboSeedMap({
      ...comboContext,
      participants: context?.participants || context?.season?.participants || [],
      getPlayerById: context?.getPlayerById
    })
    const comboRankings = this.calcComboRankings(matches, getGamesByMatch, rounds, comboContext)
    const tieStatus = this.getComboTieStatus(matches, getGamesByMatch, rounds, comboContext)
    const s7Data = getS7Data(context)

    return {
      buffs: [
        {
          id: 's7_combo_phase',
          name: '组合赛',
          settled: false,
          interactive: true,
          seedMap,
          soulBond: s7Data?.soulBond || {},
          treasury: s7Data?.treasury || {},
          comboRankings,
          tieStatus
        }
      ]
    }
  }
}