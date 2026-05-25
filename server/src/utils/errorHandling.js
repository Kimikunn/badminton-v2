const logger = require('./logger');
const { error } = require('./response');

function mapDatabaseError(err) {
  const message = err?.message || '';

  if (/UNIQUE constraint failed: rounds\.season_id, rounds\.round_no/.test(message)) {
    return { status: 409, code: 'DUPLICATE_ROUND', message: '该赛季已存在相同轮次' };
  }

  if (/UNIQUE constraint failed: games\.match_id, games\.game_no/.test(message)) {
    return { status: 409, code: 'DUPLICATE_GAME_NO', message: '该比赛已存在相同局号' };
  }

  if (/UNIQUE constraint failed/.test(message)) {
    return { status: 409, code: 'CONFLICT', message: '数据已存在，不能重复创建' };
  }

  if (/FOREIGN KEY constraint failed/.test(message)) {
    return { status: 422, code: 'RELATION_CONSTRAINT', message: '关联资源不存在或仍被引用' };
  }

  if (/NOT NULL constraint failed/.test(message)) {
    return { status: 422, code: 'VALIDATION_ERROR', message: '缺少必填字段' };
  }

  return null;
}

function mapError(err) {
  return mapDatabaseError(err) || {
    status: 500,
    code: 'SERVER_ERROR',
    message: '服务器内部错误'
  };
}

function sendControllerError(res, err, context = 'controller') {
  const mapped = mapError(err);
  logger.error(`${context} - ${err?.stack || err?.message || err}`);
  return error(res, mapped.message, mapped.code, mapped.status);
}

module.exports = { mapError, sendControllerError };
