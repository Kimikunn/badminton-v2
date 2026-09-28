/**
 * comboCardFlow.js — S6/S7 共享的道具卡生命周期（2026-09-28 抽取）
 *
 * 设计：道具卡按「录入/结算时机」分两个生命周期，两个规则共用同一套状态机：
 *   - **局前记录（pre_game）**：阻碍/进击/存储器/时空裂隙/星尘卡/爆破。
 *     每局开始前由 4 名选手逐人提交（本人选到的局前卡或「不使用」），
 *     4 人全部提交后同时亮出；提交即扣库存。**局前记录是开局的硬门控**：
 *     该局 4 人未集齐暗选，比赛/下一局不能开始（canStartGame 门控）。
 *   - **局后记录（post_game）**：暂停卡/名刀/高级暂停卡（原「随时卡」）。
 *     实际对局中人工启用，效果线下执行；**在该局结束后补记**使用次数
 *     （每条消耗 1 次库存，带 gameNo 归属该局；该局必须已完赛）。
 *
 * 状态结构（两规则一致，dataKey 不同）：treasury[comboLabel] = {
 *   inventory: { [cardId]: 次数 }, activations: [...], chosen: bool }
 *   activations 条目：{ id, timing: 'pre_game'|'post_game'|'anytime'(旧数据),
 *     matchId, gameId, gameNo, side, playerId?, cardId, revealed, consumed }
 *
 * 约定：本模块函数只操作传入的 state 对象（调用方负责解析/持久化
 * comeback_data 的对应键），轮次边界校验由 s6/s7 的包装层完成。
 */
const { prepare } = require('../config/db');
const { parseJson } = require('../utils/json');
const { MATCH_STATUS, WINNER_SIDE } = require('../constants');

const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast'];
// 原「随时卡」：效果线下执行，改为局后补记（生命周期 2）
const POST_GAME_CARDS = ['pause', 'blade', 'pause_plus'];
const BLAST_TARGET_SCORE = 11;
// 爆破每球 2 分且无加分：从偶数分可能越过 11 直接到 12，故封顶 12
const BLAST_MAX_SCORE = 12;

// 王之宝库卡片目录（uses 为每张卡的库存次数，reforge/chosen 不进库存）
const TREASURY_CARDS = {
  pause: { name: '暂停卡', tier: 1, uses: 3 },
  blade: { name: '名刀', tier: 1, uses: 3 },
  block: { name: '阻碍', tier: 1, uses: 1 },
  charge: { name: '进击', tier: 1, uses: 1 },
  pause_plus: { name: '高级暂停卡', tier: 2, uses: 3 },
  reforge: { name: '重铸', tier: 2, uses: 0 },
  storage: { name: '存储器', tier: 2, uses: 2 },
  rift: { name: '时空裂隙', tier: 3, uses: 1 },
  stardust: { name: '星尘卡', tier: 3, uses: 1 },
  blast: { name: '爆破', tier: 3, uses: 2 },
  chosen: { name: '天选', tier: 'chosen', uses: 0 }
};

function normalizeState(state = {}) {
  return {
    ...state,
    soulBond: state.soulBond || {},
    treasury: state.treasury || {},
    storageCarry: state.storageCarry || {}
  };
}

// 宝库结构：inventory 为库存次数，activations 由局前/局后记录写入；chosen 标记天选已触发。
function ensureTreasury(state, comboLabel) {
  const treasury = state.treasury[comboLabel] || {};
  treasury.inventory = treasury.inventory || {};
  treasury.activations = Array.isArray(treasury.activations) ? treasury.activations : [];
  state.treasury[comboLabel] = treasury;
  return treasury;
}

function getMatchGame(matchId, gameNo) {
  return prepare('SELECT * FROM games WHERE match_id = ? AND game_no = ?').get(matchId, gameNo);
}

// side ↔ 组合：组合轮固定 teamA=该轮第一组合标签、teamB=第二组合标签
function getComboLabelForSide(labels, side) {
  if (!labels) return null;
  if (side === WINNER_SIDE.A) return labels[0];
  if (side === WINNER_SIDE.B) return labels[1];
  return null;
}

