/**
 * s7.js — S7-王权之续（2026-09-28 新增赛季类型）
 *
 * 语义 = S6 下半赛季（组合赛阶段）独立成季：3 轮固定轮换组合赛（每轮 1 场
 * 2v2、PA7），灵魂契合（掷骰/同点 +1/三阶+天选选奖）+ 王之宝库（局前暗选/
 * 随时卡/存储器/时空裂隙/爆破/星尘卡）+ 组合星尘结算。
 * 无上篇/王选/王权/凯旋重投；无月白抵抗与黛青/绯红开局。
 *
 * 实现方式：以 s7.js 为底本 copy-adapt（用户拍板「复用规则内容」）：
 * - 组合轮 = 第 1-3 轮（S6 为 5-7 轮）；轮换 AB/CD、AC/BD、AD/BC 平移不变
 * - 数据键 comeback_data.s7（动作 s7_soul_roll / s7_soul_pick / s7_reforge /
 *   s7_card_activate / s7_card_use / s7_storage_record / s7_rift）
 * - 种子 A-D：缺省按选手 ID 排序，首次灵魂投掷时持久化（与 S6 下篇缺省口径一致）
 * - 重投来源为空（REROLL_SOURCES = []）：无上篇故无凯旋，不跨季取 S5 碎片
 * - 王形态/王权/天选以外开局加成等上篇机制整体不存在（getTopKing 恒 null）
 */
const standardRule = require('./standard');
const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { RULE_ID, SCORING_MODE, MATCH_STATUS } = require('../constants');
const cardFlow = require('./comboCardFlow');

const COMBO_ROUND_MIN = 1;
const COMBO_ROUND_MAX = 3;
const COMBO_LABELS_BY_ROUND = {
  1: ['AB', 'CD'],
  2: ['AC', 'BD'],
  3: ['AD', 'BC']
};
// S7 独立成季：无上篇凯旋、不跨季取 S5 碎片，重投来源为空（骨架保留校验）
const REROLL_SOURCES = [];

// 切片三：启用条件分组。局前暗选卡在局 pending 时提交；随时卡仅记录使用。
const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast'];
const BLAST_TARGET_SCORE = 11;
// 爆破每球 2 分且无加分：从偶数分可能越过 11 直接到 12，故封顶 12
const BLAST_MAX_SCORE = 12;


function getS7Data(ctx) {
  return parseJson(ctx.season?.comeback_data, {}).s7 || {};
}

// S7 无王选：恒 null（月白抵抗/黛青开局等上篇机制随之不触发）
function getTopKing(ctx) {
  return null;
}


// 下篇局状态：两个组合的 treasury 与本场的存储器 carry；非下篇轮次返回 null
function getComboPhaseState(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const s7 = getS7Data(ctx);
  const labels = COMBO_LABELS_BY_ROUND[roundNo];
  return {
    labels,
    treasuryA: s7.treasury?.[labels[0]] || null,
    treasuryB: s7.treasury?.[labels[1]] || null,
    carry: s7.storageCarry?.[ctx.match?.id] || null
  };
}

function getOpeningScore(ctx) {
  const king = getTopKing(ctx);
  const opening = {
    openingScoreA: 0,
    openingScoreB: 0,
    kingId: king?.kingId || null,
    kingForm: king?.form || null
  };

  // 上篇黛青：王所在方每局 +2
  if (king?.form === 'daiqing') {
    const teamA = parseJson(ctx.match?.team_a, []);
    const teamB = parseJson(ctx.match?.team_b, []);
    if (teamA.includes(king.kingId)) opening.openingScoreA += 2;
    else if (teamB.includes(king.kingId)) opening.openingScoreB += 2;
  }

  // 组合阶段：天选每局 +2；存储器 carry 一次性带入——共享口径
  const combo = getComboPhaseState(ctx);
  if (combo) {
    const shared = cardFlow.getComboOpening(getS7Data(ctx), combo.labels, ctx.match);
    opening.openingScoreA += shared.openingScoreA;
    opening.openingScoreB += shared.openingScoreB;
  }

  return opening;
}

function getGameConfig(ctx) {
  const opening = getOpeningScore(ctx);
  const activeEffects = cardFlow.getActiveEffects(ctx.game, getComboPhaseState(ctx));
  const blast = activeEffects.blast !== null;
  return {
    scoringMode: SCORING_MODE.STANDARD,
    targetScore: blast ? BLAST_TARGET_SCORE : 21,
    maxScore: blast ? BLAST_MAX_SCORE : 30,
    requiresWinner: false,
    supportsPierce: false,
    openingScoreA: opening.openingScoreA,
    openingScoreB: opening.openingScoreB,
    kingId: opening.kingId,
    kingForm: opening.kingForm,
    activeEffects
  };
}

