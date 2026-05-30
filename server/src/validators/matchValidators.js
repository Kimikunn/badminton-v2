/**
 * 比赛验证规则 — express-validator 声明式规则
 */
const { body } = require('express-validator');

const createMatchRules = [
  body('seasonId').optional().isString().withMessage('赛季ID必须是文本'),
  body('roundId').optional().isString().withMessage('轮次ID必须是文本'),
  body('type').optional().isString().withMessage('比赛类型必须是文本'),
  body('teamA').isArray({ min: 1, max: 2 }).withMessage('A队至少需要1名、最多2名选手'),
  body('teamB').isArray({ min: 1, max: 2 }).withMessage('B队至少需要1名、最多2名选手'),
  body('bestOf').optional().isIn([1, 3, 7]).withMessage('比赛局数只支持 1、3 或 7'),
  body('matchFormat').optional().isIn(['bo1', 'bo3', 'pa7']).withMessage('比赛赛制只支持 bo1、bo3 或 pa7'),
];

const updateMatchRules = [
  body('teamA').optional().isArray({ max: 2 }).withMessage('A队最多2名选手'),
  body('teamB').optional().isArray({ max: 2 }).withMessage('B队最多2名选手'),
  body('bestOf').optional().isIn([1, 3, 7]).withMessage('比赛局数只支持 1、3 或 7'),
  body('matchFormat').optional().isIn(['bo1', 'bo3', 'pa7']).withMessage('比赛赛制只支持 bo1、bo3 或 pa7'),
];

module.exports = { createMatchRules, updateMatchRules };
