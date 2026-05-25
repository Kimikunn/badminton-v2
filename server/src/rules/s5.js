const standardRule = require('./standard');
const { parseJson } = require('../utils/json');
const { RULE_ID, SCORING_MODE, WINNER_SIDE } = require('../constants');
const {
  deleteGameRuleEvents,
  insertGameRuleEvent,
  recalculateS5DebtRecords,
  recalculateS5PierceCounts
} = require('../services/ruleEventService');

function getS5Data(ctx) {
  return parseJson(ctx.season?.comeback_data, {}).s5 || {};
}

function getRoundMode(ctx) {
  const roundNo = ctx.round?.round_no;
  const dice = roundNo ? getS5Data(ctx).roundDice?.[String(roundNo)] : null;
  if (!dice) return { mode: 'order', targetScore: 21, maxScore: 30, settled: false };
  if (dice.mode === 'mutation') return { ...dice, targetScore: 15, maxScore: 21, settled: true };
  return { ...dice, mode: 'order', targetScore: 21, maxScore: 30, settled: true };
}

function getGameConfig(ctx) {
  const roundMode = getRoundMode(ctx);
  if (roundMode.mode === 'mutation') {
    return {
      scoringMode: SCORING_MODE.STANDARD,
      targetScore: 15,
      maxScore: 21,
      requiresWinner: false,
      supportsPierce: false,
      roundMode
    };
  }

  return {
    scoringMode: SCORING_MODE.RESISTANCE,
    targetScore: 21,
    maxScore: 30,
    requiresWinner: true,
    supportsPierce: true,
    roundMode
  };
}

function validateResistanceGame(ctx, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  const scoreA = Number(input.scoreA || 0);
  const scoreB = Number(input.scoreB || 0);
  const winner = input.winner || null;

  if (scoreA < 0 || scoreB < 0) return { canEnd: false, winner: null, reason: '比分不能为负数' };
  if (scoreA === scoreB) return { canEnd: false, winner: null, reason: '比分不能相等' };
  if (scoreA > config.maxScore || scoreB > config.maxScore) {
    return { canEnd: false, winner: null, reason: `最高${config.maxScore}分封顶` };
  }
  if (!Object.values(WINNER_SIDE).includes(winner)) return { canEnd: false, winner: null, reason: '抵抗局需要选择胜方' };

  const winnerScore = winner === WINNER_SIDE.A ? scoreA : scoreB;
  if (winnerScore < config.targetScore) {
    return { canEnd: false, winner: null, reason: `抵抗局胜方需至少达到${config.targetScore}分` };
  }

  return { canEnd: true, winner, reason: '' };
}

function validateGameEnd(ctx, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  if (config.scoringMode === SCORING_MODE.STANDARD) {
    return standardRule.validateGameEnd({ ...ctx, gameConfig: config }, input);
  }
  return validateResistanceGame({ ...ctx, gameConfig: config }, input);
}

function getTeamPlayers(match, team) {
  const raw = team === WINNER_SIDE.A ? match.team_a : match.team_b;
  return parseJson(raw, []);
}

function afterGameCompleted(ctx, result, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  if (config.scoringMode !== SCORING_MODE.RESISTANCE || !ctx.season?.id || !ctx.match?.id || !ctx.game?.id) return;

  deleteGameRuleEvents(ctx.game.id, RULE_ID.S5);

  const scoreA = Number(input.scoreA || 0);
  const scoreB = Number(input.scoreB || 0);
  const winnerScore = result.winner === WINNER_SIDE.A ? scoreA : scoreB;
  const loserScore = result.winner === WINNER_SIDE.A ? scoreB : scoreA;

  if (winnerScore < loserScore) {
    insertGameRuleEvent({
      seasonId: ctx.season.id,
      roundId: ctx.round?.id || null,
      matchId: ctx.match.id,
      gameId: ctx.game.id,
      ruleId: RULE_ID.S5,
      timing: 'afterGame',
      type: 'resistance',
      payload: { winner: result.winner, scoreA, scoreB }
    });
  }

  const pierceTeam = input.rulePayload?.pierceTeam;
  if (Object.values(WINNER_SIDE).includes(pierceTeam)) {
    insertGameRuleEvent({
      seasonId: ctx.season.id,
      roundId: ctx.round?.id || null,
      matchId: ctx.match.id,
      gameId: ctx.game.id,
      ruleId: RULE_ID.S5,
      timing: 'afterGame',
      type: 'pierce',
      payload: {
        team: pierceTeam,
        players: getTeamPlayers(ctx.match, pierceTeam),
        scoreA,
        scoreB
      }
    });
  }

  recalculateS5PierceCounts(ctx.season.id);
}

