/**
 * Error handling middleware
 */
const { error } = require('../utils/response');
const logger = require('../utils/logger');
const { mapError } = require('../utils/errorHandling');

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `路由不存在: ${req.method} ${req.originalUrl}` }
  });
}

function errorHandler(err, req, res, _next) {
  // 结构化日志记录
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });

  // AppError 实例（Phase 2-1）—— 操作型错误，安全返回
  if (err.isOperational) {
    return error(res, err.message, err.code, err.statusCode);
  }

  // express-validator 错误（兼容）
  if (err.type === 'validation') {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '数据验证失败',
        details: err.errors?.map(e => e.msg)
      }
    });
  }

  // SQLite / 未知错误 — mapError 做消息映射
  const mapped = mapError(err);

  // 生产环境隐藏内部错误细节
  const message = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : mapped.message;

  error(res, message, mapped.code, mapped.status);
}

module.exports = { notFoundHandler, errorHandler };