function validateGameEnd(ctx, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  if (config.activeEffects?.blast) return cardFlow.validateBlastGame(config, input);
  return standardRule.validateGameEnd({ ...ctx, gameConfig: config }, input);
}

function onGameStarted(ctx) {
  const opening = getOpeningScore(ctx);

  // 存储器 carry 为一次性：局开始应用后从 comeback_data 清除
  const combo = getComboPhaseState(ctx);
  if (combo?.carry && ctx.season?.id && ctx.match?.id) {
    const data = parseJson(ctx.season.comeback_data, {});
    if (data.s7?.storageCarry) {
      delete data.s7.storageCarry[ctx.match.id];
      prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(stringifyJson(data), ctx.season.id);
    }
  }

  if (!opening.openingScoreA && !opening.openingScoreB) return null;
  return { scoreA: opening.openingScoreA, scoreB: opening.openingScoreB };
}

function normalizeS7State(s7 = {}) {
  return {
    ...s7,
    soulBond: s7.soulBond || {},
    treasury: s7.treasury || {},
    storageCarry: s7.storageCarry || {}
  };
}

function findRound(seasonId, roundNo) {
  return prepare('SELECT * FROM rounds WHERE season_id = ? AND round_no = ?').get(seasonId, roundNo);
}

function recordSeasonAction(ctx, actionId, input) {
  if (actionId === 's7_soul_roll') return recordSoulRoll(ctx, input);
  if (actionId === 's7_soul_pick') return recordSoulPick(ctx, input);
  if (actionId === 's7_reforge') return recordReforge(ctx, input);
  if (actionId === 's7_card_activate') return recordCardActivate(ctx, input);
  if (actionId === 's7_card_use') return recordCardUse(ctx, input);
  if (actionId === 's7_storage_record') return recordStorageRecord(ctx, input);
  if (actionId === 's7_rift') return recordRift(ctx, input);
  return { validationError: '第七赛季不支持该操作' };
}

// ---- 切片二：灵魂契合 ----

function isSeedsComplete(seeds) {
  return Boolean(seeds?.A && seeds?.B && seeds?.C && seeds?.D);
}

// 种子推导：优先读 comeback_data.s7.seeds，缺省时按选手 ID 排序
// （与 S4 服务端 getS4ComboPairing 的口径一致；上篇排名由客户端计算）。
function deriveSeeds(ctx, s7) {
  if (isSeedsComplete(s7.seeds)) return s7.seeds;
  const sorted = [...parseJson(ctx.season?.participants, [])].sort();
  return { A: sorted[0], B: sorted[1], C: sorted[2], D: sorted[3] };
}

function getComboPlayerIds(seeds, comboLabel) {
  return String(comboLabel).split('').map(key => seeds[key]);
}

function getUnlockTier(total) {
  if (total === 13) return 'chosen';
  if (total >= 10) return 3;
  if (total >= 7) return 2;
  if (total >= 3) return 1;
  return null;
}

// 选奖时的阶层上限：天选视同已解锁第三阶
function getTierCap(unlockTier) {
  if (unlockTier === 'chosen') return 3;
  return Number(unlockTier) || 0;
}

function finalizeComboBond(combo) {
  const [first, second] = combo.rolls;
  let total = first.used + second.used;
  if (first.used === second.used) total += 1;
  combo.total = total;
  combo.unlockTier = getUnlockTier(total);
  combo.chosenGranted = combo.unlockTier === 'chosen';
}


function syncTreasuryChosen(s7, comboLabel, combo) {
  const treasury = cardFlow.ensureTreasury(s7, comboLabel);
  treasury.chosen = combo.chosenGranted === true;
}

// 每位选手可选次数：同点时后投者（rolls 中后提交的一方）多选 1 次
function getAllowedPicks(combo, playerId) {
  const [first, second] = combo.rolls;
  if (first.used === second.used && second.playerId === playerId) return 2;
  return 1;
}

function countPlayerPicks(combo, playerId) {
  return (combo.picks || []).filter(pick => pick.playerId === playerId).length;
}

function getRerollEntitlement(ctx, playerId, source) {
  // S7 无重投来源（REROLL_SOURCES 为空）：保留校验骨架，恒 0
  return 0;
}

function getUsedRerolls(s7, playerId, source) {
  let used = 0;
  for (const roundBond of Object.values(s7.soulBond || {})) {
    for (const combo of Object.values(roundBond || {})) {
      used += (combo.rerollsUsed || [])
        .filter(entry => entry.playerId === playerId && entry.source === source).length;
    }
  }
  return used;
}

