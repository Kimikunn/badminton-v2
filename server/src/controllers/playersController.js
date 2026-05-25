const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { validateText } = require('../utils/validators');
const playerService = require('../services/playerService');

function getAll(req, res) {
  try {
    const rows = playerService.listPlayers();
    success(res, rows.map(playerService.formatPlayer));
  } catch (err) {
    sendControllerError(res, err, 'playersController');
  }
}

function getById(req, res) {
  try {
    const row = playerService.getPlayerById(req.params.id);
    if (!row) return notFound(res, '选手不存在');
    success(res, playerService.formatPlayer(row));
  } catch (err) {
    sendControllerError(res, err, 'playersController');
  }
}

function update(req, res) {
  try {
    const existing = playerService.getPlayerById(req.params.id);
    if (!existing) return notFound(res, '选手不存在');

    const { name, avatar, racket, shoes, displayedTitleId } = req.body;
    const nameError = validateText(name, '选手姓名', { maxLength: 40 });
    if (nameError) return validationError(res, nameError);
    const avatarError = validateText(avatar, '头像地址', { maxLength: 300, allowEmpty: true });
    if (avatarError) return validationError(res, avatarError);
    const racketError = validateText(racket, '球拍型号', { maxLength: 120, allowEmpty: true });
    if (racketError) return validationError(res, racketError);
    const shoesError = validateText(shoes, '球鞋型号', { maxLength: 120, allowEmpty: true });
    if (shoesError) return validationError(res, shoesError);
    const titleError = validateText(displayedTitleId, '展示称号ID', { maxLength: 120, allowEmpty: true });
    if (titleError) return validationError(res, titleError);
    if (displayedTitleId) {
      if (!playerService.titleExists(displayedTitleId)) return validationError(res, '展示称号不存在');
    }

    const row = playerService.updatePlayer(req.params.id, { name, avatar, racket, shoes, displayedTitleId });
    success(res, playerService.formatPlayer(row));
  } catch (err) {
    sendControllerError(res, err, 'playersController');
  }
}

module.exports = { getAll, getById, update };
