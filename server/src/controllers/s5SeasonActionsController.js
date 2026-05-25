const { sendControllerError } = require('../utils/errorHandling');
const { sendActionResult } = require('./seasonActionsController');
const s5SeasonActionService = require('../services/s5SeasonActionService');

function recordPauseUse(req, res) {
  try {
    return sendActionResult(res, s5SeasonActionService.recordPauseUse(req.params.id, req.body));
  } catch (err) { sendControllerError(res, err, 's5SeasonActionsController'); }
}

function recordDebtSettlement(req, res) {
  try {
    return sendActionResult(res, s5SeasonActionService.recordDebtSettlement(req.params.id, req.body));
  } catch (err) { sendControllerError(res, err, 's5SeasonActionsController'); }
}

module.exports = {
  recordPauseUse,
  recordDebtSettlement
};
