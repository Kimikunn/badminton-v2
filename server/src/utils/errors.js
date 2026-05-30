/**
 * 自定义 Error 类 — 语义化业务异常
 *
 * 基于 nodejs-backend-patterns 自定义错误模式。
 * 继承标准 Error，携带 HTTP 状态码和业务错误码，
 * 配合全局 errorHandler 使用，替代当前基于字符串匹配的错误路由。
 *
 * 使用方式（后续 Phase 渐进迁移）：
 *   throw new NotFoundError('赛季不存在');
 *   throw new ConflictError('该赛季已存在相同轮次');
 *   throw new ValidationError('选手ID无效');
 */

class AppError extends Error {
  /**
   * @param {string} message - 人类可读的错误消息（中文，展示给用户）
   * @param {number} statusCode - HTTP 状态码
   * @param {string} code - 业务错误码，保持与前端契约兼容
   */
  constructor(message, statusCode = 500, code = 'SERVER_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // 标记为可预期的操作型错误
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 422, 'VALIDATION_ERROR');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '禁止访问') {
    super(message, 403, 'FORBIDDEN');
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError
};
