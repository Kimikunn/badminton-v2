/**
 * S6 赛季规则插件（切片一：上篇 1-4 轮 王选 + 王形态）
 *
 * 上篇规则：
 * - 标准 21 分制 BO3，局终校验与 standard 一致（含黛青 2:0 开局：终局校验
 *   只看最终比分是否满足目标分/领先 2 分/封顶，与开局分无关，故无需特判）。
 * - 王选一次性完成（上篇开始前、第 1 轮创建前仅允许提交一次）：4 名参赛者
 *   各投一次骰子，按点数从大到小排序决定第 1-4 轮的王；同分者组内重投，
 *   只决定组内顺序、不做全局重排，由客户端裁决后提交最终顺序。经
 *   s6_king_roll 持久化 comeback_data.s6.kingOrder = [{ playerId, dice, rolls? }]
 *   （数组顺序即王序，服务端校验为参赛者排列后按提交顺序存储，不按骰子
 *   重排），并同步写入 topKings['1'] = { rolls, kingId, form: null } 兼容
 *   旧读取方。各轮王 = kingOrder[roundNo-1].playerId；旧数据（prod 第 1 轮，
 *   无 kingOrder）回退 topKings[roundNo].kingId。
 * - 每轮赛前该轮的王经 s6_king_form 选择形态：daiqing（黛青）/feihong（绯红）/
 *   yuebai（月白），写入 topKings[roundNo] = { kingId, form }。
 * - 黛青：王所在方每局自动 2:0 开局，在局从 pending → in_progress 时由
 *   matchLifecycleService 调用 onGameStarted 应用一次。
 * - 绯红：仅通过 getGameConfig 的 kingForm 暴露给客户端做提示，局内人工记分。
 * - 月白：王参与的场次的局按抵抗局处理（同 S5 秩序模型）——getGameConfig
 *   返回 scoringMode 'resistance'（targetScore 21 / maxScore 30 /
 *   requiresWinner true），validateGameEnd 复用 rules/resistance.js 的共享
 *   校验（显式胜方、胜方得分 ≥21、≤30 封顶，允许分低者获胜如 21:29）。
 *   刻意简化：不追踪"对方是否先到 15 分"的局中事件——抵抗校验是标准
 *   21 分制结局的超集，故王的所有月白局一律按抵抗局配置。
 *
 * 撤回/重新开始语义：撤回已完成的局沿用服务端通用行为——局回到进行中并保留
 * 已记录比分（含开局分），记分员通过 updateScore 调整后再结束；开局分只在
 * 局首次进入进行中时应用，不会因撤回重复叠加。
 *
 * 切片二：下篇（5-7 轮）组合赛 + 灵魂契合
 * - 组合对阵与 S4 一致：第 5/6/7 轮 = AB vs CD / AC vs BD / AD vs BC，
 *   种子 A-D 取 comeback_data.s6.seeds（首次灵魂投掷时按选手 ID 排序持久化，
 *   与 S4 服务端 getS4ComboPairing 的排序推导口径一致）。
 * - 灵魂契合动作：s6_soul_roll（每人选投 1/2 次，2 次以第二次为准；双方
 *   点数求和、同点 +1 得总点数并解锁阶层）、s6_soul_pick（按解锁阶层选奖，
 *   一人 1 次、同点时后投者 2 次、不可重复、高阶解锁可选低阶）、
 *   s6_reforge（重铸：解锁第二阶（总点数 7-9，按重铸前的当前总点数判定）
 *   后可用，重投并保留客户端二选一后的点数，立刻生效并占用一次奖励选择，
 *   重铸后总点数与解锁阶层按新点数重算）。
 * - 重投次数（rerollSource，作为 s6_soul_roll 的可选字段提交）：triumph = 上篇
 *   前两名各 1 次（服务端按 1-4 轮已完赛场次胜场数取前二，并列按选手 ID 排序）；
 *   s5_shard = S5 贯穿碎片（最近一个 S5 赛季 comeback_data.s5.pierceCounts[playerId]
 *   - 3，同 client/src/rules/s5.js getPierceReward 口径）。重投在轮次创建前有效，
 *   且任一选手完成选奖后该组合不可再重投。
 * - 天选（总点数 13）：达成即自动触发，在 soulBond 条目上记 chosenGranted: true
 *   并同步 treasury[comboLabel].chosen，不消耗奖励选择次数；解锁阶层记为
 *   'chosen'（选奖视同已解锁第三阶）。
 * - 宝库卡片只持久化库存：treasury[comboLabel] = { inventory, activations, chosen }，
 *   activations 由切片三写入（本切片创建空数组占位）。
 *
 * 切片三：王之宝库卡片效果执行
 * - 卡片按启用条件分两类：随时卡（pause/blade/pause_plus，经 s6_card_use 仅记录
 *   使用并扣库存，效果为线下/人工）与局前暗选卡（block/charge/storage/rift/
 *   stardust/blast，经 s6_card_activate 在某局 pending 时逐人提交，cardId=null
 *   表示"不使用"；该场 4 名选手全部提交后所有记录同时 revealed=true）。
 * - 暗选逐人：s6_card_activate 负载为 { matchId, gameNo, playerId, cardId|null }，
 *   side 由选手所在的比赛队伍推导（team_a→'a'/team_b→'b'）；选手只能启用本人
 *   在灵魂契合中选到的卡（soulBond[*][comboLabel].picks 中 playerId+cardId 的
 *   记录，任一轮次），库存仍按组合扣减；每人每局至多一条暗选。
 * - 暗选/使用记录写入 treasury[comboLabel].activations：
 *   { id, timing: 'pre_game'|'anytime', matchId, gameId, gameNo, side, cardId,
 *     revealed, consumed }，局前暗选另带 playerId（逐人归属）。gameId 在局行
 *   已创建时（matchId-G{gameNo}）直接填入，否则为 null，客户端可按
 *   (matchId, gameNo) 关联。consumed 仅用于 storage（得分已记录）与
 *   rift（回溯已执行）。暗选提交即扣库存。
 * - side ↔ 组合映射：组合轮固定 teamA=COMBO_LABELS_BY_ROUND[roundNo][0]、
 *   teamB=[1]（见 roundCreationService.getComboPairingFromOrder），故
 *   side 'a'/'b' 直接映射到该轮第一/第二个组合标签。
 * - 爆破：本局已亮出 blast 暗选时 getGameConfig 返回 targetScore 11 /
 *   maxScore 12（每球 2 分，无加分；从偶数分可能越过 11 到 12，故封顶 12），
 *   validateGameEnd 走专用校验（胜方须达 11 且不超过 12）。
 * - 天选：treasury[combo].chosen 的组合在下篇每局开局 +2（onGameStarted）。
 * - 存储器：s6_storage_record 在该局结束后记录启用方额外球得分（胜 0-5、负 0-3），
 *   按暗选记录逐条匹配（payload 可带 playerId 精确到本人暗选；缺省时按未消费的
 *   暗选顺序消费，故同方两人同局各激活存储器时可各记录一次）。下一局已自动进入
 *   进行中时直接加到该局比分；否则把 { side, points, gameNo } 追加到
 *   comeback_data.s6.storageCarry[matchId] 数组，由 onGameStarted 在局开始时按方
 *   求和应用并整体清除（一次性）——同方两条 carry 即为求和语义。读取时兼容旧的
 *   单对象形态（包装为单元素数组）。
 * - 时空裂隙：s6_rift 校验该场存在未执行的 rift 暗选（payload 可带 playerId 精确
 *   匹配本人暗选，缺省时取该场任一未执行记录；一方有两条 rift 暗选时可分别回溯
 *   两次，只要库存支持）且第七局未完成后，复用
 *   gameService.revertGame（与 POST /games/:id/revert 同一实现，规则事件清理/
 *   局删除/比赛状态回滚语义一致）撤回最近 1-2 局已完成局，随后将暗选标记 consumed。
 *   客户端用 s6_rift 动作代替裸 revert 接口，使库存消耗与回溯原子生效。
 */
