/**
 * 订场监控验证规则 — express-validator 声明式规则（v2）
 *
 * 跨字段业务校验（date/weekdays 二选一、时间先后）在 controller 层做。
 */
const { body } = require('express-validator');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const updateConfigRules = [
  body('enabled').isBoolean().withMessage('总开关必须是布尔值')
];

const createTargetRules = [
  body('date').optional({ nullable: true }).isString().matches(DATE_RE).withMessage('日期格式必须是 YYYY-MM-DD'),
  body('weekdays').optional({ nullable: true }).isArray({ min: 1 }).withMessage('星期几必须是非空数组'),
  body('weekdays.*').isInt({ min: 0, max: 6 }).withMessage('星期几必须是 0-6 的整数（0=周日）'),
  body('startTime').isString().matches(TIME_RE).withMessage('开始时间格式必须是 HH:MM'),
  body('endTime').isString().matches(TIME_RE).withMessage('结束时间格式必须是 HH:MM'),
  body('areaIds').optional({ nullable: true }).isArray().withMessage('场地列表必须是数组'),
  body('areaIds.*').isInt({ min: 0 }).withMessage('场地ID必须是非负整数'),
  body('excludeUnavailable').optional().isBoolean().withMessage('排除不可用日期开关必须是布尔值'),
  body('enabled').optional().isBoolean().withMessage('启用状态必须是布尔值')
];

const updateTargetRules = [
  body('date').optional({ nullable: true }).isString().matches(DATE_RE).withMessage('日期格式必须是 YYYY-MM-DD'),
  body('weekdays').optional({ nullable: true }).isArray({ min: 1 }).withMessage('星期几必须是非空数组'),
  body('weekdays.*').isInt({ min: 0, max: 6 }).withMessage('星期几必须是 0-6 的整数（0=周日）'),
  body('startTime').optional().isString().matches(TIME_RE).withMessage('开始时间格式必须是 HH:MM'),
  body('endTime').optional().isString().matches(TIME_RE).withMessage('结束时间格式必须是 HH:MM'),
  body('areaIds').optional({ nullable: true }).isArray().withMessage('场地列表必须是数组'),
  body('areaIds.*').isInt({ min: 0 }).withMessage('场地ID必须是非负整数'),
  body('excludeUnavailable').optional().isBoolean().withMessage('排除不可用日期开关必须是布尔值'),
  body('enabled').optional().isBoolean().withMessage('启用状态必须是布尔值')
];

module.exports = { updateConfigRules, createTargetRules, updateTargetRules };
