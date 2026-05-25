const { prepare, transaction } = require('../config/db');
const { ensureMatchGames, recalculateMatch } = require('./matchLifecycleService');
const { markRoundInProgress, recalculateRound } = require('./roundLifecycleService');
const { deleteRuleEventsForMatch } = require('./ruleEventService');
const { normalizeMatchFormat } = require('../utils/validators');
const { parseJson, stringifyJson } = require('../utils/json');
const { buildUpdate } = require('../utils/updateBuilder');
const { friendlyMatchId } = require('../utils/id');
const { MATCH_FORMAT, MATCH_STATUS } = require('../constants');

function inferMatchFormat(bestOf) {
  return normalizeMatchFormat(bestOf).matchFormat || MATCH_FORMAT.BO3;
}

function formatMatch(m) {
  return {
    id: m.id,
    seasonId: m.season_id,
    roundId: m.round_id,
    type: m.type,
    teamA: parseJson(m.team_a, []),
    teamB: parseJson(m.team_b, []),
    bestOf: m.best_of,
    matchFormat: m.match_format || inferMatchFormat(m.best_of),
    status: m.status,
    winner: m.winner,
    date: m.date,
    venueId: m.venue_id,
    createdAt: m.created_at
  };
}

function listMatches() {
  return prepare('SELECT * FROM matches ORDER BY created_at DESC').all();
}

function getMatchById(matchId) {
  return prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
}

function getRoundById(roundId) {
  return prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
}

function getSeasonById(seasonId) {
  return prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
}

function createMatch(data) {
  const matchId = data.id || friendlyMatchId();
  return transaction(() => {
    prepare(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, match_format, date, venue_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        matchId,
        data.seasonId || null,
        data.roundId || null,
        data.type || 'doubles',
        stringifyJson(data.teamA),
        stringifyJson(data.teamB),
        data.bestOf,
        data.matchFormat,
        data.date || null,
        data.venueId || null
      );

    return getMatchById(matchId);
  });
}

function updateMatch(matchId, patch) {
  const { sets, params } = buildUpdate(patch, {
    teamA: { column: 'team_a', transform: stringifyJson },
    teamB: { column: 'team_b', transform: stringifyJson },
    date: 'date',
    venueId: 'venue_id'
  });

  if (patch.matchFormatData) {
    sets.push('best_of=?'); params.push(patch.matchFormatData.bestOf);
    sets.push('match_format=?'); params.push(patch.matchFormatData.matchFormat);
  }

  if (sets.length > 0) {
    params.push(matchId);
    prepare(`UPDATE matches SET ${sets.join(',')} WHERE id=?`).run(...params);
  }

  return getMatchById(matchId);
}

function deleteMatch(match) {
  return transaction(() => {
    const games = prepare('SELECT id FROM games WHERE match_id = ?').all(match.id);
    deleteRuleEventsForMatch(match.id);
    for (const game of games) {
      prepare('DELETE FROM games WHERE id = ?').run(game.id);
    }
    prepare('DELETE FROM matches WHERE id = ?').run(match.id);

    if (match.round_id) recalculateRound(match.round_id);

    return { deleted: true, gameCount: games.length };
  });
}

function startExistingMatch(match) {
  return transaction(() => {
    ensureMatchGames(match.id);
    recalculateMatch(match.id);

    if (match.round_id) markRoundInProgress(match.round_id);

    return getMatchById(match.id);
  });
}

function cancelExistingMatch(match) {
  return transaction(() => {
    deleteRuleEventsForMatch(match.id);
    prepare('DELETE FROM games WHERE match_id = ?').run(match.id);
    prepare('UPDATE matches SET status=?, winner=NULL WHERE id=?').run(MATCH_STATUS.PENDING, match.id);

    if (match.round_id) recalculateRound(match.round_id);

    return getMatchById(match.id);
  });
}

module.exports = {
  formatMatch,
  listMatches,
  getMatchById,
  getRoundById,
  getSeasonById,
  createMatch,
  updateMatch,
  deleteMatch,
  startExistingMatch,
  cancelExistingMatch
};