// 某场某局已提交的全部局前暗选记录（两个组合的 treasury 都扫描）
function findPreGameActivations(state, labels, matchId, gameNo) {
  const entries = [];
  for (const label of labels || []) {
    for (const entry of state.treasury?.[label]?.activations || []) {
      if (entry.timing === 'pre_game' && entry.matchId === matchId && entry.gameNo === gameNo) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

// 卡片归属：选手本人在灵魂契合中选到的卡（该组合任一轮次的 picks 中有
// playerId+cardId 记录；组合标签由种子固定，跨轮次不变）
function playerOwnsCard(state, comboLabel, playerId, cardId) {
  for (const roundBond of Object.values(state.soulBond || {})) {
    const picks = roundBond?.[comboLabel]?.picks || [];
    if (picks.some(pick => pick.playerId === playerId && pick.cardId === cardId)) return true;
  }
  return false;
}

// ── 局前门控：该局 4 名选手（teamA+teamB）是否已全部提交局前暗选 ──
function isPreGameComplete(state, labels, match, gameNo) {
  if (!labels || !match || !Number.isInteger(gameNo)) return false;
  const players = [
    ...parseJson(match.team_a, []).map(playerId => ({ playerId })),
    ...parseJson(match.team_b, []).map(playerId => ({ playerId }))
  ];
  if (!players.length) return false;
  const submitted = new Set(
    findPreGameActivations(state, labels, match.id, gameNo).map(entry => entry.playerId)
  );
  return players.every(({ playerId }) => submitted.has(playerId));
}

// 开局门控文案（s6/s7 canStartGame 用）：未集齐时返回错误文案，集齐/非组合轮返回 null
function preGameGateError(state, labels, match, gameNo) {
  if (!labels) return null;
  if (isPreGameComplete(state, labels, match, gameNo)) return null;
  return `第 ${gameNo} 局开始前需 4 名选手完成局前暗选（含「不使用」）`;
}

// ── 局前暗选提交（s6_card_activate / s7_card_activate 共享）──
// side 由选手所在比赛队伍推导；该场 4 名选手全部提交后所有记录同时亮出。
function recordCardActivate(ctx, state, { match, roundNo, labels, input, idPrefix }) {
  const playerId = String(input.playerId || '').trim();
  const teamA = parseJson(match.team_a, []);
  const teamB = parseJson(match.team_b, []);
  let side = null;
  if (teamA.includes(playerId)) side = WINNER_SIDE.A;
  else if (teamB.includes(playerId)) side = WINNER_SIDE.B;
  if (!side) return { validationError: '该选手不属于此比赛' };
  const comboLabel = getComboLabelForSide(labels, side);

  const gameNo = Number(input.gameNo);
  if (!Number.isInteger(gameNo) || gameNo < 1 || gameNo > (match.best_of || 7)) {
    return { validationError: '无效的局号' };
  }

  const game = getMatchGame(match.id, gameNo);
  if (game && game.status !== MATCH_STATUS.PENDING) {
    return { validationError: '该局已开始，无法再进行暗选' };
  }

  const submitted = findPreGameActivations(state, labels, match.id, gameNo);
  if (submitted.some(entry => entry.playerId === playerId)) {
    return { validationError: '该选手本局已提交暗选' };
  }

  const treasury = ensureTreasury(state, comboLabel);
  const cardId = input.cardId === null || input.cardId === undefined ? null : String(input.cardId).trim();
  if (cardId) {
    if (!TREASURY_CARDS[cardId]) return { validationError: '无效的宝库卡片' };
    if (!PRE_GAME_CARDS.includes(cardId)) return { validationError: '该卡片无需在局前暗选' };
    if (!playerOwnsCard(state, comboLabel, playerId, cardId)) return { validationError: '该选手未获得此卡' };
    if (Number(treasury.inventory[cardId] || 0) <= 0) return { validationError: '该卡片库存不足' };
    treasury.inventory[cardId] -= 1;
  }

  const entry = {
    id: ctx.helpers.prefixedId(idPrefix),
    timing: 'pre_game',
    matchId: match.id,
    gameId: game?.id || null,
    gameNo,
    side,
    playerId,
    cardId,
    revealed: false,
    consumed: false
  };
  treasury.activations.push(entry);

  // 该场 4 名选手全部提交（含"不使用"）时同时亮出
  const all = findPreGameActivations(state, labels, match.id, gameNo);
  const submittedIds = new Set(all.map(item => item.playerId));
  if ([...teamA, ...teamB].every(pid => submittedIds.has(pid))) {
    for (const item of all) item.revealed = true;
  }

  return {};
}

// ── 局后记录（原 s6_card_use / s7_card_use 共享，语义改为局后结算）──
// 随时卡在实际对局中人工启用；该局结束后按方补记使用次数（每条消耗 1 次库存，
// 带 gameNo 归属该局）。同一局同卡可多次记录（每次消耗 1 次）。
function recordPostGameUse(ctx, state, { match, roundNo, labels, input, idPrefix }) {
  const side = String(input.side || '').trim();
  const comboLabel = getComboLabelForSide(labels, side);
  if (!comboLabel) return { validationError: '无效的比赛方' };

  const gameNo = Number(input.gameNo);
  if (!Number.isInteger(gameNo)) {
    return { validationError: '随时卡在局后结算：需指定使用所在的局号' };
  }
  if (gameNo < 1 || gameNo > (match.best_of || 7)) {
    return { validationError: '无效的局号' };
  }

  const game = getMatchGame(match.id, gameNo);
  if (!game) return { validationError: '该局不存在' };
  if (game.status !== MATCH_STATUS.COMPLETED) {
    return { validationError: '随时卡在局后结算：该局结束后才能记录使用' };
  }

  const cardId = String(input.cardId || '').trim();
  if (!TREASURY_CARDS[cardId]) return { validationError: '无效的宝库卡片' };
  if (!POST_GAME_CARDS.includes(cardId)) return { validationError: '该卡片不是局后结算卡（需在局前暗选启用）' };

  const treasury = ensureTreasury(state, comboLabel);
  if (Number(treasury.inventory[cardId] || 0) <= 0) return { validationError: '该卡片库存不足' };
  treasury.inventory[cardId] -= 1;

  treasury.activations.push({
    id: ctx.helpers.prefixedId(idPrefix),
    timing: 'post_game',
    matchId: match.id,
    gameId: game?.id || null,
    gameNo,
    side,
    cardId,
    revealed: true,
    consumed: true
  });

  return {};
}

// 本局已亮出的暗选效果（客户端提示横幅用）：值为生效方 'a'/'b'/null；
// chosenA/chosenB 为天选是否作用于对应方。仅统计 revealed 的局前暗选。
function getActiveEffects(game, combo) {
  const effects = { blast: null, block: null, charge: null, stardust: null, storage: null, chosenA: false, chosenB: false };
  if (!combo) return effects;
  effects.chosenA = combo.treasuryA?.chosen === true;
  effects.chosenB = combo.treasuryB?.chosen === true;

  const gameNo = Number(game?.game_no);
  const matchId = game?.match_id;
  if (!Number.isInteger(gameNo) || !matchId) return effects;

  for (const treasury of [combo.treasuryA, combo.treasuryB]) {
    for (const entry of treasury?.activations || []) {
      if (entry.timing !== 'pre_game' || !entry.revealed) continue;
      if (entry.matchId !== matchId || entry.gameNo !== gameNo) continue;
      if (Object.prototype.hasOwnProperty.call(effects, entry.cardId)) {
        effects[entry.cardId] = entry.side;
      }
    }
  }
  return effects;
}

// 组合阶段开局加成：天选每局 +2；存储器 carry 一次性带入（多条按方求和）
function getComboOpening(state, labels, match) {
  const opening = { openingScoreA: 0, openingScoreB: 0 };
  if (!labels || !match) return opening;
  const treasuryA = state.treasury?.[labels[0]] || null;
  const treasuryB = state.treasury?.[labels[1]] || null;
  if (treasuryA?.chosen === true) opening.openingScoreA += 2;
  if (treasuryB?.chosen === true) opening.openingScoreB += 2;
  const carry = state.storageCarry?.[match.id] || null;
  const carries = Array.isArray(carry) ? carry : (carry ? [carry] : []);
  for (const item of carries) {
    const points = Number(item.points || 0);
    if (item.side === WINNER_SIDE.A) opening.openingScoreA += points;
    else opening.openingScoreB += points;
  }
  return opening;
}

// 爆破局：每球 2 分、无加分，胜方先到 11 分结束（允许从 10 分一球越过到 12，封顶 12）
function validateBlastGame(config, input) {
  const scoreA = Number(input.scoreA || 0);
  const scoreB = Number(input.scoreB || 0);
  if (scoreA < 0 || scoreB < 0) return { canEnd: false, winner: null, reason: '比分不能为负数' };
  if (scoreA === scoreB) return { canEnd: false, winner: null, reason: '比分不能相等' };

  const winner = scoreA > scoreB ? WINNER_SIDE.A : WINNER_SIDE.B;
  const winnerScore = Math.max(scoreA, scoreB);
  if (winnerScore < config.targetScore) {
    return { canEnd: false, winner: null, reason: `爆破局需先达到${config.targetScore}分` };
  }
  if (winnerScore > config.maxScore) {
    return { canEnd: false, winner: null, reason: `爆破局最高${config.maxScore}分封顶` };
  }
  return { canEnd: true, winner, reason: '' };
}

// 存储器局后记录启用方额外球得分（胜 0-5、负 0-3）。
// 按暗选记录逐条匹配：payload 可带 playerId 精确到本人暗选；缺省时取该方该局
// 最早一条未消费的存储器暗选。下一局已自动进入进行中时直接加到该局比分并立即
// 生效；否则把 { side, points, gameNo } 追加到 storageCarry[matchId] 数组，
// 待 onGameStarted 在局开始时按方求和应用并清除。第七局没有下一局，仅记录得分。
function recordStorageRecord(ctx, state, { match, labels, input }) {
  const side = String(input.side || '').trim();
  const comboLabel = getComboLabelForSide(labels, side);
  if (!comboLabel) return { validationError: '无效的比赛方' };

  const gameNo = Number(input.gameNo);
  if (!Number.isInteger(gameNo) || gameNo < 1 || gameNo > (match.best_of || 7)) {
    return { validationError: '无效的局号' };
  }

  const playerId = input.playerId === null || input.playerId === undefined ? null : String(input.playerId).trim();

  const treasury = ensureTreasury(state, comboLabel);
  const candidates = treasury.activations.filter(entry =>
    entry.timing === 'pre_game' && entry.cardId === 'storage'
    && entry.matchId === match.id && entry.gameNo === gameNo && entry.side === side
    && (!playerId || entry.playerId === playerId));
  const activation = candidates.find(entry => !entry.consumed) || candidates[0];
  if (!activation) return { validationError: '该局没有该方的存储器暗选记录' };
  if (activation.consumed) return { validationError: '该局存储器得分已记录' };

  const game = getMatchGame(match.id, gameNo);
  if (!game || game.status !== MATCH_STATUS.COMPLETED) {
    return { validationError: '该局尚未结束，无法记录存储器得分' };
  }

  const won = game.winner === side;
  const maxPoints = won ? 5 : 3;
  const points = Number(input.points);
  if (!Number.isInteger(points) || points < 0 || points > maxPoints) {
    return { validationError: won ? '获胜方额外球得分必须为 0-5 的整数' : '失败方额外球得分必须为 0-3 的整数' };
  }

  activation.consumed = true;

  const nextGame = getMatchGame(match.id, gameNo + 1);
  if (nextGame?.status === MATCH_STATUS.IN_PROGRESS) {
    if (points > 0) {
      const column = side === WINNER_SIDE.A ? 'score_a' : 'score_b';
      prepare(`UPDATE games SET ${column} = ${column} + ? WHERE id = ?`).run(points, nextGame.id);
    }
  } else if (nextGame) {
    // 同方多次记录向数组追加，应用时按方求和（兼容旧的单对象形态）
    const existing = state.storageCarry[match.id];
    const carries = Array.isArray(existing) ? existing : (existing ? [existing] : []);
    carries.push({ side, points, gameNo });
    state.storageCarry[match.id] = carries;
  }

  return {};
}

// 时空裂隙执行回溯。复用 gameService.revertGame；库存已在暗选时扣减，
// 此处仅将暗选标记为已执行。延迟 require 避免与 gameService 循环引用。
function recordRift(ctx, state, { match, labels, input }) {
  const gamesToRevert = Number(input.games);
  if (gamesToRevert !== 1 && gamesToRevert !== 2) {
    return { validationError: '回溯局数必须为 1 或 2' };
  }

  const matchGames = prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(match.id);
  const finalGame = matchGames.find(g => g.game_no === (match.best_of || 7));
  if (finalGame?.status === MATCH_STATUS.COMPLETED) {
    return { validationError: '第七局结束后无法启用回溯' };
  }

  const playerId = input.playerId === null || input.playerId === undefined ? null : String(input.playerId).trim();
  let activation = null;
  for (const label of labels || []) {
    const found = (state.treasury?.[label]?.activations || []).find(entry =>
      entry.timing === 'pre_game' && entry.cardId === 'rift' && entry.matchId === match.id && !entry.consumed
      && (!playerId || entry.playerId === playerId));
    if (found) {
      activation = found;
      break;
    }
  }
  if (!activation) return { validationError: '该场比赛没有可用的时空裂隙（需先在局前暗选）' };

  if (matchGames.filter(g => g.status === MATCH_STATUS.COMPLETED).length < gamesToRevert) {
    return { validationError: '已完成的局数不足，无法回溯' };
  }

  const { revertGame } = require('../services/gameService');
  for (let i = 0; i < gamesToRevert; i += 1) {
    const completedGames = prepare('SELECT * FROM games WHERE match_id = ? AND status = ? ORDER BY game_no')
      .all(match.id, MATCH_STATUS.COMPLETED);
    const target = completedGames[completedGames.length - 1];
    const result = revertGame(target.id);
    if (result.validationError || result.notFound) {
      return { validationError: result.validationError || result.notFound };
    }
  }

  activation.consumed = true;
  return {};
}

module.exports = {
  TREASURY_CARDS,
  PRE_GAME_CARDS,
  POST_GAME_CARDS,
  BLAST_TARGET_SCORE,
  BLAST_MAX_SCORE,
  normalizeState,
  ensureTreasury,
  getMatchGame,
  getComboLabelForSide,
  findPreGameActivations,
  playerOwnsCard,
  isPreGameComplete,
  preGameGateError,
  recordCardActivate,
  recordPostGameUse,
  getActiveEffects,
  getComboOpening,
  validateBlastGame,
  recordStorageRecord,
  recordRift
};