const standardRule = require('./standard');
const { validateResistanceGame } = require('./resistance');
const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { RULE_ID, SCORING_MODE, MATCH_STATUS } = require('../constants');
const { deleteGameRuleEvents } = require('../services/ruleEventService');
const cardFlow = require('./comboCardFlow');

const TOP_ROUND_MAX = 4;
const KING_FORMS = ['daiqing', 'feihong', 'yuebai'];

const COMBO_ROUND_MIN = 5;
const COMBO_ROUND_MAX = 7;
const COMBO_LABELS_BY_ROUND = {
  5: ['AB', 'CD'],
  6: ['AC', 'BD'],
  7: ['AD', 'BC']
};
const REROLL_SOURCES = ['triumph', 's5_shard'];

// 切片三：启用条件分组。局前暗选卡在局 pending 时提交；随时卡仅记录使用。
const PRE_GAME_CARDS = ['block', 'charge', 'storage', 'rift', 'stardust', 'blast'];
const BLAST_TARGET_SCORE = 11;
// 爆破每球 2 分且无加分：从偶数分可能越过 11 直接到 12，故封顶 12
const BLAST_MAX_SCORE = 12;


function getS6Data(ctx) {
  return parseJson(ctx.season?.comeback_data, {}).s6 || {};
}

