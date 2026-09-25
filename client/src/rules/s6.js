/**
 * S6赛季规则（切片一：上篇 1-4 轮 王选 + 王形态；切片二：下篇 5-7 轮 组合赛 + 灵魂契合）
 *
 * 上篇规则：
 * - 标准 21 分制 BO3，排名复用 standard 大分/小分结算。
 * - 王选只在第 1 轮开始前进行一次：4 名参赛者各投一次骰子，按点数从大到小
 *   决定第 1-4 轮的王；同点者组内重投，仅决定组内顺序（不做全局重排）。
 *   客户端裁决后提交最终王序，服务端持久化
 *   comebackData.s6.kingOrder = [{ playerId, dice, rolls? }]（顺序即王序，
 *   dice 为决定名次的点数，rolls 为含首投的完整投掷序列，仅重投过时携带）。
 *   各轮形态经 s6_king_form 写入 topKings[roundNo] = { kingId, form }；
 *   旧数据（prod 第 1 轮，无 kingOrder）回退 topKings[roundNo].kingId。
 * - 王在赛前选择形态：daiqing（黛青）/feihong（绯红）/yuebai（月白）。
 * - 黛青：王所在方每局自动 2:0 开局（服务端在局进入进行中时写入开局分）。
 * - 绯红：局内人工记分，记分页按 kingForm 展示规则提示。
 * - 月白：王参与的场次的局按抵抗局处理（同 S5 秩序模型）——getGameConfig
 *   返回 scoringMode 'resistance'（21/30，requiresWinner），局终显式选择胜方，
 *   允许分低者获胜（如 21:29 胜方为 21 分侧）。刻意简化：不追踪"对方是否
 *   先到 15 分"的局中事件，王的所有月白局一律按抵抗局配置。
 *
 * 下篇规则（切片二）：
 * - 第 5/6/7 轮固定组合 PA7 对阵：AB vs CD / AC vs BD / AD vs BC，打满 7 局。
 * - 组合星尘计分同 S4 下篇（共享 ./comboStardust）：每小分 2 星尘、连胜累计
 *   奖励、终结对方 2 连胜 +3、同分按第 7→1 局逐局净胜分裁决；星尘第一为最强组合。
 * - 种子 A-D 存 comebackData.s6.seeds（首次灵魂投掷时服务端持久化）；缺省时
 *   客户端按上篇标准排名推导前 4（同 S4 getComboSeedMap 口径）。
 * - 灵魂契合：每轮赛前每个组合双方各投骰（选 1 或 2 次，2 次以第二次为准），
 *   点数求和（同点 +1）得总点数，按 3-6/7-9/10-12/13 解锁王之宝库阶层；
 *   每人选 1 个奖励（同点时后投者 2 个，不可重复，高阶解锁可选低阶）；
 *   重铸（第二阶解锁）立刻重投二选一；天选（13 点）自动触发不占选择。
 * - 状态存 comebackData.s6.soulBond / treasury，经 s6_soul_roll / s6_soul_pick /
 *   s6_reforge 服务端动作持久化。
 *
 * 切片三：王之宝库卡片效果执行
 * - 暗选（s6_card_activate）：局前卡 block/charge/storage/rift/stardust/blast 在某局
 *   pending（或局行未创建）时逐人提交（payload 带 playerId，side 由选手所在队伍
 *   推导），cardId=null 表示"不使用"；该场 4 名选手全部提交后服务端同时置
 *   revealed=true（同时亮出）；提交即扣库存（按组合聚合）。选手只能启用本人在
 *   灵魂契合中选到的卡（soulBond[*][comboLabel].picks 归属）。第 1 局必须在
 *   比赛开始前提交。同一方两名选手可各激活一张。
 * - 随时卡（s6_card_use）：pause/blade/pause_plus 在比赛进行中随时记录使用并扣库存。
 * - 存储器（s6_storage_record）：该局结束后录入启用方额外球得分（胜 0-5 / 负 0-3），
 *   服务端自动把得分带入下一局开局（storageCarry 或直接加到进行中局的比分）。
 * - 时空裂隙（s6_rift）：存在未消耗的 rift 暗选且第七局未完成时，客户端用该动作
 *   代替裸 revert 接口回溯最近 1-2 局。
 * - 结算卡（block/charge/stardust）在组合星尘之上做修正，冲突裁决（高阶优先）：
 *   ① 星尘卡(t3)：启用方胜 → 直接 +2（净胜 ≥7 再 +1）；启用方负 → 对方该胜
 *      不计入/延续连胜（仍可终结对方连胜产生终结分，终结分是阻碍的职责范围）。
 *   ② 阻碍(t3)：对方该胜不产生终结 +3（与①作用维度不同，无先后交叠）。
 *   ③ 进击(t1)：启用方胜且该胜仍计入连胜 → 复制该胜进连胜序列（连胜计数 +1）；
 *      若该胜已被星尘卡挡下连胜计数，则进击不再适用（无连胜计数可复制）。
 * - getGameConfig 下篇镜像服务端：爆破局 targetScore 11 / maxScore 12（每球 2 分
 *   无加分，偶数分可越过 11 到 12）；开局分 = 天选 +2 + 存储器 carry；
 *   activeEffects 仅统计已亮出（revealed）的局前暗选。开局分服务端在局开始时已
 *   写入局行，客户端字段仅用于展示/预览。
 */

