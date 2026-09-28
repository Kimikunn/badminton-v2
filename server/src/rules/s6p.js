/**
 * s6p.js — S6+ 延长赛（2026-09-28 由 S7-王权之续更名并按更新说明调整规则）
 *
 * 语义 = S6（王权之争）的赛季延长赛：2 轮星尘赛（每轮 1 场 2v2、PA7），
 * 种子 A-D 由来源 S6 赛季的最终排名映射（缺省退化为选手 ID 排序）。
 * 灵魂契合与暗选机制不变；新增：
 * - 奇招：每轮灵魂契合前一个 1-6 幸运数（建季时生成并持久化）；灵魂投掷
 *   计分值命中该数者可二选一——重掷一次（新值替换原值）或该组合总点数 +1；
 *   选择须在该轮选奖前完成
 * - 重置骰子：来源 S6 前两名的组合选手每人整季一次重掷本人灵魂投掷
 *   （REROLL_SOURCES = ['reset_dice']，不占奖励选择次数）
 * - 王之宝库第二阶调整：移除高级暂停卡，新增 月白（对方本局获胜需净胜 2 分）
 *   与 绯红（15 分后启用方得分每球 2 分）
 * - 天选开局分：每局 1:0（原 S6 为 2:0）
 * - 冠军：三轮总星尘最高者夺冠；同星尘看最后一把净胜分，再同看倒数第二把
 *
 * 数据键 comeback_data.s6p（动作 s6p_soul_roll / s6p_soul_pick / s6p_reforge /
 * s6p_card_activate / s6p_card_use / s6p_storage_record / s6p_rift /
 * s6p_lucky_choice / s6p_reset_roll 复用 s6p_soul_roll 重投路径）
 */
const standardRule = require('./standard');
const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { RULE_ID, SCORING_MODE, MATCH_STATUS, WINNER_SIDE } = require('../constants');
const cardFlow = require('./comboCardFlow');

const COMBO_ROUND_MIN = 1;
const COMBO_ROUND_MAX = 3;
const COMBO_LABELS_BY_ROUND = {
  1: ['AB', 'CD'],
  2: ['AC', 'BD'],
  3: ['AD', 'BC']
};
// 重置骰子（reset_dice）：来源 S6 前两名组合的选手，整季各一次重掷本人灵魂投掷
// 重置骰子：来源 S6 前两名组合的选手可整季重掷一次本人灵魂投掷
const REROLL_SOURCES = ['reset_dice'];

// 切片三：启用条件分组。局前暗选卡在局 pending 时提交；随时卡仅记录使用。
const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast', 'yuebai', 'feihong'];
const BLAST_TARGET_SCORE = 11;
// 爆破每球 2 分且无加分：从偶数分可能越过 11 直接到 12，故封顶 12
const BLAST_MAX_SCORE = 12;

// 天选开局分：S6+ 每局 1:0（更新说明：7 局比赛每局 1 分开局）
const CHOSEN_OPENING = 1;

// 重置骰子持有者：来源 S6 赛季前两名组合的选手（建季时写入 s6p.resetDice）
function getResetDiceHolders(data) {
  return Array.isArray(data?.s6p?.resetDice) ? data.s6p.resetDice : [];
}

// 奇招幸运数：每轮一个 1-6，建季时生成（s6p.lucky = { 1: n, 2: n }）；
// 缺失时懒生成并写回（覆盖旧数据/手工建季场景）。
function ensureLuckyNumbers(s6p) {
  if (!s6p.lucky) s6p.lucky = {};
  for (let roundNo = COMBO_ROUND_MIN; roundNo <= COMBO_ROUND_MAX; roundNo += 1) {
    if (!Number.isInteger(s6p.lucky[String(roundNo)])) {
      s6p.lucky[String(roundNo)] = 1 + Math.floor(Math.random() * 6);
    }
  }
  return s6p.lucky;
}


function getS6PData(ctx) {
  return parseJson(ctx.season?.comeback_data, {}).s6p || {};
}

// S6+ 无王选：恒 null（月白宝库卡为局前净胜规则，非上篇抵抗局）
function getTopKing(ctx) {
  return null;
}


