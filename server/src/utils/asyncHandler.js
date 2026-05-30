/**
 * asyncHandler — 消除 controller 中的 try/catch 样板代码
 *
 * 基于 nodejs-backend-patterns async error wrapper 模式。
 * 包装 controller 函数，自动捕获异常并发送统一错误响应，
 * 支持 Phase 2-1 的 AppError 实例。
 */
const { error } = require('./response');
const { mapError } = require('./errorHandling');
const logger = require('./logger');

/**
 * @param {Function} fn - controller 函数 (req, res, next) => any
 * @param {string} context - 错误日志上下文（如 'games.updateScore'）
 * @returns {Function} Express middleware
 */
function asyncHandler(fn, context) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      // AppError 实例使用自带属性
      if (err.isOperational) {
        logger.error(`${context} - ${err.message}`);
        return error(res, err.message, err.code, err.statusCode);
      }

      // 其他错误走原有映射逻辑
      const mapped = mapError(err);
      logger.error(`${context} - ${err.stack || err.message}`);
      return error(res, mapped.message, mapped.code, mapped.status);
    });
  };
}

module.exports = { asyncHandler };
