const { prepare, transaction } = require('../config/db');
const { getRule } = require('../rules');
const { recalculateMatch } = require('./matchLifecycleService');
const { recalculateRound } = require('./roundLifecycleService');
const { deleteRuleEventsForGame, getRuleEventsByGameIds } = require('./ruleEventService');
const { MATCH_STATUS, RULE_ID } = require('../constants');

function formatGame(g, ruleEventsByGameId = null) {
  const ruleEvents = ruleEventsByGameId
    ? ruleEventsByGameId[g.id] || []
    : getRuleEventsByGameIds([g.id])[g.id] || [];

  return {
    id: g.id,
    matchId: g.match_id,
    gameNo: g.game_no,
    scoreA: g.score_a,
    scoreB: g.score_b,
    winner: g.winner,
    status: g.status,
    completedAt: g.completed_at,
    ruleEvents
  };
}

function formatGames(rows) {
  const ruleEventsByGameId = getRuleEventsByGameIds(rows.map(g => g.id));
  return rows.map(g => formatGame(g, ruleEventsByGameId));
}

function listVisibleGames() {
  return prepare(`SELECT g.* FROM games g INNER JOIN matches m ON g.match_id = m.id
    WHERE m.status IN (?, ?) ORDER BY g.match_id, g.game_no`).all(MATCH_STATUS.COMPLETED, MATCH_STATUS.IN_PROGRESS);
}

function listGamesByMatch(matchId) {
  return prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
}

function getGameById(gameId) {
  return prepare('SELECT * FROM games WHERE id = ?').get(gameId);
}

function getGameRuleContext(game) {
  const match = prepare('SELECT * FROM matches WHERE id = ?').get(game.match_id);
  const season = match?.season_id ? prepare('SELECT * FROM seasons WHERE id = ?').get(match.season_id) : null;
  const round = match?.round_id ? prepare('SELECT * FROM rounds WHERE id = ?').get(match.round_id) : null;
  const rule = getRule(season?.rule_id);
  const ctx = { game, match, season, round, ruleId: season?.rule_id || RULE_ID.STANDARD };
  ctx.gameConfig = rule.getGameConfig(ctx);
  ctx.rule = rule;
  return ctx;
}

function validation(message) {
  return { validationError: message };
}

function notFound(message) {
  return { notFound: message };
}

function refreshMatchAndRound(matchId) {
  recalculateMatch(matchId);
  const match = prepare('SELECT round_id FROM matches WHERE id = ?').get(matchId);
  if (match?.round_id) recalculateRound(match.round_id);
}

function updateScore(gameId, patch) {
  const game = getGameById(gameId);
  if (!game) return notFound('局不存在');
  if (game.status !== MATCH_STATUS.IN_PROGRESS) return validation('只能修改进行中的局');

  prepare('UPDATE games SET score_a = ?, score_b = ? WHERE id = ?')
    .run(patch.scoreA ?? game.score_a, patch.scoreB ?? game.score_b, gameId);

  return { row: getGameById(gameId) };
}

function validateGameEnd(ctx, input) {
  const result = ctx.rule.validateGameEnd(ctx, {
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    winner: input.winner,
    rulePayload: input.rulePayload || {}
  });
  return result.canEnd ? { result } : validation(result.reason);
}

function endGame(gameId, input = {}) {
  const game = getGameById(gameId);
  if (!game) return notFound('局不存在');
  if (game.status !== MATCH_STATUS.IN_PROGRESS) return validation('该局不是进行中状态');

  const scoreA = game.score_a || 0;
  const scoreB = game.score_b || 0;
  const ctx = getGameRuleContext(game);
  const endCheck = validateGameEnd(ctx, { ...input, scoreA, scoreB });
  if (endCheck.validationError) return endCheck;

  const row = transaction(() => {
    prepare('UPDATE games SET status=?, winner=?, score_a=?, score_b=?, completed_at=datetime(\'now\') WHERE id=?')
      .run(MATCH_STATUS.COMPLETED, endCheck.result.winner, scoreA, scoreB, gameId);

    ctx.rule.afterGameCompleted(ctx, endCheck.result, {
      scoreA,
      scoreB,
      winner: input.winner,
      rulePayload: input.rulePayload || {}
    });

    refreshMatchAndRound(game.match_id);
    return getGameById(gameId);
  });

  return { row };
}

function updateCompletedScore(gameId, input = {}) {
  const game = getGameById(gameId);
  if (!game) return notFound('局不存在');
  if (game.status !== MATCH_STATUS.COMPLETED) return validation('只能修改已完成的局');

  const ctx = getGameRuleContext(game);
  const endCheck = validateGameEnd(ctx, {
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    winner: input.winner,
    rulePayload: input.rulePayload || {}
  });
  if (endCheck.validationError) return endCheck;

  const row = transaction(() => {
    prepare('UPDATE games SET score_a=?, score_b=?, winner=? WHERE id=?')
      .run(input.scoreA, input.scoreB, endCheck.result.winner, gameId);

    ctx.rule.afterGameCompleted(ctx, endCheck.result, {
      scoreA: input.scoreA,
      scoreB: input.scoreB,
      winner: input.winner,
      rulePayload: input.rulePayload || {}
    });

    refreshMatchAndRound(game.match_id);
    return getGameById(gameId);
  });

  return { row };
}

function revertGame(gameId) {
  const game = getGameById(gameId);
  if (!game) return notFound('局不存在');
  if (game.status !== MATCH_STATUS.COMPLETED) return validation('只能撤回已完成的局');

  const matchGames = listGamesByMatch(game.match_id);
  const completedGames = matchGames.filter(g => g.status === MATCH_STATUS.COMPLETED);
  const lastCompleted = completedGames[completedGames.length - 1];
  if (lastCompleted.id !== game.id) {
    return validation('只能撤回最后一局（请先撤回后面的局）');
  }

  const row = transaction(() => {
    const ctx = getGameRuleContext(game);
    ctx.rule.onGameReverted(ctx);

    const laterGames = matchGames.filter(g => g.game_no > game.game_no);
    for (const laterGame of laterGames) {
      deleteRuleEventsForGame(laterGame.id);
      prepare('DELETE FROM games WHERE id = ?').run(laterGame.id);
    }

    prepare('UPDATE games SET status=?, winner=NULL, completed_at=NULL WHERE id=?').run(MATCH_STATUS.IN_PROGRESS, game.id);

    const match = prepare('SELECT * FROM matches WHERE id = ?').get(game.match_id);
    if (match.status === MATCH_STATUS.COMPLETED) {
      prepare('UPDATE matches SET status=?, winner=NULL WHERE id=?').run(MATCH_STATUS.IN_PROGRESS, game.match_id);
    }

    if (match.round_id) recalculateRound(match.round_id);
    return getGameById(gameId);
  });

  return { row };
}

function isGameSeasonCompleted(gameId) {
  const game = getGameById(gameId);
  if (!game) return false;
  const match = prepare('SELECT season_id FROM matches WHERE id = ?').get(game.match_id);
  if (!match || !match.season_id) return false;
  const season = prepare('SELECT status FROM seasons WHERE id = ?').get(match.season_id);
  return season?.status === 'completed';
}

module.exports = {
  formatGame,
  formatGames,
  listVisibleGames,
  listGamesByMatch,
  getGameById,
  updateScore,
  endGame,
  updateCompletedScore,
  revertGame,
  isGameSeasonCompleted
};