function validateComboRound(ctx, roundNo) {
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) {
    return '灵魂契合仅适用于第 1-3 轮';
  }
  if (findRound(ctx.season?.id, roundNo)) return '该轮已创建，无法再进行灵魂契合';
  return null;
}

// 校验轮次/组合/选手，返回 { error } 或 { s7, combo, roundKey, comboLabel, playerId }
function resolveComboContext(ctx, input) {
  const roundNo = Number(input.roundNo);
  const roundError = validateComboRound(ctx, roundNo);
  if (roundError) return { error: roundError };

  const comboLabel = String(input.comboLabel || '').trim();
  if (!COMBO_LABELS_BY_ROUND[roundNo].includes(comboLabel)) {
    return { error: '无效的组合标识' };
  }

  const data = ctx.data || {};
  const s7 = normalizeS7State(data.s7 || {});
  s7.seeds = deriveSeeds(ctx, s7);

  const playerId = String(input.playerId || '').trim();
  if (!getComboPlayerIds(s7.seeds, comboLabel).includes(playerId)) {
    return { error: '该选手不属于此组合' };
  }

  const roundKey = String(roundNo);
  const roundBond = s7.soulBond[roundKey] || {};
  s7.soulBond[roundKey] = roundBond;
  const combo = roundBond[comboLabel] || { rolls: [], picks: [], rerollsUsed: [] };
  roundBond[comboLabel] = combo;

  return { data, s7, combo, comboLabel, playerId };
}

function recordSoulRoll(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s7, combo, comboLabel, playerId } = resolved;

  const rollChoice = Number(input.rollChoice);
  if (rollChoice !== 1 && rollChoice !== 2) return { validationError: '投掷次数必须为 1 或 2' };
  const dice = Array.isArray(input.dice) ? input.dice.map(Number) : null;
  if (!dice || dice.length !== rollChoice) return { validationError: '骰子数量必须与投掷次数一致' };
  if (dice.some(value => !Number.isInteger(value) || value < 1 || value > 6)) {
    return { validationError: '骰子点数必须是 1-6 的整数' };
  }

  const existing = combo.rolls.find(roll => roll.playerId === playerId);
  const rerollSource = input.rerollSource ? String(input.rerollSource) : null;

  if (rerollSource) {
    if (!existing) return { validationError: '该选手尚未投掷，无法重投' };
    if (!REROLL_SOURCES.includes(rerollSource)) return { validationError: '无效的重投来源' };
    if (combo.picks.length > 0) return { validationError: '奖励选择完成后无法重投' };
    const remaining = getRerollEntitlement(ctx, playerId, rerollSource)
      - getUsedRerolls(s7, playerId, rerollSource);
    if (remaining <= 0) return { validationError: '该选手没有可用的重投次数' };
    existing.rollChoice = rollChoice;
    existing.dice = dice;
    existing.used = dice[rollChoice - 1];
    combo.rerollsUsed.push({ playerId, source: rerollSource });
  } else {
    if (existing) return { validationError: '该选手已完成灵魂投掷，如需重投请使用重投次数' };
    if (combo.rolls.length >= 2) return { validationError: '该组合双方均已完成投掷' };
    combo.rolls.push({ playerId, rollChoice, dice, used: dice[rollChoice - 1] });
  }

  if (combo.rolls.length === 2) {
    finalizeComboBond(combo);
    syncTreasuryChosen(s7, comboLabel, combo);
  }

  return { nextData: { ...data, s7 } };
}

function recordSoulPick(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s7, combo, comboLabel, playerId } = resolved;

  if (combo.rolls.length !== 2) return { validationError: '请先完成该组合的灵魂契合掷骰' };
  if (combo.unlockTier === null || combo.unlockTier === undefined) {
    return { validationError: '该组合未解锁任何宝库奖励' };
  }

  const cardId = String(input.cardId || '').trim();
  const card = cardFlow.TREASURY_CARDS[cardId];
  if (!card) return { validationError: '无效的宝库奖励' };
  if (cardId === 'chosen') return { validationError: '天选达成即自动触发，无需选择' };
  if (cardId === 'reforge') return { validationError: '重铸请使用重铸操作' };
  if (card.tier > getTierCap(combo.unlockTier)) return { validationError: '该奖励尚未解锁' };
  if (combo.picks.some(pick => pick.cardId === cardId)) {
    return { validationError: '同一奖励不可重复选择' };
  }

  const allowed = getAllowedPicks(combo, playerId);
  if (countPlayerPicks(combo, playerId) >= allowed) {
    return { validationError: allowed > 1 ? '该选手最多选择 2 次奖励' : '每人只能选择 1 次奖励' };
  }

  combo.picks.push({ playerId, cardId });

  const treasury = cardFlow.ensureTreasury(s7, comboLabel);
  treasury.inventory[cardId] = (treasury.inventory[cardId] || 0) + card.uses;

  return { nextData: { ...data, s7 } };
}

