const { prepare } = require('../config/db');
const { getRule } = require('../rules');
const { RULE_ID } = require('../constants');
const { prefixedId } = require('../utils/id');
const { parseJson, stringifyJson } = require('../utils/json');
const { recalculateS5DebtRecords } = require('./ruleEventService');

function notFound(message) {
  return { notFound: message };
}

function validation(message) {
  return { validationError: message };
}

function getSeason(id) {
  const row = prepare('SELECT * FROM seasons WHERE id = ?').get(id);
  if (row?.rule_id === RULE_ID.S5) {
    recalculateS5DebtRecords(row.id);
    return prepare('SELECT * FROM seasons WHERE id = ?').get(id);
  }
  return row;
}

function normalizeNote(note) {
  return typeof note === 'string' ? note.trim().slice(0, 120) : '';
}

function recordSeasonAction(seasonId, actionId, input = {}) {
  const season = getSeason(seasonId);
  if (!season) return notFound('赛季不存在');

  const rule = getRule(season.rule_id);
  const data = parseJson(season.comeback_data, {});
  const result = rule.recordSeasonAction({
    season,
    data,
    rule,
    ruleId: season.rule_id,
    helpers: {
      prefixedId,
      normalizeNote,
      parseJson,
      nowIso: () => new Date().toISOString()
    }
  }, actionId, input);

  if (!result) return validation('当前赛季不支持该操作');
  if (result.validationError) return validation(result.validationError);
  if (result.notFound) return notFound(result.notFound);
  if (!result.nextData) return validation('当前赛季不支持该操作');

  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?')
    .run(stringifyJson(result.nextData), seasonId);

  return { row: getSeason(seasonId) };
}

module.exports = {
  recordSeasonAction
};
