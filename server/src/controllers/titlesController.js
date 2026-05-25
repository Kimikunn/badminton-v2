const { success } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const titleService = require('../services/titleService');

function getAll(req, res) {
  try {
    success(res, titleService.listTitles());
  } catch (err) { sendControllerError(res, err, 'titlesController'); }
}

function getAllPlayerTitles(req, res) {
  try {
    const rows = titleService.listPlayerTitles();
    success(res, titleService.formatPlayerTitles(rows));
  } catch (err) { sendControllerError(res, err, 'titlesController'); }
}

module.exports = { getAll, getAllPlayerTitles };
