const { prepare } = require('../config/db');
const { getRule } = require('../rules');
const { checkMatchComplete } = require('./scoringService');
const { MATCH_STATUS, RULE_ID } = require('../constants');

function getMatch(matchId) {
  return prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
}

function getMatchGames(matchId) {
  return prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
}

// 局从 pending 进入 in_progress 时调用规则插件的 onGameStarted，
// 应用开局分（例如 S6 黛青形态王所在方 2:0 开局）。
function applyGameStartRules(gameId) {
  const game = prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game || game.score_a || game.score_b) return;

  const match = getMatch(game.match_id);
  if (!match?.season_id) return;

  const season = prepare('SELECT * FROM seasons WHERE id = ?').get(match.season_id);
  const round = match.round_id ? prepare('SELECT * FROM rounds WHERE id = ?').get(match.round_id) : null;
  const rule = getRule(season?.rule_id);
  const ctx = { game, match, season, round, ruleId: season?.rule_id || RULE_ID.STANDARD };
  ctx.gameConfig = rule.getGameConfig(ctx);
  ctx.rule = rule;

  const opening = rule.onGameStarted(ctx);
  if (!opening) return;

  const scoreA = Number(opening.scoreA || 0);
  const scoreB = Number(opening.scoreB || 0);
  if (scoreA <= 0 && scoreB <= 0) return;

  prepare('UPDATE games SET score_a = ?, score_b = ? WHERE id = ?').run(scoreA, scoreB, gameId);
}

function ensureMatchGames(matchId) {
  const match = getMatch(matchId);
  if (!match) return [];

  const bestOf = match.best_of || 3;
  const existing = getMatchGames(matchId);
  const byNo = new Map(existing.map(g => [g.game_no, g]));

  for (let i = 1; i <= bestOf; i++) {
    if (byNo.has(i)) continue;
    const gid = `${matchId}-G${i}`;
    prepare('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)')
      .run(gid, matchId, i, MATCH_STATUS.PENDING);
  }

  return getMatchGames(matchId);
}

function recalculateMatch(matchId) {
  const match = getMatch(matchId);
  if (!match) return;

  const games = ensureMatchGames(matchId);
  const completed = games.filter(g => g.status === MATCH_STATUS.COMPLETED);
  const bestOf = match.best_of || 3;
  const { isComplete, winner } = checkMatchComplete(completed, bestOf, match.match_format);

  if (isComplete) {
    prepare('UPDATE matches SET status = ?, winner = ? WHERE id = ?')
      .run(MATCH_STATUS.COMPLETED, winner, matchId);
    return;
  }

  const activeGames = games.filter(g => g.status === MATCH_STATUS.IN_PROGRESS);
  let active = activeGames[0];

  for (const extra of activeGames.slice(1)) {
    prepare('UPDATE games SET status = ? WHERE id = ?').run(MATCH_STATUS.PENDING, extra.id);
  }

  if (!active) {
    active = games.find(g => g.status === MATCH_STATUS.PENDING);
    if (active) {
      prepare('UPDATE games SET status = ? WHERE id = ?').run(MATCH_STATUS.IN_PROGRESS, active.id);
      applyGameStartRules(active.id);
    }
  }

  const nextStatus = active || completed.length > 0 ? MATCH_STATUS.IN_PROGRESS : MATCH_STATUS.PENDING;
  prepare('UPDATE matches SET status = ?, winner = NULL WHERE id = ?')
    .run(nextStatus, matchId);
}

module.exports = {
  ensureMatchGames,
  recalculateMatch
};
