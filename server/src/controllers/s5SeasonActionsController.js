const { sendActionResult } = require('./seasonActionsController');
const s5SeasonActionService = require('../services/s5SeasonActionService');

function recordPauseUse(req, res) {
  return sendActionResult(res, s5SeasonActionService.recordPauseUse(req.params.id, req.body));
}

function recordDebtSettlement(req, res) {
  return sendActionResult(res, s5SeasonActionService.recordDebtSettlement(req.params.id, req.body));
}

module.exports = {
  recordPauseUse,
  recordDebtSettlement
};