// 下篇局状态：两个组合的 treasury 与本场的存储器 carry；非下篇轮次返回 null
function getComboPhaseState(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const s6p = getS6PData(ctx);
  const labels = COMBO_LABELS_BY_ROUND[roundNo];
  return {
    labels,
    treasuryA: s6p.treasury?.[labels[0]] || null,
    treasuryB: s6p.treasury?.[labels[1]] || null,
    carry: s6p.storageCarry?.[ctx.match?.id] || null
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
    const shared = cardFlow.getComboOpening(getS6PData(ctx), combo.labels, ctx.match, CHOSEN_OPENING);
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
  const effects = config.activeEffects;

  // 月白局：被作用方获胜须在赛点后连拿两分（覆盖基础口径的赛点即胜）
  if (effects?.yuebai === WINNER_SIDE.A || effects?.yuebai === WINNER_SIDE.B) {
    const yuebaiCheck = cardFlow.validateYuebaiMargin(effects, input, config);
    if (yuebaiCheck) return yuebaiCheck;
    const scoreA = Number(input.scoreA || 0);
    const scoreB = Number(input.scoreB || 0);
    const winner = scoreA > scoreB ? WINNER_SIDE.A : WINNER_SIDE.B;
    if (winner === effects.yuebai) return { canEnd: true, winner, reason: '' };
  }

  if (effects?.blast) return cardFlow.validateBlastGame(config, input);
  return standardRule.validateGameEnd({ ...ctx, gameConfig: config }, input);
}

function onGameStarted(ctx) {
  const opening = getOpeningScore(ctx);

  // 存储器 carry 为一次性：局开始应用后从 comeback_data 清除
  const combo = getComboPhaseState(ctx);
  if (combo?.carry && ctx.season?.id && ctx.match?.id) {
    const data = parseJson(ctx.season.comeback_data, {});
    if (data.s6p?.storageCarry) {
      delete data.s6p.storageCarry[ctx.match.id];
      prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(stringifyJson(data), ctx.season.id);
    }
  }

  if (!opening.openingScoreA && !opening.openingScoreB) return null;
  return { scoreA: opening.openingScoreA, scoreB: opening.openingScoreB };
}

function normalizeS6PState(s6p = {}) {
  return {
    ...s6p,
    soulBond: s6p.soulBond || {},
    treasury: s6p.treasury || {},
    storageCarry: s6p.storageCarry || {}
  };
}

function findRound(seasonId, roundNo) {
  return prepare('SELECT * FROM rounds WHERE season_id = ? AND round_no = ?').get(seasonId, roundNo);
}

function recordSeasonAction(ctx, actionId, input) {
  if (actionId === 's6p_soul_roll') return recordSoulRoll(ctx, input);
  if (actionId === 's6p_reset_roll') return recordSoulRoll(ctx, input);
  if (actionId === 's6p_lucky_choice') return recordLuckyChoice(ctx, input);
  if (actionId === 's6p_soul_pick') return recordSoulPick(ctx, input);
  if (actionId === 's6p_reforge') return recordReforge(ctx, input);
  if (actionId === 's6p_card_activate') return recordCardActivate(ctx, input);
  if (actionId === 's6p_card_use') return recordCardUse(ctx, input);
  if (actionId === 's6p_storage_record') return recordStorageRecord(ctx, input);
  if (actionId === 's6p_rift') return recordRift(ctx, input);
  return { validationError: 'S6+ 延长赛不支持该操作' };
}

// ---- 切片二：灵魂契合 ----

function isSeedsComplete(seeds) {
  return Boolean(seeds?.A && seeds?.B && seeds?.C && seeds?.D);
}

// 种子推导：优先读 comeback_data.s6p.seeds，缺省时按选手 ID 排序
// （与 S4 服务端 getS4ComboPairing 的口径一致；上篇排名由客户端计算）。
function deriveSeeds(ctx, s6p) {
  if (isSeedsComplete(s6p.seeds)) return s6p.seeds;
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

function finalizeComboBond(combo, luckyBonus = 0) {
  const [first, second] = combo.rolls;
  let total = first.used + second.used;
  if (first.used === second.used) total += 1;
  total += Number(luckyBonus || 0);
  combo.total = total;
  combo.unlockTier = getUnlockTier(total);
  combo.chosenGranted = combo.unlockTier === 'chosen';
}


function syncTreasuryChosen(s6p, comboLabel, combo) {
  const treasury = cardFlow.ensureTreasury(s6p, comboLabel);
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
  // 重置骰子：来源 S6 前两名组合的选手整季 1 次（reset_dice）
  if (source === 'reset_dice') return getResetDiceHolders(ctx.data).includes(playerId) ? 1 : 0;
  return 0;
}

function getUsedRerolls(s6p, playerId, source) {
  let used = 0;
  for (const roundBond of Object.values(s6p.soulBond || {})) {
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

// 校验轮次/组合/选手，返回 { error } 或 { s6p, combo, roundKey, comboLabel, playerId }
function resolveComboContext(ctx, input) {
  const roundNo = Number(input.roundNo);
  const roundError = validateComboRound(ctx, roundNo);
  if (roundError) return { error: roundError };

  const comboLabel = String(input.comboLabel || '').trim();
  if (!COMBO_LABELS_BY_ROUND[roundNo].includes(comboLabel)) {
    return { error: '无效的组合标识' };
  }

  const data = ctx.data || {};
  const s6p = normalizeS6PState(data.s6p || {});
  s6p.seeds = deriveSeeds(ctx, s6p);

  const playerId = String(input.playerId || '').trim();
  if (!getComboPlayerIds(s6p.seeds, comboLabel).includes(playerId)) {
    return { error: '该选手不属于此组合' };
  }

  const roundKey = String(roundNo);
  const roundBond = s6p.soulBond[roundKey] || {};
  s6p.soulBond[roundKey] = roundBond;
  const combo = roundBond[comboLabel] || { rolls: [], picks: [], rerollsUsed: [] };
  roundBond[comboLabel] = combo;

  return { data, s6p, combo, comboLabel, playerId, roundKey };
}

function recordSoulRoll(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6p, combo, comboLabel, playerId, roundKey } = resolved;

  const rollChoice = Number(input.rollChoice);
  if (rollChoice !== 1 && rollChoice !== 2) return { validationError: '投掷次数必须为 1 或 2' };
  const dice = Array.isArray(input.dice) ? input.dice.map(Number) : null;
  if (!dice || dice.length !== rollChoice) return { validationError: '骰子数量必须与投掷次数一致' };
  if (dice.some(value => !Number.isInteger(value) || value < 1 || value > 6)) {
    return { validationError: '骰子点数必须是 1-6 的整数' };
  }

  ensureLuckyNumbers(s6p);

  const existing = combo.rolls.find(roll => roll.playerId === playerId);
  const rerollSource = input.rerollSource ? String(input.rerollSource) : null;

  if (rerollSource) {
    if (!existing) return { validationError: '该选手尚未投掷，无法重投' };
    if (!REROLL_SOURCES.includes(rerollSource)) return { validationError: '无效的重投来源' };
    if (combo.picks.length > 0) return { validationError: '奖励选择完成后无法重投' };
    const remaining = getRerollEntitlement(ctx, playerId, rerollSource)
      - getUsedRerolls(s6p, playerId, rerollSource);
    if (remaining <= 0) return { validationError: '该选手没有可用的重投次数' };
    existing.rollChoice = rollChoice;
    existing.dice = dice;
    existing.used = dice[rollChoice - 1];
    combo.rerollsUsed.push({ playerId, source: rerollSource });
  } else {
    // 首次投掷：计分值命中本轮幸运数 → 标记奇招命中（重掷不重复触发）
    if (existing) return { validationError: '该选手已完成灵魂投掷，如需重投请使用重投次数' };
    if (combo.rolls.length >= 2) return { validationError: '该组合双方均已完成投掷' };
    combo.rolls.push({ playerId, rollChoice, dice, used: dice[rollChoice - 1] });
    const roll = combo.rolls[combo.rolls.length - 1];
    if (roll.used === s6p.lucky[String(roundKey)]) roll.luckyHit = true;
  }

  if (combo.rolls.length === 2) {
    finalizeComboBond(combo, getLuckyBonus(s6p, roundKey, comboLabel));
    syncTreasuryChosen(s6p, comboLabel, combo);
  }

  return { nextData: { ...data, s6p } };
}

// 幸运加成：该轮该组合已选择的「总点数 +1」次数
function getLuckyBonus(s6p, roundKey, comboLabel) {
  return Number(s6p?.luckyBonus?.[String(roundKey)]?.[comboLabel] || 0);
}

// s6p_lucky_choice：奇招二选一（重掷一次 / 总点数 +1）。
// 重掷：提交 1-6 新值替换本人计分值（rollChoice 固定为 1）；不占奖励选择次数。
function recordLuckyChoice(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6p, combo, comboLabel, playerId, roundKey } = resolved;

  const roll = combo.rolls.find(entry => entry.playerId === playerId);
  if (!roll) return { validationError: '该选手尚未投掷，无法使用奇招' };
  if (!roll.luckyHit) return { validationError: '本轮幸运数未被命中，无奇招奖励' };
  if (roll.luckyChoice) return { validationError: '该选手已完成奇招选择' };
  if (combo.picks.length > 0) return { validationError: '奖励选择开始后无法再进行奇招选择' };

  const choice = String(input.choice || '').trim();
  if (choice === 'reroll') {
    const dice = Number(input.dice);
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
      return { validationError: '骰子点数必须是 1-6 的整数' };
    }
    roll.rollChoice = 1;
    roll.dice = [dice];
    roll.used = dice;
    roll.luckyRerolled = true;
  } else if (choice === 'plus1') {
    s6p.luckyBonus = s6p.luckyBonus || {};
    s6p.luckyBonus[roundKey] = s6p.luckyBonus[roundKey] || {};
    s6p.luckyBonus[roundKey][comboLabel] = (s6p.luckyBonus[roundKey][comboLabel] || 0) + 1;
  } else {
    return { validationError: '无效的奇招选择' };
  }
  roll.luckyChoice = choice;

  if (combo.rolls.length === 2) {
    finalizeComboBond(combo, getLuckyBonus(s6p, roundKey, comboLabel));
    syncTreasuryChosen(s6p, comboLabel, combo);
  }

  return { nextData: { ...data, s6p } };
}

function recordSoulPick(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6p, combo, comboLabel, playerId } = resolved;

  if (combo.rolls.length !== 2) return { validationError: '请先完成该组合的灵魂契合掷骰' };
  if (combo.rolls.some(roll => roll.luckyHit && !roll.luckyChoice)) {
    return { validationError: '奇招选择未完成，无法选择奖励' };
  }
  if (combo.unlockTier === null || combo.unlockTier === undefined) {
    return { validationError: '该组合未解锁任何宝库奖励' };
  }

  const cardId = String(input.cardId || '').trim();
  const card = cardFlow.TREASURY_CARDS[cardId];
  if (!card) return { validationError: '无效的宝库奖励' };
  if (card.rules && !card.rules.includes(ctx.season?.rule_id)) {
    return { validationError: '该奖励不适用于本赛季' };
  }
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

  const treasury = cardFlow.ensureTreasury(s6p, comboLabel);
  treasury.inventory[cardId] = (treasury.inventory[cardId] || 0) + card.uses;

  return { nextData: { ...data, s6p } };
}