function recordReforge(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s7, combo, comboLabel, playerId } = resolved;

  if (combo.rolls.length !== 2) return { validationError: '请先完成该组合的灵魂契合掷骰' };
  if (getTierCap(combo.unlockTier) < 2) {
    return { validationError: '重铸需要解锁第二阶奖励（总点数 7-9）' };
  }

  const allowed = getAllowedPicks(combo, playerId);
  if (countPlayerPicks(combo, playerId) >= allowed) {
    return { validationError: '没有可用的奖励选择次数' };
  }

  const dice = Number(input.dice);
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return { validationError: '骰子点数必须是 1-6 的整数' };
  }

  const roll = combo.rolls.find(entry => entry.playerId === playerId);
  roll.used = dice;
  roll.reforged = true;
  combo.picks.push({ playerId, cardId: 'reforge' });
  finalizeComboBond(combo);
  syncTreasuryChosen(s7, comboLabel, combo);

  return { nextData: { ...data, s7 } };
}

// 单个组合的灵魂契合是否完成：双方已投掷；解锁了奖励时每人须选满次数
// （重铸计入选择次数）；未解锁（总点数 2）时无需选奖即视为完成。
function isComboBondComplete(combo) {
  if (!combo || !Array.isArray(combo.rolls) || combo.rolls.length !== 2) return false;
  if (combo.unlockTier === null || combo.unlockTier === undefined) return true;
  return combo.rolls.every(roll =>
    countPlayerPicks(combo, roll.playerId) === getAllowedPicks(combo, roll.playerId));
}

// 创建下篇轮次前校验：该轮两个组合的灵魂契合均已完成（供 seasonRuleLifecycleService 使用）。
function isSoulBondCompleteForRound(season, roundNo) {
  const labels = COMBO_LABELS_BY_ROUND[Number(roundNo)];
  if (!labels) return false;
  const bond = parseJson(season?.comeback_data, {}).s7?.soulBond?.[String(roundNo)] || {};
  return labels.every(label => isComboBondComplete(bond[label]));
}

// ---- 切片三：王之宝库卡片效果执行 ----

// 校验比赛属于本赛季下篇轮次，返回 { error } 或 { match, roundNo }
function resolveTreasuryMatchContext(ctx, matchId) {
  const id = String(matchId || '').trim();
  const match = id ? prepare('SELECT * FROM matches WHERE id = ?').get(id) : null;
  if (!match || match.season_id !== ctx.season?.id) return { error: '比赛不存在' };
  const round = match.round_id ? prepare('SELECT * FROM rounds WHERE id = ?').get(match.round_id) : null;
  const roundNo = Number(round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) {
    return { error: '王之宝库卡片仅适用于第 1-3 轮' };
  }
  return { match, roundNo };
}

// s7_card_activate：局前暗选逐人提交（共享生命周期，门控见 canStartGame）
function recordCardActivate(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s7 = normalizeS7State(data.s7 || {});
  const result = cardFlow.recordCardActivate(ctx, s7, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S7CA'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s7 } };
}

// s7_card_use：随时卡 **局后记录**——该局结束后按方补记使用次数（带 gameNo）。
function recordCardUse(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s7 = normalizeS7State(data.s7 || {});
  const result = cardFlow.recordPostGameUse(ctx, s7, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S7CU'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s7 } };
}

// s7_storage_record：存储器局后记录启用方额外球得分（共享口径）。
function recordStorageRecord(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s7 = normalizeS7State(data.s7 || {});
  const result = cardFlow.recordStorageRecord(ctx, s7, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s7 } };
}

// s7_rift：时空裂隙执行回溯（共享实现）。
function recordRift(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s7 = normalizeS7State(data.s7 || {});
  const result = cardFlow.recordRift(ctx, s7, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s7 } };
}

// 局前记录硬门控：第 1-3 轮每局开始前需 4 名选手完成局前暗选（含「不使用」）。
function canStartGame(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const match = ctx.match;
  const gameNo = Number(ctx.game?.game_no);
  return cardFlow.preGameGateError(getS7Data(ctx), COMBO_LABELS_BY_ROUND[roundNo], match, gameNo);
}

module.exports = {
  id: RULE_ID.S7,
  getGameConfig,
  validateGameEnd,
  onGameStarted,
  canStartGame,
  recordSeasonAction,
  isSoulBondCompleteForRound,
  TREASURY_CARDS: cardFlow.TREASURY_CARDS
};
