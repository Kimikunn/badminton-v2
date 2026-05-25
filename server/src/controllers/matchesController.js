const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { normalizeMatchFormat, validateNoTeamOverlap, validateTeam } = require('../utils/validators');
const { parseJson } = require('../utils/json');
const { MATCH_STATUS, ROUND_STATUS } = require('../constants');
const matchService = require('../services/matchService');

function getAll(req, res) {
  try {
    const rows = matchService.listMatches();
    success(res, rows.map(matchService.formatMatch));
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function getById(req, res) {
  try {
    const row = matchService.getMatchById(req.params.id);
    if (!row) return notFound(res, '比赛不存在');
    success(res, matchService.formatMatch(row));
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function create(req, res) {
  try {
    const { id, seasonId, roundId, type, teamA, teamB, bestOf, matchFormat, date, venueId } = req.body;

    const teamError = validateMatchTeams({ teamA, teamB, required: true });
    if (teamError) return validationError(res, teamError);

    const normalized = normalizeMatchFormat(bestOf ?? 3, matchFormat);
    if (normalized.error) return validationError(res, normalized.error);

    const relation = resolveMatchRelation({ seasonId, roundId });
    if (relation.notFound) return notFound(res, relation.notFound);
    if (relation.validationError) return validationError(res, relation.validationError);

    const row = matchService.createMatch({
      id,
      seasonId: relation.seasonId,
      roundId,
      type,
      teamA,
      teamB,
      bestOf: normalized.bestOf,
      matchFormat: normalized.matchFormat,
      date,
      venueId
    });

    success(res, matchService.formatMatch(row), 201);
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function update(req, res) {
  try {
    const existing = matchService.getMatchById(req.params.id);
    if (!existing) return notFound(res, '比赛不存在');

    const { teamA, teamB, bestOf, matchFormat, date, venueId } = req.body;

    const teamError = validateMatchTeams({
      teamA,
      teamB,
      existingTeamA: parseJson(existing.team_a, []),
      existingTeamB: parseJson(existing.team_b, [])
    });
    if (teamError) return validationError(res, teamError);

    const matchFormatData = (bestOf !== undefined || matchFormat !== undefined)
      ? normalizeMatchFormat(bestOf ?? existing.best_of ?? 3, matchFormat ?? existing.match_format)
      : null;
    if (matchFormatData?.error) return validationError(res, matchFormatData.error);

    if ((existing.status === MATCH_STATUS.COMPLETED || existing.status === MATCH_STATUS.IN_PROGRESS) &&
        (teamA !== undefined || teamB !== undefined || bestOf !== undefined || matchFormat !== undefined)) {
      return validationError(res, '比赛已开始或结束，不能修改队伍和赛制');
    }

    const row = matchService.updateMatch(req.params.id, {
      teamA,
      teamB,
      matchFormatData,
      date,
      venueId
    });

    success(res, matchService.formatMatch(row));
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function remove(req, res) {
  try {
    const existing = matchService.getMatchById(req.params.id);
    if (!existing) return notFound(res, '比赛不存在');

    const result = matchService.deleteMatch(existing);
    success(res, result);
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function startMatch(req, res) {
  try {
    const match = matchService.getMatchById(req.params.id);
    if (!match) return notFound(res, '比赛不存在');
    if (match.status === MATCH_STATUS.COMPLETED) return validationError(res, '比赛已结束，无法重新开始');

    if (match.round_id) {
      const round = matchService.getRoundById(match.round_id);
      if (round?.status === ROUND_STATUS.COMPLETED) return validationError(res, '该轮次已完成');
    }

    const row = matchService.startExistingMatch(match);
    success(res, matchService.formatMatch(row));
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function cancelMatch(req, res) {
  try {
    const match = matchService.getMatchById(req.params.id);
    if (!match) return notFound(res, '比赛不存在');
    if (match.status !== MATCH_STATUS.IN_PROGRESS) return validationError(res, '只能取消进行中的比赛');

    const row = matchService.cancelExistingMatch(match);
    success(res, matchService.formatMatch(row));
  } catch (err) { sendControllerError(res, err, 'matchesController'); }
}

function resolveMatchRelation({ seasonId, roundId }) {
  let resolvedSeasonId = seasonId || null;

  if (roundId) {
    const round = matchService.getRoundById(roundId);
    if (!round) return { notFound: '轮次不存在' };
    if (round.status === ROUND_STATUS.COMPLETED) return { validationError: '该轮次已完成，无法添加比赛' };
    if (resolvedSeasonId && resolvedSeasonId !== round.season_id) {
      return { validationError: '比赛赛季与轮次所属赛季不一致' };
    }
    resolvedSeasonId = round.season_id;
  }

  if (resolvedSeasonId) {
    const season = matchService.getSeasonById(resolvedSeasonId);
    if (!season) return { notFound: '赛季不存在' };
  }

  return { seasonId: resolvedSeasonId };
}

function validateMatchTeams({ teamA, teamB, existingTeamA = [], existingTeamB = [], required = false }) {
  const teamAError = validateTeam(teamA, 'A队', { required });
  if (teamAError) return teamAError;
  const teamBError = validateTeam(teamB, 'B队', { required });
  if (teamBError) return teamBError;

  const nextTeamA = teamA !== undefined ? teamA : existingTeamA;
  const nextTeamB = teamB !== undefined ? teamB : existingTeamB;
  return validateNoTeamOverlap(nextTeamA, nextTeamB);
}

module.exports = { getAll, getById, create, update, remove, startMatch, cancelMatch };