function recordReforge(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6p, combo, comboLabel, playerId } = resolved;

  if (combo.rolls.length !== 2) return { validationError: '请先完成该组合的灵魂契合掷骰' };
  if (combo.rolls.some(roll => roll.luckyHit && !roll.luckyChoice)) {
    return { validationError: '奇招选择未完成，无法重铸' };
  }
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
  finalizeComboBond(combo, getLuckyBonus(s6p, roundKey, comboLabel));
  syncTreasuryChosen(s6p, comboLabel, combo);

  return { nextData: { ...data, s6p } };
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
  const bond = parseJson(season?.comeback_data, {}).s6p?.soulBond?.[String(roundNo)] || {};
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

// s6p_card_activate：局前暗选逐人提交（共享生命周期，门控见 canStartGame）
function recordCardActivate(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6p = normalizeS6PState(data.s6p || {});
  const result = cardFlow.recordCardActivate(ctx, s6p, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S6PCA'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6p } };
}

// s6p_card_use：随时卡 **局后记录**——该局结束后按方补记使用次数（带 gameNo）。
function recordCardUse(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6p = normalizeS6PState(data.s6p || {});
  const result = cardFlow.recordPostGameUse(ctx, s6p, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S6PCU'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6p } };
}

// s6p_storage_record：存储器局后记录启用方额外球得分（共享口径）。
function recordStorageRecord(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6p = normalizeS6PState(data.s6p || {});
  const result = cardFlow.recordStorageRecord(ctx, s6p, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6p } };
}

// s6p_rift：时空裂隙执行回溯（共享实现）。
function recordRift(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6p = normalizeS6PState(data.s6p || {});
  const result = cardFlow.recordRift(ctx, s6p, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6p } };
}

// 局前记录硬门控：第 1-3 轮每局开始前需录入选手完成局前暗选（含「不使用」）。
function canStartGame(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const match = ctx.match;
  const gameNo = Number(ctx.game?.game_no);
  return cardFlow.preGameGateError(getS6PData(ctx), COMBO_LABELS_BY_ROUND[roundNo], match, gameNo);
}

module.exports = {
  id: RULE_ID.S6P,
  getGameConfig,
  validateGameEnd,
  onGameStarted,
  canStartGame,
  recordSeasonAction,
  isSoulBondCompleteForRound,
  ensureLuckyNumbers,
  TREASURY_CARDS: cardFlow.TREASURY_CARDS
};
