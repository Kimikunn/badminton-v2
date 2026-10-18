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
  if (isComboRound(season, roundNo)) {
    const pairs = getComboPairing(season, roundNo, participants);
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
  return getComboPairingFromOrder(roundNo, [...participants].sort());
}

// S4/S6 下篇固定轮换（5-7 轮）：5=AB/CD、6=AC/BD、7=AD/BC。
function getComboPairingFromOrder(roundNo, ordered) {
  const combos = {
    5: { teamA: [ordered[0], ordered[1]], teamB: [ordered[2], ordered[3]] },
    6: { teamA: [ordered[0], ordered[2]], teamB: [ordered[1], ordered[3]] },
    7: { teamA: [ordered[0], ordered[3]], teamB: [ordered[1], ordered[2]] }
  };
  return combos[roundNo] || combos[5];
}

// S6+ 延长赛固定轮换（双循环 6 轮）：循环位 ((n-1) % 3)+1 → 1=AB/CD、2=AC/BD、3=AD/BC；
// 故 4/5/6 分别重复 1/2/3。与 rules/s6p.js 的 COMBO_LABELS_BY_ROUND 一一对应。
function getS6pComboPairingFromOrder(roundNo, ordered) {
  const cycle = ((Number(roundNo) - 1) % 3 + 3) % 3 + 1;
  const combos = {
    1: { teamA: [ordered[0], ordered[1]], teamB: [ordered[2], ordered[3]] },
    2: { teamA: [ordered[0], ordered[2]], teamB: [ordered[1], ordered[3]] },
    3: { teamA: [ordered[0], ordered[3]], teamB: [ordered[1], ordered[2]] }
  };
  return combos[cycle] || combos[1];
}

// 组合种子顺序：S6 优先读 comeback_data.s6.seeds（上篇前 4，
// 灵魂契合首次投掷时持久化），缺省退化为选手 ID 排序（同 S4 口径）。
function getComboSeedOrder(season, participants) {
  if (season.rule_id === RULE_ID.S6P) {
    const seeds = parseJson(season.comeback_data, {}).s6p?.seeds;
    if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) {
      return [seeds.A, seeds.B, seeds.C, seeds.D];
    }
  }
  if (season.rule_id === RULE_ID.S6) {
    const seeds = parseJson(season.comeback_data, {}).s6?.seeds;
    if (seeds?.A && seeds?.B && seeds?.C && seeds?.D) {
      return [seeds.A, seeds.B, seeds.C, seeds.D];
    }
  }
  return [...participants].sort();
}

function getComboPairing(season, roundNo, participants) {
  const ordered = getComboSeedOrder(season, participants);
  if (season.rule_id === RULE_ID.S6P) return getS6pComboPairingFromOrder(roundNo, ordered);
  return getComboPairingFromOrder(roundNo, ordered);
}

function isComboRound(season, roundNo) {
  if (season.rule_id === RULE_ID.S6P) {
    return Number(roundNo) >= 1 && Number(roundNo) <= 6;
  }
  return (season.rule_id === RULE_ID.S4 || season.rule_id === RULE_ID.S6) && Number(roundNo) >= 5;
}

function validateRoundPairings(season, roundNo, pairings) {
  if (pairings === undefined || pairings === null) return null;
  if (!Array.isArray(pairings)) return '对阵必须是数组';
  if (isComboRound(season, roundNo)) {
    if (season.rule_id === RULE_ID.S6P) return 'S6+组合赛轮次不支持随机对阵';
    return season.rule_id === RULE_ID.S6 ? 'S6组合赛轮次不支持随机对阵' : 'S4组合赛轮次不支持随机对阵';
  }
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