function onGameReverted(ctx) {
  if (!ctx.season?.id || !ctx.game?.id) return;
  deleteGameRuleEvents(ctx.game.id, RULE_ID.S5);
  recalculateS5PierceCounts(ctx.season.id);
}

function afterRoundRecalculated(ctx) {
  if (!ctx.season?.id) return;
  recalculateS5DebtRecords(ctx.season.id);
}

function normalizeS5State(s5 = {}) {
  return {
    ...s5,
    roundDice: s5.roundDice || {},
    pierceCounts: s5.pierceCounts || {},
    debtRecords: s5.debtRecords || {},
    pauseUses: Array.isArray(s5.pauseUses) ? s5.pauseUses : [],
    debtSettlements: s5.debtSettlements || {}
  };
}

function getParticipants(ctx) {
  return parseJson(ctx.season?.participants, []);
}

function recordPauseUse(ctx, input = {}) {
  const playerId = String(input.playerId || '').trim();
  if (!playerId) return { validationError: '必须选择使用暂停的选手' };
  if (!getParticipants(ctx).includes(playerId)) return { validationError: '该选手不属于第五赛季' };

  const data = ctx.data || {};
  const s5 = normalizeS5State(data.s5 || {});
  const pierceCount = Number(s5.pierceCounts?.[playerId] || 0);
  if (pierceCount < 1) return { validationError: '该选手尚未获得贯穿暂停权' };
  if (s5.pauseUses.some(item => item.playerId === playerId)) {
    return { validationError: '该选手的贯穿暂停权已经使用过' };
  }

  return {
    nextData: {
      ...data,
      s5: {
        ...s5,
        pauseUses: [
          ...s5.pauseUses,
          {
            id: ctx.helpers.prefixedId('S5PU'),
            playerId,
            usedAt: ctx.helpers.nowIso(),
            note: ctx.helpers.normalizeNote(input.note)
          }
        ]
      }
    }
  };
}

function recordDebtSettlement(ctx, input = {}) {
  const roundNo = Number(input.roundNo);
  if (!Number.isInteger(roundNo) || roundNo < 1) return { validationError: '必须选择要结算的轮次' };

  const data = ctx.data || {};
  const s5 = normalizeS5State(data.s5 || {});
  const debtRecord = s5.debtRecords?.[String(roundNo)];
  if (!debtRecord) return { validationError: '该轮还没有按排名生成债务卡' };
  if (s5.debtSettlements[String(roundNo)]) return { validationError: '该轮债务已经记录结算' };

  return {
    nextData: {
      ...data,
      s5: {
        ...s5,
        debtSettlements: {
          ...s5.debtSettlements,
          [String(roundNo)]: {
            id: ctx.helpers.prefixedId('S5DS'),
            roundNo,
            roundId: debtRecord.roundId || null,
            creditors: debtRecord.creditors || [],
            debtors: debtRecord.debtors || [],
            settledAt: ctx.helpers.nowIso(),
            note: ctx.helpers.normalizeNote(input.note)
          }
        }
      }
    }
  };
}

function recordSeasonAction(ctx, actionId, input) {
  if (actionId === 's5_pause_use') return recordPauseUse(ctx, input);
  if (actionId === 's5_debt_settlement') return recordDebtSettlement(ctx, input);
  return { validationError: '第五赛季不支持该操作' };
}

module.exports = {
  id: RULE_ID.S5,
  getGameConfig,
  validateGameEnd,
  afterGameCompleted,
  onGameReverted,
  afterRoundRecalculated,
  recordSeasonAction
};