import { STATUS } from '@/constants'
import standardRule from './standard'
import {
  buildComboRankings, resolveComboTie, sortComboRankings, getCompletedGames
} from './comboStardust'

const TOP_ROUND_MAX = 4
const COMBO_ROUND_MIN = 5
const COMBO_ROUND_MAX = 7

// 下篇组合固定对阵（与 S4 同一轮换；label 为视角方，opponentLabel 为对手）
const COMBO_CONFIGS = [
  { roundNo: 5, label: 'AB', opponentLabel: 'CD', seedKeys: ['A', 'B'], opponentSeedKeys: ['C', 'D'], perspective: 'a' },
  { roundNo: 6, label: 'AC', opponentLabel: 'BD', seedKeys: ['A', 'C'], opponentSeedKeys: ['B', 'D'], perspective: 'a' },
  { roundNo: 7, label: 'AD', opponentLabel: 'BC', seedKeys: ['A', 'D'], opponentSeedKeys: ['B', 'C'], perspective: 'a' },
  { roundNo: 5, label: 'CD', opponentLabel: 'AB', seedKeys: ['C', 'D'], opponentSeedKeys: ['A', 'B'], perspective: 'b' },
  { roundNo: 6, label: 'BD', opponentLabel: 'AC', seedKeys: ['B', 'D'], opponentSeedKeys: ['A', 'C'], perspective: 'b' },
  { roundNo: 7, label: 'BC', opponentLabel: 'AD', seedKeys: ['B', 'C'], opponentSeedKeys: ['A', 'D'], perspective: 'b' }
]

const COMBO_LABELS_BY_ROUND = {
  5: ['AB', 'CD'],
  6: ['AC', 'BD'],
  7: ['AD', 'BC']
}

export const KING_FORMS = {
  daiqing: { id: 'daiqing', name: '黛青', keyword: '开局领先', effect: '王所在方每局 2:0 开局' },
  feihong: { id: 'feihong', name: '绯红', keyword: '每球两分', effect: '王率先到达 15 分后，王的得分每球计 2 分' },
  yuebai: { id: 'yuebai', name: '月白', keyword: '赛点抵抗', effect: '对方先到 15 分后王获得抵抗——赛点需连拿 2 分，结束需手动选择胜方（可能出现分低者获胜）' }
}

