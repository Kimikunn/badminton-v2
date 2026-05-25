const { MATCH_FORMAT, RULE_ID } = require('../constants');

const MATCH_FORMATS = new Set(Object.values(MATCH_FORMAT));
const MATCH_FORMAT_BY_BEST_OF = new Map([[1, MATCH_FORMAT.BO1], [3, MATCH_FORMAT.BO3], [7, MATCH_FORMAT.PA7]]);
const RULE_IDS = new Set(Object.values(RULE_ID));

function isInteger(value) {
  return Number.isInteger(value);
}

function validateRoundNo(roundNo, totalRounds) {
  if (!isInteger(roundNo) || roundNo < 1) return '轮次编号必须是正整数';
  if (isInteger(totalRounds) && roundNo > totalRounds) return `赛季只有 ${totalRounds} 轮`;
  return null;
}

function normalizeMatchFormat(bestOf = 3, matchFormat) {
  const gameCount = bestOf ?? 3;
  if (!isInteger(gameCount) || !MATCH_FORMAT_BY_BEST_OF.has(gameCount)) {
    return { error: '比赛局数只支持 1、3 或 7' };
  }

  const expectedFormat = MATCH_FORMAT_BY_BEST_OF.get(gameCount);
  const format = matchFormat ?? expectedFormat;
  if (!MATCH_FORMATS.has(format)) return { error: '比赛赛制只支持 bo1、bo3 或 pa7' };
  if (format !== expectedFormat) {
    return { error: `局数 ${gameCount} 应使用赛制 ${expectedFormat}` };
  }

  return { bestOf: gameCount, matchFormat: format };
}

function validateTeam(value, label, options = {}) {
  const { required = false } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (!Array.isArray(value)) return `${label}必须是选手ID数组`;
  if (required && value.length === 0) return `${label}至少需要1名选手`;
  if (value.length > 2) return `${label}最多2名选手`;
  if (value.some(id => typeof id !== 'string' || id.trim() === '')) {
    return `${label}包含无效选手ID`;
  }
  if (new Set(value).size !== value.length) return `${label}不能包含重复选手`;
  return null;
}

function validateNoTeamOverlap(teamA, teamB) {
  if (!Array.isArray(teamA) || !Array.isArray(teamB)) return null;
  const overlap = teamA.some(id => teamB.includes(id));
  return overlap ? '两队不能包含同一名选手' : null;
}

function validateScoreValue(value, label) {
  if (!isInteger(value) || value < 0 || value > 30) {
    return `${label}必须是 0 到 30 的整数`;
  }
  return null;
}

function validateScorePatch(body) {
  const hasA = body.scoreA !== undefined;
  const hasB = body.scoreB !== undefined;
  if (!hasA && !hasB) return '至少提供一方比分';
  if (hasA) {
    const err = validateScoreValue(body.scoreA, 'A队比分');
    if (err) return err;
  }
  if (hasB) {
    const err = validateScoreValue(body.scoreB, 'B队比分');
    if (err) return err;
  }
  return null;
}

function validateCompletedScore(body) {
  if (body.scoreA === undefined || body.scoreB === undefined) return '必须同时提供两队比分';
  return validateScorePatch(body);
}

function validateStatus(value, allowed, label = '状态') {
  if (value === undefined) return null;
  if (!allowed.includes(value)) return `${label}只能是：${allowed.join('、')}`;
  return null;
}

function validateText(value, label, options = {}) {
  const { required = false, maxLength = 200, allowEmpty = false } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (typeof value !== 'string') return `${label}必须是文本`;
  if (!allowEmpty && value.trim() === '') return `${label}不能为空`;
  if (value.length > maxLength) return `${label}不能超过 ${maxLength} 个字符`;
  return null;
}

function validatePositiveInteger(value, label, options = {}) {
  const { required = false, max = Number.MAX_SAFE_INTEGER } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (!isInteger(value) || value < 1 || value > max) {
    return `${label}必须是 1 到 ${max} 的整数`;
  }
  return null;
}

function validateNonNegativeNumber(value, label, options = {}) {
  const { required = false, max = Number.MAX_SAFE_INTEGER } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    return `${label}必须是 0 到 ${max} 的数字`;
  }
  return null;
}

function validateStringArray(value, label, options = {}) {
  const { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (!Array.isArray(value)) return `${label}必须是数组`;
  if (value.length < min) return `${label}至少需要 ${min} 项`;
  if (value.length > max) return `${label}最多只能有 ${max} 项`;
  if (value.some(item => typeof item !== 'string' || item.trim() === '')) {
    return `${label}包含无效ID`;
  }
  if (new Set(value).size !== value.length) return `${label}不能包含重复ID`;
  return null;
}

function validateRuleId(value, options = {}) {
  const { required = false } = options;
  if (value === undefined || value === null) {
    return required ? '规则ID不能为空' : null;
  }
  if (!RULE_IDS.has(value)) return `规则ID只能是：${Array.from(RULE_IDS).join('、')}`;
  return null;
}

function validateJsonObject(value, label, options = {}) {
  const { required = false } = options;
  if (value === undefined || value === null) {
    return required ? `${label}不能为空` : null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return `${label}必须是对象`;
  return null;
}

function validateDateText(value, label = '日期', options = {}) {
  const error = validateText(value, label, options);
  if (error || value === undefined || value === null) return error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label}格式必须是 YYYY-MM-DD`;
  return null;
}

module.exports = {
  normalizeMatchFormat,
  validateRoundNo,
  validateTeam,
  validateNoTeamOverlap,
  validateScorePatch,
  validateCompletedScore,
  validateStatus,
  validateText,
  validatePositiveInteger,
  validateNonNegativeNumber,
  validateStringArray,
  validateRuleId,
  validateJsonObject,
  validateDateText
};
