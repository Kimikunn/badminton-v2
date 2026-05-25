const { prepare, transaction } = require('../config/db');
const { createRoundWithMatches, validateRoundPairings } = require('./roundCreationService');
const { deleteRuleEventsForRound } = require('./ruleEventService');
const { buildUpdate } = require('../utils/updateBuilder');
const { MATCH_STATUS, ROUND_STATUS } = require('../constants');

function formatRound(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    roundNo: row.round_no,
    status: row.status,
    venueManagerId: row.venue_manager_id,
    createdAt: row.created_at
  };
}

function listRounds(seasonId) {
  return seasonId
    ? prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY round_no').all(seasonId)
    : prepare('SELECT * FROM rounds ORDER BY season_id, round_no').all();
}

function getRoundById(id) {
  return prepare('SELECT * FROM rounds WHERE id=?').get(id);
}

function getSeasonById(id) {
  return prepare('SELECT * FROM seasons WHERE id=?').get(id);
}

function getRoundBySeasonAndNo(seasonId, roundNo) {
  return prepare('SELECT id FROM rounds WHERE season_id=? AND round_no=?').get(seasonId, roundNo);
}

function getUnfinishedRound(seasonId) {
  return prepare(`
    SELECT
      r.round_no,
      r.status,
      COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND m.status != ? THEN 1 ELSE 0 END), 0) AS unfinished_matches
    FROM rounds r
    LEFT JOIN matches m ON m.round_id = r.id
    WHERE r.season_id = ?
    GROUP BY r.id
    HAVING r.status != ? OR unfinished_matches > 0
    ORDER BY r.round_no
    LIMIT 1
  `).get(MATCH_STATUS.COMPLETED, seasonId, ROUND_STATUS.COMPLETED);
}

function createRound(data) {
  return createRoundWithMatches(data);
}

function updateRound(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    status: 'status',
    venueManagerId: 'venue_manager_id'
  });

  if (sets.length) {
    params.push(id);
    prepare(`UPDATE rounds SET ${sets.join(',')} WHERE id=?`).run(...params);
  }

  return getRoundById(id);
}

function deleteRound(round) {
  return transaction(() => {
    const matches = prepare('SELECT id FROM matches WHERE round_id=?').all(round.id);
    deleteRuleEventsForRound(round.id);
    for (const match of matches) {
      prepare('DELETE FROM games WHERE match_id=?').run(match.id);
    }
    prepare('DELETE FROM matches WHERE round_id=?').run(round.id);
    prepare('DELETE FROM rounds WHERE id=?').run(round.id);
    return { deleted: true, roundNo: round.round_no, matchCount: matches.length };
  });
}

module.exports = {
  formatRound,
  listRounds,
  getRoundById,
  getSeasonById,
  getRoundBySeasonAndNo,
  getUnfinishedRound,
  validateRoundPairings,
  createRound,
  updateRound,
  deleteRound
};