// 上篇规则文案（规则 Sheet 展示用，与组件展示文字保持一致）
export const KING_RULES = [
  { id: 'roll', title: '王选', text: '上篇开始前进行一次王选：4 名参赛者各投一次骰子，按点数从大到小依次决定第 1-4 轮的"王"；同点者组内重投，仅决定并列者之间的顺序。' },
  { id: 'privilege', title: '王权', text: '每轮第四名要给"王"提供一瓶运动饮料，若"王"为第四名则由第三名提供。名次按该轮已完赛比赛的标准结算（大分 → 小分 → 得分）确定，排名页王选面板逐轮展示提供人。' },
  { id: 'triumph', title: '凯旋', text: '上篇最终前两名在组合赛中各获得 1 次重新投掷骰子的机会。' }
]

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

export function isTopRound(roundNo) {
  const n = Number(roundNo)
  return Number.isInteger(n) && n >= 1 && n <= TOP_ROUND_MAX
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

function getS6Data(context = {}) {
  return context?.season?.comebackData?.s6 || {}
}

// 一次性王序（第 1-4 轮的王依次为王序第 1-4 位）；未设置时返回 null
export function getKingOrder(context = {}) {
  const order = getS6Data(context)?.kingOrder
  return Array.isArray(order) && order.length === 4 ? order : null
}

// 某轮的王：优先取自王序 kingOrder[roundNo-1]，旧数据（prod 第 1 轮，
// 无 kingOrder）回退 topKings[roundNo].kingId；形态始终读 topKings[roundNo].form
function getTopKing(roundNo, context = {}) {
  if (!isTopRound(roundNo)) return null
  const s6 = getS6Data(context)
  const legacy = s6?.topKings?.[String(roundNo)]
  const kingId = s6?.kingOrder?.[Number(roundNo) - 1]?.playerId || legacy?.kingId
  if (!kingId) return null
  return { kingId, form: legacy?.form || null, rolls: legacy?.rolls }
}

// 王权：上篇每轮第四名给本轮的王提供一瓶运动饮料；王为第四名时顺延第三名。
// 轮次内排名复用 standard 结算（仅取该轮已完赛比赛），大分 → 小分 → 得分。
// 返回每个已创建上篇轮次的 { roundNo, status, kingId, standings, completedMatchCount,
// complete, lastPlace, provider, kingIsLast }；该轮无已完赛比赛时 lastPlace/provider 为 null
export function calcTopRoundKingRights(context = {}) {
  const rounds = context?.rounds || []
  const matches = context?.matches || []
  const getGamesByMatch = context?.getGamesByMatch || (() => [])
  const getPlayerById = context?.getPlayerById || ((id) => ({ id }))
  const participants = context?.participants || context?.season?.participants || []

  return rounds
    .filter(round => isTopRound(round.roundNo))
    .sort((a, b) => Number(a.roundNo) - Number(b.roundNo))
    .map(round => {
      const roundMatches = matches.filter(match =>
        match.roundId === round.id && match.status === STATUS.COMPLETED)
      const king = getTopKing(round.roundNo, context)
      const standings = standardRule
        .calcRankings(participants, roundMatches, getGamesByMatch, getPlayerById, context)
        .sort((a, b) =>
          (b.finalBigScore - a.finalBigScore)
          || (b.finalSmallScore - a.finalSmallScore)
          || (b.totalPoints - a.totalPoints))

      const hasResults = roundMatches.length > 0
      const lastPlace = hasResults ? standings[standings.length - 1]?.id || null : null
      const kingIsLast = !!(lastPlace && king?.kingId && king.kingId === lastPlace)
      // 顺延：王为第四名时由第三名提供
      const provider = !lastPlace ? null
        : kingIsLast ? standings[standings.length - 2]?.id || null
        : lastPlace

      return {
        roundNo: Number(round.roundNo),
        status: round.status,
        kingId: king?.kingId || null,
        standings,
        completedMatchCount: roundMatches.length,
        complete: round.status === STATUS.COMPLETED,
        lastPlace,
        provider,
        kingIsLast
      }
    })
}

// 灵魂契合种子口径（与服务端 deriveSeeds 一致）：优先读已持久化的
// comebackData.s6.seeds，缺省时按选手 ID 排序。灵魂契合 Sheet 必须用这个口径，
// 否则服务端会校验"该选手不属于此组合"。
export function getSoulSeedMap(season) {
  const seeds = season?.comebackData?.s6?.seeds
  if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) return seeds
  const sorted = [...(season?.participants || [])].sort()
  if (sorted.length < 4) return null
  return { A: sorted[0], B: sorted[1], C: sorted[2], D: sorted[3] }
}

