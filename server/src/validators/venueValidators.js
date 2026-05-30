/**
 * 场地验证规则 — express-validator 声明式规则
 */
const { body } = require('express-validator');

const createVenueRules = [
  body('name').isString().notEmpty().withMessage('场地名称不能为空'),
  body('name').isLength({ max: 80 }).withMessage('场地名称不能超过 80 个字符'),
  body('address').optional().isLength({ max: 200 }).withMessage('场地地址不能超过 200 个字符'),
  body('pricing').isArray({ min: 1 }).withMessage('价格配置不能为空'),
];

const updateVenueRules = [
  body('name').optional().isLength({ max: 80 }).withMessage('场地名称不能超过 80 个字符'),
  body('address').optional().isLength({ max: 200 }).withMessage('场地地址不能超过 200 个字符'),
  body('pricing').optional().isArray({ min: 1 }).withMessage('价格配置不能为空'),
];

module.exports = { createVenueRules, updateVenueRules };
