const { prepare, transaction } = require('../config/db');
const { getRule } = require('../rules');
const { parseJson, stringifyJson } = require('../utils/json');
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
      const { champion, comboChampion } = calcSeasonChampion(season, allRounds);
      if (comboChampion && (season.rule_id === RULE_ID.S4 || season.rule_id === RULE_ID.S6)) {
        const comeback = parseJson(season.comeback_data, {});
        const ruleKey = season.rule_id;
        comeback[ruleKey] = comeback[ruleKey] || {};
        comeback[ruleKey].comboChampion = comboChampion;
        prepare('UPDATE seasons SET status = ?, champion_player_id = ?, comeback_data = ? WHERE id = ?')
          .run(SEASON_STATUS.COMPLETED, champion, stringifyJson(comeback), season.id);
      } else {
        prepare('UPDATE seasons SET status = ?, champion_player_id = ? WHERE id = ?')
          .run(SEASON_STATUS.COMPLETED, champion, season.id);
      }
    } else if (!allRoundsDone && season.status === SEASON_STATUS.COMPLETED) {
      const newStatus = allRounds.some(r => r.status === ROUND_STATUS.IN_PROGRESS)
        ? SEASON_STATUS.ONGOING : SEASON_STATUS.PENDING;
      prepare('UPDATE seasons SET status = ? WHERE id = ?').run(newStatus, season.id);
    }
  }

  return nextRound;
}

/**
 * Calculate season champion by counting match wins per participant.
 * Returns the player ID with the highest win count, or null if no completed matches.
 */
function calcSeasonChampion(season, allRounds) {
  const participants = parseJson(season.participants, []);
  if (!participants.length) return { champion: null, comboChampion: null };

  // S4/S6：个人冠军只看上篇（1-4 轮）胜场；最强组合看下篇（5-7 轮）。
  // 注意：S6 官方最强组合按星尘排名，由客户端计算（复用 S4 星尘口径）；
  // 服务端此处镜像 S4 的“下篇胜场最多组合”写法，仅用于 Hall of Fame 展示。
  const hasComboPhase = season.rule_id === RULE_ID.S4 || season.rule_id === RULE_ID.S6;
  let matches;
  if (hasComboPhase) {
    const topRoundIds = (allRounds || []).filter(r => r.round_no <= 4).map(r => r.id);
    if (!topRoundIds.length) {
      matches = prepare('SELECT team_a, team_b, winner FROM matches WHERE season_id = ? AND status = ?')
        .all(season.id, MATCH_STATUS.COMPLETED);
    } else {
      const ph = topRoundIds.map(() => '?').join(',');
      matches = prepare(`SELECT team_a, team_b, winner FROM matches WHERE season_id = ? AND status = ? AND round_id IN (${ph})`)
        .all(season.id, MATCH_STATUS.COMPLETED, ...topRoundIds);
    }
  } else {
    matches = prepare('SELECT team_a, team_b, winner FROM matches WHERE season_id = ? AND status = ?')
      .all(season.id, MATCH_STATUS.COMPLETED);
  }
  if (!matches.length) return { champion: null, comboChampion: null };

  const wins = {};
  for (const pid of participants) wins[pid] = 0;
  for (const m of matches) {
    if (!m.winner) continue;
    const winnerTeam = m.winner === 'a' ? parseJson(m.team_a, []) : parseJson(m.team_b, []);
    for (const pid of winnerTeam) { if (wins[pid] !== undefined) wins[pid]++; }
  }
  let champion = null, maxWins = -1;
  for (const pid of participants) {
    if (wins[pid] > maxWins) { maxWins = wins[pid]; champion = pid; }
  }

  let comboChampion = null;
  if (hasComboPhase) {
    const comboRoundIds = (allRounds || []).filter(r => r.round_no >= 5).map(r => r.id);
    if (comboRoundIds.length) {
      const cph = comboRoundIds.map(() => '?').join(',');
      const comboMatches = prepare(`SELECT team_a, team_b, winner FROM matches WHERE season_id = ? AND status = ? AND round_id IN (${cph})`)
        .all(season.id, MATCH_STATUS.COMPLETED, ...comboRoundIds);
      const pairWins = {};
      for (const m of comboMatches) {
        if (!m.winner) continue;
        const winnerPair = (m.winner === 'a' ? parseJson(m.team_a, []) : parseJson(m.team_b, [])).sort();
        const key = winnerPair.join('|');
        pairWins[key] = (pairWins[key] || 0) + 1;
      }
      let bestPair = null, bestWins = -1;
      for (const [key, w] of Object.entries(pairWins)) {
        if (w > bestWins) { bestWins = w; bestPair = key; }
      }
      if (bestPair) comboChampion = { players: bestPair.split('|'), wins: bestWins };
    }
  }
  return { champion, comboChampion };
}

function markRoundInProgress(roundId) {
  prepare('UPDATE rounds SET status = ? WHERE id = ? AND status = ?')
    .run(ROUND_STATUS.IN_PROGRESS, roundId, ROUND_STATUS.PENDING);
}

module.exports = { recalculateRound, markRoundInProgress };
