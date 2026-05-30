const { success } = require('../utils/response');
const titleService = require('../services/titleService');

function getAll(req, res) {
  success(res, titleService.listTitles());
}

function getAllPlayerTitles(req, res) {
  const rows = titleService.listPlayerTitles();
  success(res, titleService.formatPlayerTitles(rows));
}

module.exports = { getAll, getAllPlayerTitles };
