/**
 * S6 赛季规则插件（切片一：上篇 1-4 轮 王选 + 王形态）
 *
 * 上篇规则：
 * - 标准 21 分制 BO3，局终校验与 standard 一致（含黛青 2:0 开局：终局校验
 *   只看最终比分是否满足目标分/领先 2 分/封顶，与开局分无关，故无需特判）。
 * - 每轮赛前王选：4 名参赛者各投一次骰子（客户端随机，同分由客户端重投后
 *   再提交），最高点数唯一者为本轮"王"，经 s6_king_roll 持久化到
 *   comeback_data.s6.topKings[roundNo] = { rolls, kingId, form }。
 * - 王在赛前经 s6_king_form 选择形态：daiqing（黛青）/feihong（绯红）/yuebai（月白）。
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
const { RULE_ID, SCORING_MODE, MATCH_STATUS, WINNER_SIDE } = require('../constants');

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
const ANYTIME_CARDS = ['pause', 'blade', 'pause_plus'];
const BLAST_TARGET_SCORE = 11;
// 爆破每球 2 分且无加分：从偶数分可能越过 11 直接到 12，故封顶 12
const BLAST_MAX_SCORE = 12;

// 王之宝库卡片目录（与客户端共享的常量口径；uses 为每张卡的库存次数，
// reforge/chosen 不进库存：重铸立刻生效，天选自动触发）。
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

function getS6Data(ctx) {
  return parseJson(ctx.season?.comeback_data, {}).s6 || {};
}

function getTopKing(ctx) {
  const roundNo = Number(ctx.round?.round_no);
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > TOP_ROUND_MAX) return null;
  const king = getS6Data(ctx).topKings?.[String(roundNo)];
  return king && king.kingId ? king : null;
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
    treasuryA: s6.treasury?.[labels[0]] || null,
    treasuryB: s6.treasury?.[labels[1]] || null,
    carry: s6.storageCarry?.[ctx.match?.id] || null
  };
}

// 存储器 carry 统一为数组读取（兼容旧的单对象形态）
function getPendingCarries(carry) {
  if (!carry) return [];
  return Array.isArray(carry) ? carry : [carry];
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

  // 下篇：天选组合每局 +2；存储器 carry 一次性带入（由 onGameStarted 清除），
  // 多条 carry 按方求和
  const combo = getComboPhaseState(ctx);
  if (combo) {
    if (combo.treasuryA?.chosen === true) opening.openingScoreA += 2;
    if (combo.treasuryB?.chosen === true) opening.openingScoreB += 2;
    for (const carry of getPendingCarries(combo.carry)) {
      const points = Number(carry.points || 0);
      if (carry.side === WINNER_SIDE.A) opening.openingScoreA += points;
      else opening.openingScoreB += points;
    }
  }

  return opening;
}

// 本局已亮出的暗选效果（客户端提示横幅用）：值为生效方 'a'/'b'/null；
// chosenA/chosenB 为天选是否作用于对应方。仅统计 revealed 的局前暗选。
function getActiveEffects(ctx, combo) {
  const effects = { blast: null, block: null, charge: null, stardust: null, storage: null, chosenA: false, chosenB: false };
  if (!combo) return effects;
  effects.chosenA = combo.treasuryA?.chosen === true;
  effects.chosenB = combo.treasuryB?.chosen === true;

  const gameNo = Number(ctx.game?.game_no);
  const matchId = ctx.match?.id;
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

function getGameConfig(ctx) {
  const opening = getOpeningScore(ctx);
  const activeEffects = getActiveEffects(ctx, getComboPhaseState(ctx));
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

function validateGameEnd(ctx, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  if (config.activeEffects?.blast) return validateBlastGame(config, input);
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

function recordKingRoll(ctx, input = {}) {
  const roundNo = Number(input.roundNo);
  const roundError = validateTopRoundNo(ctx, roundNo);
  if (roundError) return { validationError: roundError };

  const participants = parseJson(ctx.season?.participants, []);
  if (participants.length !== 4) return { validationError: '第六赛季王选需要 4 名参赛选手' };

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  if (s6.topKings[String(roundNo)]) return { validationError: '该轮已完成王选，不能重复提交' };

  const rolls = Array.isArray(input.rolls) ? input.rolls : null;
  if (!rolls || rolls.length !== participants.length) {
    return { validationError: '王选掷骰必须包含全部 4 名参赛选手' };
  }

  const seen = new Set();
  const normalized = [];
  for (const roll of rolls) {
    const playerId = String(roll?.playerId || '').trim();
    const dice = Number(roll?.dice);
    if (!participants.includes(playerId)) return { validationError: '王选掷骰包含非本赛季选手' };
    if (seen.has(playerId)) return { validationError: '王选掷骰中同一选手只能提交一次' };
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
      return { validationError: '骰子点数必须是 1-6 的整数' };
    }
    seen.add(playerId);
    normalized.push({ playerId, dice });
  }

  const maxDice = Math.max(...normalized.map(roll => roll.dice));
  const winners = normalized.filter(roll => roll.dice === maxDice);
  if (winners.length !== 1) {
    return { validationError: '最高点数存在并列，请重投后再提交' };
  }

  return {
    nextData: {
      ...data,
      s6: {
        ...s6,
        topKings: {
          ...s6.topKings,
          [String(roundNo)]: {
            rolls: normalized,
            kingId: winners[0].playerId,
            form: null
          }
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
  const king = s6.topKings[String(roundNo)];
  if (!king) return { validationError: '请先完成该轮的王选掷骰' };

  return {
    nextData: {
      ...data,
      s6: {
        ...s6,
        topKings: {
          ...s6.topKings,
          [String(roundNo)]: { ...king, form }
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

// 宝库结构：inventory 为库存次数，activations 由切片三写入；chosen 标记天选已触发。
function ensureTreasury(s6, comboLabel) {
  const treasury = s6.treasury[comboLabel] || {};
  treasury.inventory = treasury.inventory || {};
  treasury.activations = Array.isArray(treasury.activations) ? treasury.activations : [];
  s6.treasury[comboLabel] = treasury;
  return treasury;
}

function syncTreasuryChosen(s6, comboLabel, combo) {
  const treasury = ensureTreasury(s6, comboLabel);
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
  const card = TREASURY_CARDS[cardId];
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

  const treasury = ensureTreasury(s6, comboLabel);
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

function getMatchGame(matchId, gameNo) {
  return prepare('SELECT * FROM games WHERE match_id = ? AND game_no = ?').get(matchId, gameNo);
}

// side ↔ 组合：组合轮固定 teamA=该轮第一组合标签、teamB=第二组合标签
// （与 roundCreationService.getComboPairingFromOrder 的对阵方向一致）。
function getComboLabelForSide(roundNo, side) {
  const labels = COMBO_LABELS_BY_ROUND[Number(roundNo)];
  if (!labels) return null;
  if (side === WINNER_SIDE.A) return labels[0];
  if (side === WINNER_SIDE.B) return labels[1];
  return null;
}

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

// 某场某局已提交的全部局前暗选记录（两个组合的 treasury 都扫描）
function findPreGameActivations(s6, roundNo, matchId, gameNo) {
  const entries = [];
  for (const label of COMBO_LABELS_BY_ROUND[roundNo] || []) {
    for (const entry of s6.treasury?.[label]?.activations || []) {
      if (entry.timing === 'pre_game' && entry.matchId === matchId && entry.gameNo === gameNo) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

// 卡片归属：选手本人在灵魂契合中选到的卡（该组合任一轮次的 picks 中有
// playerId+cardId 记录；组合标签由种子固定，跨轮次不变）
function playerOwnsCard(s6, comboLabel, playerId, cardId) {
  for (const roundBond of Object.values(s6.soulBond || {})) {
    const picks = roundBond?.[comboLabel]?.picks || [];
    if (picks.some(pick => pick.playerId === playerId && pick.cardId === cardId)) return true;
  }
  return false;
}

// s6_card_activate：局前暗选逐人提交（cardId=null 表示"不使用"）。
// side 由选手所在比赛队伍推导；该场 4 名选手全部提交后所有记录同时亮出。
function recordCardActivate(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const { match, roundNo } = resolved;

  const playerId = String(input.playerId || '').trim();
  const teamA = parseJson(match.team_a, []);
  const teamB = parseJson(match.team_b, []);
  let side = null;
  if (teamA.includes(playerId)) side = WINNER_SIDE.A;
  else if (teamB.includes(playerId)) side = WINNER_SIDE.B;
  if (!side) return { validationError: '该选手不属于此比赛' };
  const comboLabel = getComboLabelForSide(roundNo, side);

  const gameNo = Number(input.gameNo);
  if (!Number.isInteger(gameNo) || gameNo < 1 || gameNo > (match.best_of || 7)) {
    return { validationError: '无效的局号' };
  }

  const game = getMatchGame(match.id, gameNo);
  if (game && game.status !== MATCH_STATUS.PENDING) {
    return { validationError: '该局已开始，无法再进行暗选' };
  }

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const submitted = findPreGameActivations(s6, roundNo, match.id, gameNo);
  if (submitted.some(entry => entry.playerId === playerId)) {
    return { validationError: '该选手本局已提交暗选' };
  }

  const treasury = ensureTreasury(s6, comboLabel);
  const cardId = input.cardId === null || input.cardId === undefined ? null : String(input.cardId).trim();
  if (cardId) {
    if (!TREASURY_CARDS[cardId]) return { validationError: '无效的宝库卡片' };
    if (!PRE_GAME_CARDS.includes(cardId)) return { validationError: '该卡片无需在局前暗选' };
    if (!playerOwnsCard(s6, comboLabel, playerId, cardId)) return { validationError: '该选手未获得此卡' };
    if (Number(treasury.inventory[cardId] || 0) <= 0) return { validationError: '该卡片库存不足' };
    treasury.inventory[cardId] -= 1;
  }

  const entry = {
    id: ctx.helpers.prefixedId('S6CA'),
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
  const all = findPreGameActivations(s6, roundNo, match.id, gameNo);
  const submittedIds = new Set(all.map(item => item.playerId));
  if ([...teamA, ...teamB].every(pid => submittedIds.has(pid))) {
    for (const item of all) item.revealed = true;
  }

  return { nextData: { ...data, s6 } };
}

// s6_card_use：随时卡（pause/blade/pause_plus）使用记录，效果为线下/人工执行。
function recordCardUse(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const { match, roundNo } = resolved;

  const side = String(input.side || '').trim();
  const comboLabel = getComboLabelForSide(roundNo, side);
  if (!comboLabel) return { validationError: '无效的比赛方' };

  const cardId = String(input.cardId || '').trim();
  if (!TREASURY_CARDS[cardId]) return { validationError: '无效的宝库卡片' };
  if (!ANYTIME_CARDS.includes(cardId)) return { validationError: '该卡片需要在每局开始前暗选启用' };

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const treasury = ensureTreasury(s6, comboLabel);
  if (Number(treasury.inventory[cardId] || 0) <= 0) return { validationError: '该卡片库存不足' };
  treasury.inventory[cardId] -= 1;

  treasury.activations.push({
    id: ctx.helpers.prefixedId('S6CU'),
    timing: 'anytime',
    matchId: match.id,
    gameId: null,
    gameNo: null,
    side,
    cardId,
    revealed: true,
    consumed: true
  });

  return { nextData: { ...data, s6 } };
}

// s6_storage_record：存储器局后记录启用方额外球得分（胜 0-5、负 0-3）。
// 按暗选记录逐条匹配：payload 可带 playerId 精确到本人暗选；缺省时取该方该局
// 最早一条未消费的存储器暗选。下一局已自动进入进行中时直接加到该局比分并立即
// 生效；否则把 { side, points, gameNo } 追加到 storageCarry[matchId] 数组，
// 待 onGameStarted 在局开始时按方求和应用并清除。第七局没有下一局，仅记录得分。
function recordStorageRecord(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const { match, roundNo } = resolved;

  const side = String(input.side || '').trim();
  const comboLabel = getComboLabelForSide(roundNo, side);
  if (!comboLabel) return { validationError: '无效的比赛方' };

  const gameNo = Number(input.gameNo);
  if (!Number.isInteger(gameNo) || gameNo < 1 || gameNo > (match.best_of || 7)) {
    return { validationError: '无效的局号' };
  }

  const playerId = input.playerId === null || input.playerId === undefined ? null : String(input.playerId).trim();

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const treasury = ensureTreasury(s6, comboLabel);
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
    const existing = s6.storageCarry[match.id];
    const carries = Array.isArray(existing) ? existing : (existing ? [existing] : []);
    carries.push({ side, points, gameNo });
    s6.storageCarry[match.id] = carries;
  }

  return { nextData: { ...data, s6 } };
}

// s6_rift：时空裂隙执行回溯。复用 gameService.revertGame（与 POST /games/:id/revert
// 同一实现，规则事件清理/局删除/比赛状态回滚语义一致）；库存已在暗选时扣减，
// 此处仅将暗选标记为已执行。延迟 require 避免与 gameService 循环引用。
function recordRift(ctx, input = {}) {
  const resolved = resolveTreasuryMatchContext(ctx, input.matchId);
  if (resolved.error) return { validationError: resolved.error };
  const { match, roundNo } = resolved;

  const gamesToRevert = Number(input.games);
  if (gamesToRevert !== 1 && gamesToRevert !== 2) {
    return { validationError: '回溯局数必须为 1 或 2' };
  }

  const matchGames = prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(match.id);
  const finalGame = matchGames.find(g => g.game_no === (match.best_of || 7));
  if (finalGame?.status === MATCH_STATUS.COMPLETED) {
    return { validationError: '第七局结束后无法启用回溯' };
  }

  const data = ctx.data || {};
  const s6 = normalizeS6State(data.s6 || {});
  const playerId = input.playerId === null || input.playerId === undefined ? null : String(input.playerId).trim();
  let activation = null;
  for (const label of COMBO_LABELS_BY_ROUND[roundNo]) {
    const found = (s6.treasury?.[label]?.activations || []).find(entry =>
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
  return { nextData: { ...data, s6 } };
}

module.exports = {
  id: RULE_ID.S6,
  getGameConfig,
  validateGameEnd,
  onGameStarted,
  recordSeasonAction,
  isSoulBondCompleteForRound,
  TREASURY_CARDS
};