function getTopKing(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > TOP_ROUND_MAX) return null;
  const s6 = getS6Data(ctx);
  const legacy = s6.topKings?.[String(roundNo)];
  // 各轮王取自一次性王序（kingOrder[roundNo-1]）；旧数据（prod 第 1 轮，
  // 王选调整前写入）无王序时回退 topKings[roundNo].kingId
  const kingId = s6.kingOrder?.[roundNo - 1]?.playerId || legacy?.kingId;
  if (!kingId) return null;
  return { ...(legacy || {}), kingId, form: legacy?.form || null };
}

// 月白：王参与的场次的局按抵抗局处理（简化口径见文件头注释）
function isYuebaiKingMatch(ctx) {
  const king = getTopKing(ctx);
  if (king?.form !== 'yuebai') return false;
  const teamA = parseJson(ctx.match?.team_a, []);
  const teamB = parseJson(ctx.match?.team_b, []);
  return teamA.includes(king.kingId) || teamB.includes(king.kingId);
}

// 下篇局状态：两个组合的 treasury 与本场的存储器 carry；非下篇轮次返回 null
function getComboPhaseState(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const s6 = getS6Data(ctx);
  const labels = COMBO_LABELS_BY_ROUND[roundNo];
  return {
    labels,
    treasuryA: s6.treasury?.[labels[0]] || null,
    treasuryB: s6.treasury?.[labels[1]] || null,
    carry: s6.storageCarry?.[ctx.match?.id] || null
  };
}

// 存储器 carry 统一为数组读取（兼容旧的单对象形态）
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

  // 下篇：天选组合每局 +2；存储器 carry 一次性带入（由 onGameStarted 清除）——共享口径
  const combo = getComboPhaseState(ctx);
  if (combo) {
    const shared = cardFlow.getComboOpening(getS6Data(ctx), combo.labels, ctx.match);
    opening.openingScoreA += shared.openingScoreA;
    opening.openingScoreB += shared.openingScoreB;
  }

  return opening;
}

function getGameConfig(ctx) {
  const opening = getOpeningScore(ctx);
  const activeEffects = cardFlow.getActiveEffects(ctx.game, getComboPhaseState(ctx));
  const blast = activeEffects.blast !== null;
  // 月白（仅上篇）：王参与的场次按抵抗局配置；爆破仅下篇，二者不会同时命中
  const resistance = isYuebaiKingMatch(ctx);
  return {
    scoringMode: resistance ? SCORING_MODE.RESISTANCE : SCORING_MODE.STANDARD,
    targetScore: blast ? BLAST_TARGET_SCORE : 21,
    maxScore: blast ? BLAST_MAX_SCORE : 30,
    requiresWinner: resistance,
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
  if (config.scoringMode === SCORING_MODE.RESISTANCE) return validateResistanceGame(config, input);
  return standardRule.validateGameEnd({ ...ctx, gameConfig: config }, input);
}

function onGameStarted(ctx) {
  const opening = getOpeningScore(ctx);

  // 存储器 carry 为一次性：局开始应用后从 comeback_data 清除
  const combo = getComboPhaseState(ctx);
  if (combo?.carry && ctx.season?.id && ctx.match?.id) {
    const data = parseJson(ctx.season.comeback_data, {});
    if (data.s6?.storageCarry) {
      delete data.s6.storageCarry[ctx.match.id];
      prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(stringifyJson(data), ctx.season.id);
    }
  }

  if (!opening.openingScoreA && !opening.openingScoreB) return null;
  return { scoreA: opening.openingScoreA, scoreB: opening.openingScoreB };
}

function normalizeS6State(s6 = {}) {
  return {
    ...s6,
    topKings: s6.topKings || {},
    soulBond: s6.soulBond || {},
    treasury: s6.treasury || {},
    storageCarry: s6.storageCarry || {}
  };
}

function findRound(seasonId, roundNo) {
  return prepare('SELECT * FROM rounds WHERE season_id = ? AND round_no = ?').get(seasonId, roundNo);
}

function validateTopRoundNo(ctx, roundNo) {
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > TOP_ROUND_MAX) {
    return '王选仅适用于上篇第 1-4 轮';
  }
  if (findRound(ctx.season?.id, roundNo)) return '该轮已创建，无法再进行王选';
  return null;
}

