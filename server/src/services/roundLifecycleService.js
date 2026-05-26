const { prepare } = require('../config/db');
const { getRule } = require('../rules');
const { MATCH_STATUS, ROUND_STATUS, SEASON_STATUS, RULE_ID } = require('../constants');

function recalculateRound(roundId) {
  const round = prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  if (!round) return null;

  const matches = prepare('SELECT * FROM matches WHERE round_id = ?').all(roundId);
  let status = ROUND_STATUS.PENDING;

  if (matches.length > 0) {
    const allDone = matches.every(m => m.status === MATCH_STATUS.COMPLETED);
    const anyLive = matches.some(m => m.status === MATCH_STATUS.IN_PROGRESS);

    if (allDone) status = ROUND_STATUS.COMPLETED;
    else if (anyLive) status = ROUND_STATUS.IN_PROGRESS;
  }

  if (round.status !== status) {
    prepare('UPDATE rounds SET status = ? WHERE id = ?').run(status, roundId);
  }

  const nextRound = prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  const season = nextRound?.season_id ? prepare('SELECT * FROM seasons WHERE id = ?').get(nextRound.season_id) : null;
  if (season) {
    const rule = getRule(season.rule_id);
    rule.afterRoundRecalculated({
      round: nextRound,
      season,
      ruleId: season.rule_id || RULE_ID.STANDARD,
      rule
    });

    // Sync season status with round states
    const allRounds = prepare('SELECT * FROM rounds WHERE season_id = ?').all(season.id);
    const allRoundsDone = allRounds.length >= season.total_rounds &&
      allRounds.every(r => r.status === ROUND_STATUS.COMPLETED);

    if (allRoundsDone && season.status !== SEASON_STATUS.COMPLETED) {
      prepare('UPDATE seasons SET status = ? WHERE id = ?').run(SEASON_STATUS.COMPLETED, season.id);
    } else if (!allRoundsDone && season.status === SEASON_STATUS.COMPLETED) {
      const newStatus = allRounds.some(r => r.status === ROUND_STATUS.IN_PROGRESS)
        ? SEASON_STATUS.ONGOING : SEASON_STATUS.PENDING;
      prepare('UPDATE seasons SET status = ? WHERE id = ?').run(newStatus, season.id);
    }
  }

  return nextRound;
}

function markRoundInProgress(roundId) {
  prepare('UPDATE rounds SET status = ? WHERE id = ? AND status = ?')
    .run(ROUND_STATUS.IN_PROGRESS, roundId, ROUND_STATUS.PENDING);
}

module.exports = { recalculateRound, markRoundInProgress };
