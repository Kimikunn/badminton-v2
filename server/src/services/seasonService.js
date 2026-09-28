const { prepare, transaction } = require('../config/db');
const { deleteRuleEventsForSeason, recalculateS5DebtRecords } = require('./ruleEventService');
const { parseJson, stringifyJson } = require('../utils/json');
const { buildUpdate } = require('../utils/updateBuilder');
const { seasonId } = require('../utils/id');
const { RULE_ID } = require('../constants');

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
    championPlayerId: row.champion_player_id || null,
    createdAt: row.created_at
  };
}

function getRawSeasonById(id) {
  return prepare('SELECT * FROM seasons WHERE id = ?').get(id);
}

function refreshSeasonDerivedData(row) {
  if (!row) return row;
  if (row.rule_id !== RULE_ID.S5) return row;

  recalculateS5DebtRecords(row.id);
  return getRawSeasonById(row.id);
}

function listSeasons() {
  return prepare('SELECT * FROM seasons ORDER BY created_at DESC').all()
    .map(refreshSeasonDerivedData);
}

function getSeasonById(id) {
  return refreshSeasonDerivedData(getRawSeasonById(id));
}

function missingPlayerIds(playerIds = []) {
  const missing = [];
  for (const playerId of playerIds) {
    const player = prepare('SELECT id FROM players WHERE id = ?').get(playerId);
    if (!player) missing.push(playerId);
  }
  return missing;
}

function createSeason(data) {
  const id = data.id || seasonId();
  // S6+ 延长赛：建季即生成每轮奇招幸运数（1-6），并落盘重置骰子持有者
  //（来源 S6 前两名组合的选手，由创建方传入 resetDicePlayers）
  let comebackData = data.comebackData ? { ...data.comebackData } : null;
  if (data.ruleId === RULE_ID.S6P) {
    comebackData = comebackData || {};
    const s6p = { ...(comebackData.s6p || {}) };
    s6p.lucky = { ...(s6p.lucky || {}) };
    for (const roundNo of [1, 2]) {
      if (!Number.isInteger(s6p.lucky[String(roundNo)])) {
        s6p.lucky[String(roundNo)] = 1 + Math.floor(Math.random() * 6);
      }
    }
    s6p.resetDice = Array.isArray(data.resetDicePlayers) ? data.resetDicePlayers : [];
    comebackData.s6p = s6p;
  }
  prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id, comeback_data, color)
    VALUES (?, ?, ?, ?, 'ongoing', ?, ?, ?, ?)`)
    .run(
      id,
      data.name,
      data.totalRounds || (data.ruleId === RULE_ID.S5 ? 9 : data.ruleId === RULE_ID.S6P ? 2 : 7),
      data.bestOf || 3,
      stringifyJson(data.participants || []),
      data.ruleId || RULE_ID.STANDARD,
      comebackData ? stringifyJson(comebackData) : null,
      data.color || null
    );

  return getSeasonById(id);
}

function updateSeason(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    name: 'name',
    totalRounds: 'total_rounds',
    bestOf: 'best_of',
    status: 'status',
    participants: { column: 'participants', transform: stringifyJson },
    ruleId: 'rule_id',
    comebackData: { column: 'comeback_data', transform: stringifyJson },
    color: 'color'
  });

  if (sets.length > 0) {
    params.push(id);
    prepare(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getSeasonById(id);
}

function deleteSeason(season) {
  return transaction(() => {
    const matches = prepare('SELECT id FROM matches WHERE season_id = ?').all(season.id);
    deleteRuleEventsForSeason(season.id);
    for (const match of matches) {
      prepare('DELETE FROM games WHERE match_id = ?').run(match.id);
    }
    prepare('DELETE FROM matches WHERE season_id = ?').run(season.id);
    prepare('DELETE FROM rounds WHERE season_id = ?').run(season.id);
    prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
    return { deleted: true, name: season.name, matchCount: matches.length };
  });
}

module.exports = {
  formatSeason,
  listSeasons,
  getSeasonById,
  missingPlayerIds,
  createSeason,
  updateSeason,
  deleteSeason
};
