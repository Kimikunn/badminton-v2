const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const seasonService = require('../services/seasonService');
const seasonActionService = require('../services/seasonActionService');

function sendActionResult(res, result) {
  if (result.notFound) return notFound(res, result.notFound);
  if (result.validationError) return validationError(res, result.validationError);
  return success(res, seasonService.formatSeason(result.row));
}

function recordSeasonAction(req, res) {
  try {
    return sendActionResult(
      res,
      seasonActionService.recordSeasonAction(req.params.id, req.params.actionId, req.body)
    );
  } catch (err) {
    return sendControllerError(res, err, 'seasonActionsController');
  }
}

module.exports = {
  recordSeasonAction,
  sendActionResult
};
