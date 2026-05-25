const seasonActionService = require('./seasonActionService');

function recordPauseUse(seasonId, input = {}) {
  return seasonActionService.recordSeasonAction(seasonId, 's5_pause_use', input);
}

function recordDebtSettlement(seasonId, input = {}) {
  return seasonActionService.recordSeasonAction(seasonId, 's5_debt_settlement', input);
}

module.exports = {
  recordPauseUse,
  recordDebtSettlement
};