// s6_king_roll：一次性王选。客户端投掷并裁决同分组内顺序后提交最终王序
// （order[0] 为第 1 轮的王，依此类推），服务端只校验为参赛者排列且骰子
// 为 1-6 整数，按提交顺序持久化，不按骰子重排。
function recordKingRoll(ctx, input = {}) {
  if (findRound(ctx.season?.id, 1)) return { validationError: '该轮已创建，无法再进行王选' };

  const participants = parseJson(ctx.season?.participants, []);
  if (participants.length !== 4) return { validationError: '第六赛季王选需要 4 名参赛选手' };

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  if (s6.kingOrder) return { validationError: '王选已完成，不能重复提交' };

  const order = Array.isArray(input.order) ? input.order : null;
  if (!order || order.length !== participants.length) {
    return { validationError: '王选顺序必须包含全部 4 名参赛选手' };
  }

  const seen = new Set();
  const kingOrder = [];
  for (const entry of order) {
    const playerId = String(entry?.playerId || '').trim();
    const dice = Number(entry?.dice);
    if (!participants.includes(playerId)) return { validationError: '王选顺序包含非本赛季选手' };
    if (seen.has(playerId)) return { validationError: '王选顺序中同一选手只能出现一次' };
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
      return { validationError: '骰子点数必须是 1-6 的整数' };
    }
    seen.add(playerId);
    const item = { playerId, dice };
    if (Array.isArray(entry?.rolls)) item.rolls = entry.rolls;
    kingOrder.push(item);
  }

  return {
    nextData: {
      ...data,
      s6: {
        ...s6,
        kingOrder,
        // 兼容旧读取方：第 1 轮的 topKings 同步写入（form 由 s6_king_form 补充）
        topKings: {
          ...s6.topKings,
          '1': { rolls: kingOrder, kingId: kingOrder[0].playerId, form: null }
        }
      }
    }
  };
}

function recordKingForm(ctx, input = {}) {
  const roundNo = Number(input.roundNo);
  const roundError = validateTopRoundNo(ctx, roundNo);
  if (roundError) return { validationError: roundError };

  const form = String(input.form || '').trim();
  if (!KING_FORMS.includes(form)) return { validationError: '无效的王形态' };

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  // 各轮王取自王序（kingOrder[roundNo-1]）；旧数据无王序时回退 topKings[roundNo].kingId
  const kingId = s6.kingOrder?.[roundNo - 1]?.playerId || s6.topKings[String(roundNo)]?.kingId;
  if (!kingId) return { validationError: '请先完成王选掷骰' };

  return {
    nextData: {
      ...data,
      s6: {
        ...s6,
        topKings: {
          ...s6.topKings,
          [String(roundNo)]: { ...(s6.topKings[String(roundNo)] || {}), kingId, form }
        }
      }
    }
  };
}

function recordSeasonAction(ctx, actionId, input) {
  if (actionId === 's6_king_roll') return recordKingRoll(ctx, input);
  if (actionId === 's6_king_form') return recordKingForm(ctx, input);
  if (actionId === 's6_soul_roll') return recordSoulRoll(ctx, input);
  if (actionId === 's6_soul_pick') return recordSoulPick(ctx, input);
  if (actionId === 's6_reforge') return recordReforge(ctx, input);
  if (actionId === 's6_card_activate') return recordCardActivate(ctx, input);
  if (actionId === 's6_card_use') return recordCardUse(ctx, input);
  if (actionId === 's6_storage_record') return recordStorageRecord(ctx, input);
  if (actionId === 's6_rift') return recordRift(ctx, input);
  return { validationError: '第六赛季不支持该操作' };
}

