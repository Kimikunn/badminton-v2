const { success, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { validateText } = require('../utils/validators');
const clubService = require('../services/clubService');

function getClub(req, res) {
  try {
    success(res, clubService.getClub());
  } catch (err) {
    sendControllerError(res, err, 'clubController');
  }
}

function updateClub(req, res) {
  try {
    const { name, description, avatar } = req.body;
    const nameError = validateText(name, '俱乐部名称', { maxLength: 80 });
    if (nameError) return validationError(res, nameError);
    const descriptionError = validateText(description, '俱乐部描述', { maxLength: 500, allowEmpty: true });
    if (descriptionError) return validationError(res, descriptionError);
    const avatarError = validateText(avatar, '俱乐部头像', { maxLength: 300, allowEmpty: true });
    if (avatarError) return validationError(res, avatarError);

    success(res, clubService.updateClub({ name, description, avatar }));
  } catch (err) {
    sendControllerError(res, err, 'clubController');
  }
}

module.exports = { getClub, updateClub };
