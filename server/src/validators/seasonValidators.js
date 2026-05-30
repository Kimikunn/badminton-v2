/**
 * 赛季验证规则 — express-validator 声明式规则
 */
const { body } = require('express-validator');

const createSeasonRules = [
  body('name').isString().notEmpty().withMessage('赛季名称不能为空'),
  body('name').optional().isLength({ max: 80 }).withMessage('赛季名称不能超过 80 个字符'),
  body('totalRounds').optional().isInt({ min: 1, max: 99 }).withMessage('总轮次数必须是 1-99 的整数'),
  body('participants').optional().isArray().withMessage('参赛选手必须是数组'),
  body('participants.*').optional().isString().withMessage('选手ID必须是文本'),
  body('ruleId').optional().isIn(['standard', 's2', 's3', 's4', 's5']).withMessage('无效的规则ID'),
];

const updateSeasonRules = [
  body('name').optional().isLength({ max: 80 }).withMessage('赛季名称不能超过 80 个字符'),
  body('totalRounds').optional().isInt({ min: 1, max: 99 }).withMessage('总轮次数必须是 1-99 的整数'),
  body('participants').optional().isArray().withMessage('参赛选手必须是数组'),
  body('ruleId').optional().isIn(['standard', 's2', 's3', 's4', 's5']).withMessage('无效的规则ID'),
];

module.exports = { createSeasonRules, updateSeasonRules };
