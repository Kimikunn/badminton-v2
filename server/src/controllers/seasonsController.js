const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const seasonService = require('../services/seasonService');
const {
  normalizeMatchFormat,
  validateJsonObject,
  validatePositiveInteger,
  validateRuleId,
  validateStatus,
  validateStringArray,
  validateText
} = require('../utils/validators');
const { SEASON_STATUS } = require('../constants');

const SEASON_STATUSES = Object.values(SEASON_STATUS);

function getAll(req, res) {
  try {
    const rows = seasonService.listSeasons();
    success(res, rows.map(seasonService.formatSeason));
  } catch (err) { sendControllerError(res, err, 'seasonsController'); }
}

function getById(req, res) {
  try {
    const row = seasonService.getSeasonById(req.params.id);
    if (!row) return notFound(res, '赛季不存在');
    success(res, seasonService.formatSeason(row));
  } catch (err) { sendControllerError(res, err, 'seasonsController'); }
}

function validateSeasonPayload(body, options = {}) {
  const { partial = false } = options;
  const nameError = validateText(body.name, '赛季名称', { required: !partial, maxLength: 80 });
  if (nameError) return nameError;

  const totalRoundsError = validatePositiveInteger(body.totalRounds, '总轮次数', { max: 99 });
  if (totalRoundsError) return totalRoundsError;

  if (body.bestOf !== undefined) {
    const normalized = normalizeMatchFormat(body.bestOf);
    if (normalized.error) return normalized.error;
  }

  const statusError = validateStatus(body.status, SEASON_STATUSES, '赛季状态');
  if (statusError) return statusError;

  const participantsError = validateStringArray(body.participants, '参赛选手', { max: 32 });
  if (participantsError) return participantsError;

  const ruleError = validateRuleId(body.ruleId);
  if (ruleError) return ruleError;

  const comebackError = validateJsonObject(body.comebackData, '赛季规则数据');
  if (comebackError) return comebackError;

  const colorError = validateText(body.color, '赛季颜色', { maxLength: 40 });
  if (colorError) return colorError;

  return null;
}

function create(req, res) {
  try {
    const { participants } = req.body;
    const payloadError = validateSeasonPayload(req.body);
    if (payloadError) return validationError(res, payloadError);

    const missingPlayers = seasonService.missingPlayerIds(participants || []);
    if (missingPlayers.length) return validationError(res, `参赛选手不存在：${missingPlayers.join('、')}`);

    const row = seasonService.createSeason(req.body);
    success(res, seasonService.formatSeason(row), 201);
  } catch (err) { sendControllerError(res, err, 'seasonsController'); }
}

function update(req, res) {
  try {
    const existing = seasonService.getSeasonById(req.params.id);
    if (!existing) return notFound(res, '赛季不存在');

    const { participants } = req.body;
    const payloadError = validateSeasonPayload(req.body, { partial: true });
    if (payloadError) return validationError(res, payloadError);

    const missingPlayers = seasonService.missingPlayerIds(participants || []);
    if (missingPlayers.length) return validationError(res, `参赛选手不存在：${missingPlayers.join('、')}`);

    const row = seasonService.updateSeason(req.params.id, req.body);
    success(res, seasonService.formatSeason(row));
  } catch (err) { sendControllerError(res, err, 'seasonsController'); }
}

function remove(req, res) {
  try {
    const season = seasonService.getSeasonById(req.params.id);
    if (!season) return notFound(res, '赛季不存在');
    if (process.env.ENABLE_TEST_FEATURES !== 'true' && season.status === 'completed') return validationError(res, '已完成赛季不允许删除');

    success(res, seasonService.deleteSeason(season));
  } catch (err) { sendControllerError(res, err, 'seasonsController'); }
}

module.exports = { getAll, getById, create, update, remove };
