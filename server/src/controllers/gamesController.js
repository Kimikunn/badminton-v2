const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { validateCompletedScore, validateScorePatch } = require('../utils/validators');
const gameService = require('../services/gameService');

function sendServiceResult(res, result) {
  if (result.notFound) return notFound(res, result.notFound);
  if (result.validationError) return validationError(res, result.validationError);
  return success(res, gameService.formatGame(result.row));
}

function getAll(req, res) {
  try {
    const rows = gameService.listVisibleGames();
    success(res, gameService.formatGames(rows));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function getOne(req, res) {
  try {
    const game = gameService.getGameById(req.params.id);
    if (!game) return notFound(res, '局不存在');
    success(res, gameService.formatGame(game));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function getByMatch(req, res) {
  try {
    const rows = gameService.listGamesByMatch(req.params.matchId);
    success(res, gameService.formatGames(rows));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function updateScore(req, res) {
  try {
    const scoreError = validateScorePatch(req.body);
    if (scoreError) return validationError(res, scoreError);

    return sendServiceResult(res, gameService.updateScore(req.params.id, req.body));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function endGame(req, res) {
  try {
    return sendServiceResult(res, gameService.endGame(req.params.id, req.body));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function updateCompletedScore(req, res) {
  try {
    const scoreError = validateCompletedScore(req.body);
    if (scoreError) return validationError(res, scoreError);

    return sendServiceResult(res, gameService.updateCompletedScore(req.params.id, req.body));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

function revertGame(req, res) {
  try {
    return sendServiceResult(res, gameService.revertGame(req.params.id));
  } catch (err) { sendControllerError(res, err, 'gamesController'); }
}

module.exports = { getAll, getOne, getByMatch, updateScore, endGame, updateCompletedScore, revertGame };
