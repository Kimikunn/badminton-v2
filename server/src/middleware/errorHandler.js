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
  logger.error(`${req.method} ${req.originalUrl} — ${err.message}`);

  // express-validator errors
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

  const mapped = mapError(err);
  error(res, mapped.message, mapped.code, mapped.status);
}

module.exports = { notFoundHandler, errorHandler };
