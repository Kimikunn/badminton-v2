const { success, notFound, validationError } = require('../utils/response');
const { normalizeMatchFormat, validateNoTeamOverlap, validateTeam } = require('../utils/validators');
const { parseJson } = require('../utils/json');
const { MATCH_STATUS, ROUND_STATUS } = require('../constants');
const matchService = require('../services/matchService');

function getAll(req, res) {
  const rows = matchService.listMatches();
  success(res, rows.map(matchService.formatMatch));
}

function getById(req, res) {
  const row = matchService.getMatchById(req.params.id);
  if (!row) return notFound(res, '比赛不存在');
  success(res, matchService.formatMatch(row));
}

function create(req, res) {
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
}

function update(req, res) {
  const existing = matchService.getMatchById(req.params.id);
  if (!existing) return notFound(res, '比赛不存在');
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);

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
}

function requireSeasonOpen(matchId) {
  if (process.env.ENABLE_TEST_FEATURES === 'true') return null;
  if (matchService.isMatchSeasonCompleted(matchId)) return '已完成赛季不允许修改比赛';
  return null;
}

function remove(req, res) {
  const existing = matchService.getMatchById(req.params.id);
  if (!existing) return notFound(res, '比赛不存在');
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);

  const result = matchService.deleteMatch(existing);
  success(res, result);
}

function startMatch(req, res) {
  const match = matchService.getMatchById(req.params.id);
  if (!match) return notFound(res, '比赛不存在');
  if (match.status === MATCH_STATUS.COMPLETED) return validationError(res, '比赛已结束，无法重新开始');

  if (match.round_id) {
    const round = matchService.getRoundById(match.round_id);
    if (round?.status === ROUND_STATUS.COMPLETED) return validationError(res, '该轮次已完成');
  }

  const row = matchService.startExistingMatch(match);
  success(res, matchService.formatMatch(row));
}

function cancelMatch(req, res) {
  const match = matchService.getMatchById(req.params.id);
  if (!match) return notFound(res, '比赛不存在');
  const locked = requireSeasonOpen(req.params.id);
  if (locked) return validationError(res, locked);
  if (match.status !== MATCH_STATUS.IN_PROGRESS) return validationError(res, '只能取消进行中的比赛');

  const row = matchService.cancelExistingMatch(match);
  success(res, matchService.formatMatch(row));
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
