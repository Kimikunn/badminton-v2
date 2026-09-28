/**
 * comboCards.js — S6/S7 共享的宝库卡常量与展示层工具（2026-09-28 抽取）
 *
 * 两个生命周期（与服务端 comboCardFlow.js 同口径）：
 *   - **局前记录（pre_game）**：阻碍/进击/存储器/时空裂隙/星尘卡/爆破——
 *     每局开始前 4 名选手逐人提交（本人选到的卡或「不使用」），集齐即亮出，
 *     提交即扣库存；**是开局硬门控**（每局开始前必须全部录入）。
 *   - **局后记录（post_game，旧数据兼容 timing='anytime'）**：暂停卡/名刀/
 *     高级暂停卡——实际对局中人工启用，效果线下执行；**在该局结束后补记**
 *     使用次数（带 gameNo 归属该局，每条消耗 1 次库存）。
 *
 * s6.js/s7.js 从本模块再导出；展示层 activationState 兼容两种 timing。
 */

// 王之宝库卡片目录（口径与服务端一致；uses 为每张卡的库存次数，
// reforge/chosen 不进库存：重铸立刻生效，天选自动触发）
export const TREASURY_CARDS = {
  pause: { id: 'pause', name: '暂停卡', tier: 1, uses: 3, condition: '随时', effect: '暂停 45 秒' },
  blade: { id: 'blade', name: '名刀', tier: 1, uses: 3, condition: '随时', effect: '启用后下一球对方得分无效' },
  block: { id: 'block', name: '阻碍', tier: 1, uses: 1, condition: '每局开始前', effect: '对方本局获胜无法获得终结分' },
  charge: { id: 'charge', name: '进击', tier: 1, uses: 1, condition: '每局开始前', effect: '本局获胜额外获得一次连胜计数' },
  pause_plus: { id: 'pause_plus', name: '高级暂停卡', tier: 2, uses: 3, condition: '随时', effect: '暂停 45 秒，回来后可选发球方和场地，无法被其他高级暂停卡覆盖' },
  reforge: { id: 'reforge', name: '重铸', tier: 2, uses: 0, condition: '立刻生效', effect: '重投一次骰子并二选一留用，占用一次奖励选择' },
  storage: { id: 'storage', name: '存储器', tier: 2, uses: 2, condition: '每局开始前', effect: '本局获胜额外再打 5 球、失败 3 球，启用方得分累积到下一局开局' },
  rift: { id: 'rift', name: '时空裂隙', tier: 3, uses: 1, condition: '每局开始前', effect: '回溯到 1 局或 2 局前；第七局打完后本轮立刻结束，无法回溯' },
  stardust: { id: 'stardust', name: '星尘卡', tier: 3, uses: 1, condition: '每局开始前', effect: '本局获胜 +2 星尘，净胜 ≥7 再 +1；失败可阻挡对方一次连胜计数' },
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

// 两个生命周期分组
export const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast']
export const POST_GAME_CARDS = ['pause', 'blade', 'pause_plus']
// 旧引用别名（原「随时卡」，语义 = 局后记录卡）
export const ANYTIME_CARDS = POST_GAME_CARDS
export const BLAST_TARGET_SCORE = 11
export const BLAST_MAX_SCORE = 12

// 卡片使用规则文案（规则 Sheet 展示用；局前/局后两生命周期）
export const CARD_PLAY_RULES = [
  { id: 'secret', title: '局前记录（暗选）', text: '阻碍/进击/存储器/时空裂隙/星尘卡/爆破：每局开始前由 4 名选手逐人录入本人选择（仅限本人在灵魂契合中选到的卡，也可选「不使用」），4 人全部提交后同时亮出。局前记录是开局硬门控——每局（含第 1 局）必须全部录入才能开始。' },
  { id: 'postgame', title: '局后记录', text: '暂停卡/名刀/高级暂停卡在实际对局中随时启用（效果线下执行），在该局结束后由记分页按方补记使用次数（每条消耗 1 次库存，归属该局）。' },
  { id: 'settle', title: '结算卡片', text: '阻碍/进击/星尘卡的效果在局结束后自动并入组合星尘结算；同局冲突时高阶奖励优先生效（星尘卡/阻碍先于进击）。' },
  { id: 'storage', title: '存储器', text: '该局结束后录入启用方额外球得分（胜 0-5、负 0-3），得分自动累积到下一局开局。' },
  { id: 'rift', title: '时空裂隙', text: '在记分页执行回溯 1-2 局；第七局打完后本轮立刻结束，无法回溯。' }
]


// ── 局前暗选状态（逐人，s6/s7 共用）──
// required = 选手手上有可用局前卡（本人选到且库存 >0）；无可用卡的选手免录入
// （门控不要求其提交，UI 显示「无需录入」）。allSubmitted 仅统计 required 选手。
export function getPendingSecretState(state, labels, match, matchId, gameNo) {
  if (!match || !Number.isInteger(gameNo)) return null
  const players = [
    ...(match.teamA || []).map(playerId => ({ playerId, side: 'a', label: labels?.[0] })),
    ...(match.teamB || []).map(playerId => ({ playerId, side: 'b', label: labels?.[1] }))
  ]
  if (!players.length) return null
  const byPlayer = new Map()
  for (const label of labels || []) {
    for (const entry of state?.treasury?.[label]?.activations || []) {
      if (entry.timing !== 'pre_game' || entry.matchId !== matchId || entry.gameNo !== gameNo) continue
      if (entry.playerId) byPlayer.set(entry.playerId, entry)
    }
  }
  const rows = players.map(({ playerId, side, label }) => ({
    playerId,
    side,
    required: playerHasAvailablePreGameCard(state, label, playerId),
    submitted: byPlayer.has(playerId),
    cardId: (byPlayer.get(playerId)?.revealed) ? (byPlayer.get(playerId)?.cardId ?? null) : null
  }))
  const requiredRows = rows.filter(row => row.required)
  const allSubmitted = requiredRows.length === 0 ? true : requiredRows.every(row => row.submitted)
  const revealed = allSubmitted
    && requiredRows.every(row => !!byPlayer.get(row.playerId)?.revealed)
  return { gameNo, entries: rows, allSubmitted, revealed }
}

export function playerHasAvailablePreGameCard(state, comboLabel, playerId) {
  const inventory = state?.treasury?.[comboLabel]?.inventory || {}
  for (const roundBond of Object.values(state?.soulBond || {})) {
    for (const pick of roundBond?.[comboLabel]?.picks || []) {
      if (pick.playerId === playerId && PRE_GAME_CARDS.includes(pick.cardId)
        && Number(inventory[pick.cardId] || 0) > 0) return true
    }
  }
  return false
}

// 选手本人拥有（灵魂契合 picks）且仍有库存的局前暗选卡；remaining 为组合聚合库存
export function getPlayerPreGameCards(state, comboLabel, playerId) {
  const inventory = state?.treasury?.[comboLabel]?.inventory || {}
  const owned = new Set()
  for (const roundBond of Object.values(state?.soulBond || {})) {
    for (const pick of roundBond?.[comboLabel]?.picks || []) {
      if (pick.playerId === playerId && PRE_GAME_CARDS.includes(pick.cardId)) owned.add(pick.cardId)
    }
  }
  return [...owned].map(cardId => ({
    cardId,
    name: TREASURY_CARDS[cardId]?.name || cardId,
    effect: TREASURY_CARDS[cardId]?.effect || '',
    remaining: Number(inventory[cardId] || 0)
  }))
}

// 选奖时的阶层上限：天选视同已解锁第三阶
export function getTierCap(unlockTier) {
  if (unlockTier === 'chosen') return 3
  return Number(unlockTier) || 0
}

// 激活记录展示态（兼容旧 anytime 与新 post_game）
export function activationState(activation) {
  if (activation.timing === 'pre_game') {
    if (activation.consumed) return '已消耗'
    return activation.revealed ? '已亮出' : '待亮出'
  }
  // post_game / 旧 anytime：局后记录即已使用
  return '已使用'
}

// 激活记录展示文案（G{局号} + 可选选手名 + 卡名）
export function activationLabel(activation, playerName = (id) => id) {
  const card = TREASURY_CARDS[activation.cardId]
  const game = activation.gameNo ? `G${activation.gameNo} ` : ''
  const player = activation.timing === 'pre_game' && activation.playerId ? `${playerName(activation.playerId)}·` : ''
  return `${game}${player}${card?.name || activation.cardId || '不使用'}`
}