// 排名展示用种子口径（同 S4 getComboSeedMap）：优先读 s6.seeds，
// 缺省时按上篇（1-4 轮）标准排名推导前 4
function getComboSeedMap(context = {}) {
  const seeds = getS6Data(context)?.seeds
  if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) return seeds

  const rounds = context?.rounds || []
  const topRounds = rounds.filter(round => isTopRound(round.roundNo))
  const completedTopRounds = topRounds.filter(round => round.status === STATUS.COMPLETED)
  if (completedTopRounds.length < TOP_ROUND_MAX) return null

  const topRoundIds = new Set(topRounds.map(round => round.id))
  const topMatches = (context?.matches || []).filter(match => topRoundIds.has(match.roundId))
  const rankings = standardRule.calcRankings(
    context?.participants || [],
    topMatches,
    context?.getGamesByMatch,
    context?.getPlayerById,
    context
  )
  if (rankings.length < 4) return null

  return {
    A: rankings[0].id,
    B: rankings[1].id,
    C: rankings[2].id,
    D: rankings[3].id
  }
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
  const s6 = getS6Data(context)
  const labels = COMBO_LABELS_BY_ROUND[Number(roundNo)]
  if (!labels) return null
  return {
    labels,
    treasuryA: s6.treasury?.[labels[0]] || null,
    treasuryB: s6.treasury?.[labels[1]] || null,
    carry: s6.storageCarry?.[context?.match?.id] || null
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
  id: 's6',
  name: 'S6赛季规则',
  description: '上篇王选掷骰与三种王形态；下篇固定组合赛、灵魂契合与王之宝库',
  lifecycle: {
    beforeRound: {
      type: 'king_selection',
      required: true,
      label: '王选'
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
    return getS6Data(context)?.soulBond?.[String(roundNo)] || {}
  },

  getTreasury(comboLabel, context) {
    return getS6Data(context)?.treasury?.[comboLabel] || null
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
    const treasury = getS6Data(context)?.treasury || {}
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
    const treasury = getS6Data(context)?.treasury || {}
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
    const s6 = getS6Data(context)
    const inventory = s6?.treasury?.[comboLabel]?.inventory || {}
    const owned = new Set()
    for (const roundBond of Object.values(s6?.soulBond || {})) {
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

  getPlayerBuffs(playerId, matches, getGamesByMatch, context) {
    const topKings = getS6Data(context)?.topKings || {}
    const kingRounds = Object.entries(topKings)
      .filter(([, king]) => king?.kingId === playerId)
      .map(([roundNo]) => Number(roundNo))
      .sort((a, b) => a - b)
    if (!kingRounds.length) return []
    return [{
      id: 'king',
      name: '王',
      count: kingRounds.length,
      settled: true,
      description: `第 ${kingRounds.join('、')} 轮的王`
    }]
  },

  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    const topKings = getS6Data(context)?.topKings || {}
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
    const s6Data = getS6Data(context)

    return {
      buffs: [
        {
          id: 's6_top_kings',
          name: '王选',
          kings: (rounds || [])
            .filter(round => isTopRound(round.roundNo))
            .map(round => {
              const king = topKings[String(round.roundNo)] || null
              return {
                roundNo: round.roundNo,
                status: round.status,
                kingId: king?.kingId || null,
                form: king?.form || null,
                settled: !!(king?.kingId && king?.form)
              }
            })
        },
        {
          id: 's6_combo_phase',
          name: '组合赛',
          settled: false,
          interactive: true,
          seedMap,
          soulBond: s6Data?.soulBond || {},
          treasury: s6Data?.treasury || {},
          comboRankings,
          tieStatus
        }
      ]
    }
  }
}
