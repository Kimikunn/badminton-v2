/**
 * 验证中间件 — express-validator 错误格式化
 *
 * 基于 nodejs-backend-patterns 验证中间件模式。
 * 与 Phase 5-1 的声明式验证规则配合使用。
 * 保持前端契约兼容：{ success: false, error: { code, message, details } }
 */
const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '数据验证失败',
        details: errors.array().map(e => e.msg)
      }
    });
  }
  next();
}

module.exports = { validate };
