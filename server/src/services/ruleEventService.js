const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { MATCH_STATUS, ROUND_STATUS, RULE_ID, WINNER_SIDE } = require('../constants');

function eventId({ gameId, type }) {
  return `GRE-${gameId}-${type}`;
}

function deleteGameRuleEvents(gameId, ruleId) {
  prepare('DELETE FROM game_rule_events WHERE game_id = ? AND rule_id = ?').run(gameId, ruleId);
}

function deleteRuleEventsForGame(gameId) {
  prepare('DELETE FROM game_rule_events WHERE game_id = ?').run(gameId);
}

function deleteRuleEventsForMatch(matchId) {
  prepare('DELETE FROM game_rule_events WHERE match_id = ?').run(matchId);
}

function deleteRuleEventsForRound(roundId) {
  prepare('DELETE FROM game_rule_events WHERE round_id = ?').run(roundId);
}

function deleteRuleEventsForSeason(seasonId) {
  prepare('DELETE FROM game_rule_events WHERE season_id = ?').run(seasonId);
}

function insertGameRuleEvent({ seasonId, roundId, matchId, gameId, ruleId, timing, type, payload }) {
  prepare(`INSERT INTO game_rule_events (id, season_id, round_id, match_id, game_id, rule_id, timing, type, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      eventId({ gameId, type }),
      seasonId,
      roundId,
      matchId,
      gameId,
      ruleId,
      timing,
      type,
      stringifyJson(payload || {})
    );
}

function formatGameRuleEvent(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    roundId: row.round_id,
    matchId: row.match_id,
    gameId: row.game_id,
    ruleId: row.rule_id,
    timing: row.timing,
    type: row.type,
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at
  };
}

function getRuleEventsByGameIds(gameIds = []) {
  const ids = [...new Set(gameIds.filter(Boolean))];
  if (!ids.length) return {};

  const placeholders = ids.map(() => '?').join(', ');
  const rows = prepare(`SELECT * FROM game_rule_events WHERE game_id IN (${placeholders}) ORDER BY created_at, id`)
    .all(...ids);

  return rows.reduce((acc, row) => {
    const event = formatGameRuleEvent(row);
    if (!acc[event.gameId]) acc[event.gameId] = [];
    acc[event.gameId].push(event);
    return acc;
  }, {});
}

function getRuleEventsBySeason(seasonId, ruleId, type) {
  return prepare('SELECT * FROM game_rule_events WHERE season_id = ? AND rule_id = ? AND type = ? ORDER BY created_at, id')
    .all(seasonId, ruleId, type);
}

function recalculateS5PierceCounts(seasonId) {
  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return;

  const data = parseJson(season.comeback_data, {});
  const s5 = data.s5 || {};
  const counts = {};

  for (const event of getRuleEventsBySeason(seasonId, RULE_ID.S5, 'pierce')) {
    const payload = parseJson(event.payload, {});
    for (const playerId of payload.players || []) {
      counts[playerId] = (counts[playerId] || 0) + 1;
    }
  }

  const nextData = {
    ...data,
    s5: {
      ...s5,
      roundDice: s5.roundDice || {},
      pierceCounts: counts,
      debtRecords: s5.debtRecords || {},
      pauseUses: Array.isArray(s5.pauseUses) ? s5.pauseUses : [],
      debtSettlements: s5.debtSettlements || {}
    }
  };

  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(stringifyJson(nextData), seasonId);
}

function isS5MutationDice(dice) {
  const value = Number(dice?.dice || dice || 0);
  return dice?.mode === 'mutation' || value === 1 || value === 6;
}

function compareDebtRanking(a, b) {
  if (b.bigScore !== a.bigScore) return b.bigScore - a.bigScore;
  if (b.smallScore !== a.smallScore) return b.smallScore - a.smallScore;
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  return String(a.playerId).localeCompare(String(b.playerId));
}

function addTeamPoints(scores, team, points, gameWinner) {
  for (const playerId of team) {
    if (!scores[playerId]) scores[playerId] = { playerId, bigScore: 0, smallScore: 0, totalPoints: 0 };
    scores[playerId].totalPoints += points;
    if (gameWinner) scores[playerId].smallScore += 1;
  }
}

function calculateRoundDebtRecord(round, participants = []) {
  const scores = {};
  for (const playerId of participants) {
    scores[playerId] = { playerId, bigScore: 0, smallScore: 0, totalPoints: 0 };
  }

  const matches = prepare('SELECT * FROM matches WHERE round_id = ? AND status = ? ORDER BY id')
    .all(round.id, MATCH_STATUS.COMPLETED);

  for (const match of matches) {
    const teamA = parseJson(match.team_a, []);
    const teamB = parseJson(match.team_b, []);
    const winnerTeam = match.winner;

    for (const playerId of winnerTeam === WINNER_SIDE.A ? teamA : teamB) {
      if (!scores[playerId]) scores[playerId] = { playerId, bigScore: 0, smallScore: 0, totalPoints: 0 };
      scores[playerId].bigScore += 1;
    }

    const games = prepare('SELECT * FROM games WHERE match_id = ? AND status = ? ORDER BY game_no')
      .all(match.id, MATCH_STATUS.COMPLETED);
    for (const game of games) {
      addTeamPoints(scores, teamA, Number(game.score_a || 0), game.winner === WINNER_SIDE.A);
      addTeamPoints(scores, teamB, Number(game.score_b || 0), game.winner === WINNER_SIDE.B);
    }
  }

  const rankings = Object.values(scores).sort(compareDebtRanking)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  if (rankings.length < 4) return null;

  return {
    roundId: round.id,
    roundNo: round.round_no,
    rankings,
    creditors: rankings.slice(0, 2).map(row => row.playerId),
    debtors: rankings.slice(2, 4).map(row => row.playerId)
  };
}

function recalculateS5DebtRecords(seasonId) {
  const season = prepare('SELECT participants, comeback_data FROM seasons WHERE id = ?').get(seasonId);
  if (!season) return;

  const data = parseJson(season.comeback_data, {});
  const s5 = data.s5 || {};
  const participants = parseJson(season.participants, []);
  const debtRecords = {};

  const rounds = prepare('SELECT * FROM rounds WHERE season_id = ? AND status = ? ORDER BY round_no')
    .all(seasonId, ROUND_STATUS.COMPLETED);

  for (const round of rounds) {
    const dice = s5.roundDice?.[String(round.round_no)];
    if (!isS5MutationDice(dice)) continue;

    const record = calculateRoundDebtRecord(round, participants);
    if (record) debtRecords[String(round.round_no)] = record;
  }

  const nextData = {
    ...data,
    s5: {
      ...s5,
      roundDice: s5.roundDice || {},
      pierceCounts: s5.pierceCounts || {},
      debtRecords,
      pauseUses: Array.isArray(s5.pauseUses) ? s5.pauseUses : [],
      debtSettlements: s5.debtSettlements || {}
    }
  };

  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(stringifyJson(nextData), seasonId);
}

module.exports = {
  deleteGameRuleEvents,
  deleteRuleEventsForGame,
  deleteRuleEventsForMatch,
  deleteRuleEventsForRound,
  deleteRuleEventsForSeason,
  insertGameRuleEvent,
  formatGameRuleEvent,
  getRuleEventsByGameIds,
  getRuleEventsBySeason,
  recalculateS5PierceCounts,
  recalculateS5DebtRecords
};
