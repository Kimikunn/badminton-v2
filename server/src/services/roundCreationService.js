const { prepare, transaction } = require('../config/db');
const { applyBeforeRoundSetup } = require('./seasonRuleLifecycleService');
const { parseJson, stringifyJson } = require('../utils/json');
const { roundId: createRoundId } = require('../utils/id');
const { MATCH_FORMAT, MATCH_STATUS, ROUND_STATUS, RULE_ID, SEASON_STATUS } = require('../constants');

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

function formatSeason(row) {
  return {
    id: row.id,
    name: row.name,
    totalRounds: row.total_rounds,
    bestOf: row.best_of,
    status: row.status,
    participants: parseJson(row.participants, []),
    ruleId: row.rule_id,
    comebackData: parseJson(row.comeback_data, {}),
    color: row.color,
    createdAt: row.created_at
  };
}

function formatMatch(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    roundId: row.round_id,
    type: row.type,
    teamA: parseJson(row.team_a, []),
    teamB: parseJson(row.team_b, []),
    bestOf: row.best_of,
    matchFormat: row.match_format,
    status: row.status,
    winner: row.winner,
    date: row.date,
    venueId: row.venue_id,
    createdAt: row.created_at
  };
}

function createRoundWithMatches({ id, season, roundNo, beforeRoundSetup, pairings }) {
  return transaction(() => {
    const appliedBeforeRoundSetup = applyBeforeRoundSetup(season, roundNo, beforeRoundSetup);

    const roundId = id || createRoundId();
    prepare('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?,?,?,?)')
      .run(roundId, season.id, roundNo, ROUND_STATUS.PENDING);
    if (season.status === SEASON_STATUS.PENDING) {
      prepare('UPDATE seasons SET status = ? WHERE id = ?').run(SEASON_STATUS.ONGOING, season.id);
      season.status = SEASON_STATUS.ONGOING;
    }

    const participants = parseJson(season.participants, []);
    if (participants.length >= 4) {
      createMatchesForRound({ season, roundId, roundNo, participants, pairings });
    }

    prepare('UPDATE rounds SET status=? WHERE id=?').run(ROUND_STATUS.IN_PROGRESS, roundId);

    const row = prepare('SELECT * FROM rounds WHERE id=?').get(roundId);
    const matches = prepare('SELECT * FROM matches WHERE round_id=? ORDER BY id').all(roundId);
    const updatedSeason = prepare('SELECT * FROM seasons WHERE id=?').get(season.id);
    return {
      ...formatRound(row),
      matchCount: matches.length,
      matches: matches.map(formatMatch),
      season: formatSeason(updatedSeason),
      beforeRoundSetup: appliedBeforeRoundSetup
    };
  });
}

function createMatchesForRound({ season, roundId, roundNo, participants, pairings = null }) {
  const isS4Combo = season.rule_id === RULE_ID.S4 && roundNo >= 5;
  if (isS4Combo) {
    const pairs = getS4ComboPairing(roundNo, participants);
    if (!pairs) return;
    insertRoundMatch({
      id: `${roundId}-M1`,
      seasonId: season.id,
      roundId,
      teamA: pairs.teamA,
      teamB: pairs.teamB,
      bestOf: 7,
      matchFormat: MATCH_FORMAT.PA7
    });
    return;
  }

  const roundPairings = Array.isArray(pairings) && pairings.length
    ? pairings
    : generatePairings(participants);

  for (let i = 0; i < roundPairings.length; i += 1) {
    const bestOf = season.best_of || 3;
    insertRoundMatch({
      id: `${roundId}-M${i + 1}`,
      seasonId: season.id,
      roundId,
      teamA: roundPairings[i].teamA,
      teamB: roundPairings[i].teamB,
      bestOf,
      matchFormat: bestOf === 1 ? MATCH_FORMAT.BO1 : MATCH_FORMAT.BO3
    });
  }
}

function insertRoundMatch({ id, seasonId, roundId, teamA, teamB, bestOf, matchFormat }) {
  prepare(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, match_format, status)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, seasonId, roundId, 'doubles', stringifyJson(teamA), stringifyJson(teamB), bestOf, matchFormat, MATCH_STATUS.PENDING);
}

function generatePairings(participants) {
  if (participants.length !== 4) return [];
  const [a, b, c, d] = participants;
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] }
  ];
}

function getS4ComboPairing(roundNo, participants) {
  const sorted = [...participants].sort();
  const combos = {
    5: { teamA: [sorted[0], sorted[1]], teamB: [sorted[2], sorted[3]] },
    6: { teamA: [sorted[0], sorted[2]], teamB: [sorted[1], sorted[3]] },
    7: { teamA: [sorted[0], sorted[3]], teamB: [sorted[1], sorted[2]] }
  };
  return combos[roundNo] || combos[5];
}

function isS4ComboRound(season, roundNo) {
  return season.rule_id === RULE_ID.S4 && Number(roundNo) >= 5;
}

function validateRoundPairings(season, roundNo, pairings) {
  if (pairings === undefined || pairings === null) return null;
  if (!Array.isArray(pairings)) return '对阵必须是数组';
  if (isS4ComboRound(season, roundNo)) return 'S4组合赛轮次不支持随机对阵';
  if (pairings.length !== 3) return '标准轮次必须包含 3 场对阵';

  const participants = parseJson(season.participants, []);
  const participantSet = new Set(participants);
  const teamKeys = new Set();

  for (let i = 0; i < pairings.length; i += 1) {
    const pairing = pairings[i] || {};
    const teamA = Array.isArray(pairing.teamA) ? pairing.teamA : [];
    const teamB = Array.isArray(pairing.teamB) ? pairing.teamB : [];
    if (teamA.length !== 2 || teamB.length !== 2) return `M${i + 1} 必须是双打对阵`;

    const players = [...teamA, ...teamB].map(String);
    if (new Set(players).size !== 4) return `M${i + 1} 存在重复选手`;
    if (players.some(playerId => !participantSet.has(playerId))) return `M${i + 1} 包含非本赛季选手`;

    for (const team of [teamA, teamB]) {
      const key = [...team].map(String).sort().join('|');
      if (teamKeys.has(key)) return '同一轮内搭档组合不能重复';
      teamKeys.add(key);
    }
  }

  const expectedTeamCount = participants.length === 4 ? 6 : pairings.length * 2;
  if (teamKeys.size !== expectedTeamCount) return '对阵需要覆盖完整的搭档轮换';

  return null;
}

module.exports = {
  createRoundWithMatches,
  generatePairings,
  getS4ComboPairing,
  validateRoundPairings
};
