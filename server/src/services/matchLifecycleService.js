const { prepare } = require('../config/db');
const { checkMatchComplete } = require('./scoringService');
const { MATCH_STATUS } = require('../constants');

function getMatch(matchId) {
  return prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
}

function getMatchGames(matchId) {
  return prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
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