// ---- 切片二：灵魂契合 ----

function isSeedsComplete(seeds) {
  return Boolean(seeds?.A && seeds?.B && seeds?.C && seeds?.D);
}

// 种子推导：优先读 comeback_data.s6.seeds，缺省时按选手 ID 排序
// （与 S4 服务端 getS4ComboPairing 的口径一致；上篇排名由客户端计算）。
function deriveSeeds(ctx, s6) {
  if (isSeedsComplete(s6.seeds)) return s6.seeds;
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


function syncTreasuryChosen(s6, comboLabel, combo) {
  const treasury = cardFlow.ensureTreasury(s6, comboLabel);
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

// 上篇（1-4 轮）排名：按已完赛场次胜场数降序，并列按选手 ID 升序。
// 服务端不跑客户端排名算法，凯旋前二按此口径近似（与 calcSeasonChampion 同源）。
function getTopPhaseOrder(season) {
  const participants = parseJson(season?.participants, []);
  const wins = {};
  for (const pid of participants) wins[pid] = 0;
  const rows = prepare(`SELECT m.team_a, m.team_b, m.winner FROM matches m
    JOIN rounds r ON m.round_id = r.id
    WHERE m.season_id = ? AND m.status = ? AND r.round_no <= ?`)
    .all(season?.id, MATCH_STATUS.COMPLETED, TOP_ROUND_MAX);
  for (const row of rows) {
    if (!row.winner) continue;
    const winnerTeam = row.winner === 'a' ? parseJson(row.team_a, []) : parseJson(row.team_b, []);
    for (const pid of winnerTeam) { if (wins[pid] !== undefined) wins[pid] += 1; }
  }
  return [...participants].sort((a, b) => wins[b] - wins[a] || String(a).localeCompare(String(b)));
}

function getRerollEntitlement(ctx, playerId, source) {
  if (source === 'triumph') {
    return getTopPhaseOrder(ctx.season).slice(0, 2).includes(playerId) ? 1 : 0;
  }
  // s5_shard：S5 贯穿次数 - 3（同 client/src/rules/s5.js getPierceReward）
  const row = prepare("SELECT comeback_data FROM seasons WHERE rule_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(RULE_ID.S5);
  const pierceCounts = parseJson(row?.comeback_data, {}).s5?.pierceCounts || {};
  return Math.max(0, Number(pierceCounts[playerId] || 0) - 3);
}

function getUsedRerolls(s6, playerId, source) {
  let used = 0;
  for (const roundBond of Object.values(s6.soulBond || {})) {
    for (const combo of Object.values(roundBond || {})) {
      used += (combo.rerollsUsed || [])
        .filter(entry => entry.playerId === playerId && entry.source === source).length;
    }
  }
  return used;
}

function validateComboRound(ctx, roundNo) {
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) {
    return '灵魂契合仅适用于下篇第 5-7 轮';
  }
  if (findRound(ctx.season?.id, roundNo)) return '该轮已创建，无法再进行灵魂契合';
  return null;
}

// 校验轮次/组合/选手，返回 { error } 或 { s6, combo, roundKey, comboLabel, playerId }
function resolveComboContext(ctx, input) {
  const roundNo = Number(input.roundNo);
  const roundError = validateComboRound(ctx, roundNo);
  if (roundError) return { error: roundError };

  const comboLabel = String(input.comboLabel || '').trim();
  if (!COMBO_LABELS_BY_ROUND[roundNo].includes(comboLabel)) {
    return { error: '无效的组合标识' };
  }

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  s6.seeds = deriveSeeds(ctx, s6);

  const playerId = String(input.playerId || '').trim();
  if (!getComboPlayerIds(s6.seeds, comboLabel).includes(playerId)) {
    return { error: '该选手不属于此组合' };
  }

  const roundKey = String(roundNo);
  const roundBond = s6.soulBond[roundKey] || {};
  s6.soulBond[roundKey] = roundBond;
  const combo = roundBond[comboLabel] || { rolls: [], picks: [], rerollsUsed: [] };
  roundBond[comboLabel] = combo;

  return { data, s6, combo, comboLabel, playerId };
}

function recordSoulRoll(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6, combo, comboLabel, playerId } = resolved;

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
      - getUsedRerolls(s6, playerId, rerollSource);
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
    syncTreasuryChosen(s6, comboLabel, combo);
  }

  return { nextData: { ...data, s6 } };
}

