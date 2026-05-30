const { success, notFound, validationError } = require('../utils/response');
const { validateCompletedScore, validateScorePatch } = require('../utils/validators');
const gameService = require('../services/gameService');

function sendServiceResult(res, result) {
  if (result.notFound) return notFound(res, result.notFound);
  if (result.validationError) return validationError(res, result.validationError);
  return success(res, gameService.formatGame(result.row));
}

function getAll(req, res) {
  const rows = gameService.listVisibleGames();
  success(res, gameService.formatGames(rows));
}

function getOne(req, res) {
  const game = gameService.getGameById(req.params.id);
  if (!game) return notFound(res, '局不存在');
  success(res, gameService.formatGame(game));
}

function getByMatch(req, res) {
  const rows = gameService.listGamesByMatch(req.params.matchId);
  success(res, gameService.formatGames(rows));
}

function requireSeasonOpen(gameId) {
  if (process.env.ENABLE_TEST_FEATURES === 'true') return null;
  if (gameService.isGameSeasonCompleted(gameId)) return '已完成赛季不允许修改比赛';
  return null;
}

function updateScore(req, res) {
  const scoreError = validateScorePatch(req.body);
  if (scoreError) return validationError(res, scoreError);

  return sendServiceResult(res, gameService.updateScore(req.params.id, req.body));
}

function endGame(req, res) {
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  return sendServiceResult(res, gameService.endGame(req.params.id, req.body));
}

function updateCompletedScore(req, res) {
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  const scoreError = validateCompletedScore(req.body);
  if (scoreError) return validationError(res, scoreError);

  return sendServiceResult(res, gameService.updateCompletedScore(req.params.id, req.body));
}

function revertGame(req, res) {
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  return sendServiceResult(res, gameService.revertGame(req.params.id));
}

module.exports = { getAll, getOne, getByMatch, updateScore, endGame, updateCompletedScore, revertGame };
