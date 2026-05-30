/**
 * 选手验证规则 — express-validator 声明式规则
 */
const { body } = require('express-validator');

const updatePlayerRules = [
  body('name').optional().isLength({ max: 40 }).withMessage('选手姓名不能超过 40 个字符'),
  body('avatar').optional().isLength({ max: 300 }).withMessage('头像地址不能超过 300 个字符'),
  body('racket').optional().isLength({ max: 120 }).withMessage('球拍型号不能超过 120 个字符'),
  body('shoes').optional().isLength({ max: 120 }).withMessage('球鞋型号不能超过 120 个字符'),
  body('displayedTitleId').optional().isLength({ max: 120 }).withMessage('展示称号ID不能超过 120 个字符'),
];

module.exports = { updatePlayerRules };
