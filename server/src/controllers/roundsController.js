const { validateBeforeRoundSetup } = require('../services/seasonRuleLifecycleService');
const roundService = require('../services/roundService');
const { success, notFound, validationError } = require('../utils/response');
const { validateRoundNo, validateStatus } = require('../utils/validators');
const { ROUND_STATUS, SEASON_STATUS } = require('../constants');

function getAll(req, res) {
  const { seasonId } = req.query;
  const rows = roundService.listRounds(seasonId);
  success(res, rows.map(roundService.formatRound));
}

function getById(req, res) {
  const row = roundService.getRoundById(req.params.id);
  if (!row) return notFound(res, '轮次不存在');
  success(res, roundService.formatRound(row));
}

function create(req, res) {
  const { id, seasonId, roundNo, beforeRoundSetup, roundDice, pairings } = req.body;
  if (!seasonId) return validationError(res, '缺少赛季ID');

  const season = roundService.getSeasonById(seasonId);
  if (!season) return notFound(res, '赛季不存在');
  if (season.status === SEASON_STATUS.COMPLETED) return validationError(res, '已完成赛季不能创建新轮次');

  const roundNoError = validateRoundNo(roundNo, season.total_rounds);
  if (roundNoError) return validationError(res, roundNoError);

  const unfinishedRound = roundService.getUnfinishedRound(seasonId);
  if (unfinishedRound) {
    return validationError(res, `第 ${unfinishedRound.round_no} 轮尚未完成，不能创建下一轮`);
  }

  const existing = roundService.getRoundBySeasonAndNo(seasonId, roundNo);
  if (existing) return validationError(res, `第 ${roundNo} 轮已存在`);

  const setup = beforeRoundSetup || (roundDice !== undefined ? { roundDice } : undefined);
  const setupError = validateBeforeRoundSetup(season, setup);
  if (setupError) return validationError(res, setupError);

  const pairingsError = roundService.validateRoundPairings(season, roundNo, pairings);
  if (pairingsError) return validationError(res, pairingsError);

  const result = roundService.createRound({ id, season, roundNo, beforeRoundSetup: setup, pairings });

  success(res, result, 201);
}

function requireSeasonOpen(roundId) {
  if (process.env.ENABLE_TEST_FEATURES === 'true') return null;
  const round = roundService.getRoundById(roundId);
  if (!round) return null;
  const season = roundService.getSeasonById(round.season_id);
  return season?.status === 'completed' ? '已完成赛季不允许修改轮次' : null;
}

function update(req, res) {
  const existing = roundService.getRoundById(req.params.id);
  if (!existing) return notFound(res, '轮次不存在');
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  const { status, venueManagerId } = req.body;
  const statusError = validateStatus(status, Object.values(ROUND_STATUS), '轮次状态');
  if (statusError) return validationError(res, statusError);
  const row = roundService.updateRound(req.params.id, { status, venueManagerId });
  success(res, roundService.formatRound(row));
}

function remove(req, res) {
  const round = roundService.getRoundById(req.params.id);
  if (!round) return notFound(res, '轮次不存在');
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  success(res, roundService.deleteRound(round));
}

module.exports = { getAll, getById, create, update, remove };