function recordSoulPick(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6, combo, comboLabel, playerId } = resolved;

  if (combo.rolls.length !== 2) return { validationError: '请先完成该组合的灵魂契合掷骰' };
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

  const treasury = cardFlow.ensureTreasury(s6, comboLabel);
  treasury.inventory[cardId] = (treasury.inventory[cardId] || 0) + card.uses;

  return { nextData: { ...data, s6 } };
}

function recordReforge(ctx, input = {}) {
  const resolved = resolveComboContext(ctx, input);
  if (resolved.error) return { validationError: resolved.error };
  const { data, s6, combo, comboLabel, playerId } = resolved;

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
  syncTreasuryChosen(s6, comboLabel, combo);

  return { nextData: { ...data, s6 } };
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
  const bond = parseJson(season?.comeback_data, {}).s6?.soulBond?.[String(roundNo)] || {};
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
    return { error: '王之宝库卡片仅适用于下篇第 5-7 轮' };
  }
  return { match, roundNo };
}

// s6_card_activate：局前暗选逐人提交（共享生命周期，门控见 canStartGame）
function recordCardActivate(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const result = cardFlow.recordCardActivate(ctx, s6, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S6CA'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6 } };
}

// s6_card_use：随时卡（暂停卡/名刀/高级暂停卡）**局后记录**——该局结束后按方
// 补记使用次数（每条消耗 1 次库存，带 gameNo 归属该局）。
function recordCardUse(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const result = cardFlow.recordPostGameUse(ctx, s6, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input, idPrefix: 'S6CU'
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6 } };
}

// s6_storage_record：存储器局后记录启用方额外球得分（共享口径）。
function recordStorageRecord(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const result = cardFlow.recordStorageRecord(ctx, s6, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6 } };
}

// s6_rift：时空裂隙执行回溯（共享实现；库存已在暗选时扣减，此处标记已执行）。
function recordRift(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const result = cardFlow.recordRift(ctx, s6, {
    match: resolved.match, roundNo: resolved.roundNo,
    labels: COMBO_LABELS_BY_ROUND[resolved.roundNo], input
  });
  if (result.validationError) return result;
  return { nextData: { ...data, s6 } };
}

// 局前记录硬门控：组合轮每局开始前需 4 名选手完成局前暗选（含「不使用」）；
// 非组合轮返回 null（不门控）。被 matchLifecycleService（自动推进）与
// startMatch 控制器（比赛开始）调用。
function canStartGame(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < COMBO_ROUND_MIN || roundNo > COMBO_ROUND_MAX) return null;
  const match = ctx.match;
  const gameNo = Number(ctx.game?.game_no);
  return cardFlow.preGameGateError(getS6Data(ctx), COMBO_LABELS_BY_ROUND[roundNo], match, gameNo);
}

// 撤回最后一局：清理该局的规则事件，并回收每局归属的道具卡状态
// （随时卡退还库存 / 存储器记录重置 / carry 撤销），共享 comboCardFlow 实现。
function onGameReverted(ctx) {
  if (!ctx.season?.id || !ctx.game?.id || !ctx.match?.id) return;
  const roundNo = Number(ctx.round?.round_no);
  const labels = COMBO_LABELS_BY_ROUND[roundNo];
  if (!labels) return;
  const data = parseJson(ctx.season.comeback_data, {});
  const s6 = normalizeS6State(data.s6 || {});
  cardFlow.revertGameCardState(s6, { match: ctx.match, game: ctx.game, labels });
  deleteGameRuleEvents(ctx.game.id, RULE_ID.S6);
  deleteGameRuleEvents(ctx.game.id, RULE_ID.S6);
  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(
    stringifyJson({ ...data, s6 }), ctx.season.id
  );
}

module.exports = {
  id: RULE_ID.S6,
  getGameConfig,
  validateGameEnd,
  onGameStarted,
  canStartGame,
  onGameReverted,
  recordSeasonAction,
  isSoulBondCompleteForRound,
  TREASURY_CARDS: cardFlow.TREASURY_CARDS
};
