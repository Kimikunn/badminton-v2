/**
 * 订场意图验证规则 — express-validator 声明式规则
 *
 * 全部校验集中在本层（含跨字段业务规则：date/weekdays 二选一、窗口先后、
 * 时长不超过窗口），controller 只做 404 存在性检查与服务编排。
 */
const { body } = require('express-validator');
const intentService = require('../services/intentService');
const { hhmmToMinutes } = require('../services/venueShared');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateConfigRules = [
  body('enabled').optional().isBoolean().withMessage('总开关必须是布尔值'),
  body('areaPriority').optional().isArray().withMessage('场地优先级必须是数组'),
  body('areaPriority.*').isInt({ min: 0 }).withMessage('场地ID必须是非负整数'),
  body().custom((value) => {
    if (value.enabled === undefined && value.areaPriority === undefined) {
      throw new Error('没有需要更新的配置项');
    }
    return true;
  })
];

/** weekdays 数组内容：非空、0-6 整数、不重复 */
function checkWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('星期几必须是非空数组');
  const seen = new Set();
  for (const d of value) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('星期几必须是 0-6 的整数（0=周日）');
    if (seen.has(d)) throw new Error('星期几不能重复');
    seen.add(d);
  }
  return true;
}

/**
 * 跨字段业务校验。partial（更新）时省略的字段取已有行值合并校验；
 * 行不存在时跳过（由 controller 返回 404）。
 */
function crossFieldRules({ partial }) {
  return body().custom((value, { req }) => {
    let existing = null;
    if (partial) {
      existing = intentService.getIntentById(req.params.id);
      if (!existing) return true;
    }

    const hasDate = value.date !== undefined && value.date !== null;
    const hasWeekdays = value.weekdays !== undefined && value.weekdays !== null;
    if (hasDate && hasWeekdays) throw new Error('单次日期与每周重复只能二选一');
    if (!partial && !hasDate && !hasWeekdays) throw new Error('请填写单次日期或选择每周重复');

    const date = hasDate ? value.date : (hasWeekdays ? null : (existing && existing.date));
    const weekdays = hasWeekdays ? value.weekdays : null;
    if (date) {
      if (!DATE_RE.test(date)) throw new Error('日期格式必须是 YYYY-MM-DD');
      // 场馆只放今天起 BOOKING_WINDOW_DAYS 天的票，窗口外的日期无法监控
      if (!intentService.isDateBookable(date)) {
        throw new Error(`单次日期只能选今天起 ${intentService.BOOKING_WINDOW_DAYS} 天内（场馆只放 ${intentService.BOOKING_WINDOW_DAYS} 天的票）`);
      }
    }
    if (weekdays) checkWeekdays(weekdays);

    const windowStart = value.windowStart ?? (existing && existing.window_start);
    const windowEnd = value.windowEnd ?? (existing && existing.window_end);
    const durationHours = value.durationHours ?? (existing && existing.duration_hours);

    if (windowStart !== undefined || !partial) {
      if (!windowStart || !TIME_RE.test(windowStart)) throw new Error('窗口开始时间格式必须是 HH:MM');
    }
    if (windowEnd !== undefined || !partial) {
      if (!windowEnd || !TIME_RE.test(windowEnd)) throw new Error('窗口结束时间格式必须是 HH:MM');
    }
    if (windowStart && windowEnd) {
      if (windowStart >= windowEnd) throw new Error('窗口结束时间必须晚于开始时间');
      if (durationHours !== undefined && durationHours !== null) {
        const windowMinutes = hhmmToMinutes(windowEnd) - hhmmToMinutes(windowStart);
        if (durationHours * 60 > windowMinutes) throw new Error('打球时长不能超过时间窗口');
      }
    }
    return true;
  });
}

const createIntentRules = [
  body('mode').optional().isIn(intentService.INTENT_MODES).withMessage('模式只能是 auto_lock 或 notify'),
  body('date').optional({ nullable: true }).isString().withMessage('日期必须是文本'),
  body('weekdays').optional({ nullable: true }).isArray({ min: 1 }).withMessage('星期几必须是非空数组'),
  body('windowStart').isString().withMessage('窗口开始时间不能为空'),
  body('windowEnd').isString().withMessage('窗口结束时间不能为空'),
  body('durationHours').isInt({ min: 1, max: 12 }).withMessage('打球时长必须是 1-12 的整数'),
  body('courtsNeeded').optional().isInt({ min: 1, max: 3 }).withMessage('同时片数必须是 1-3 的整数'),
  body('preferredAreaIds').optional({ nullable: true }).isArray().withMessage('场地偏好必须是数组'),
  body('preferredAreaIds.*').isInt({ min: 0 }).withMessage('场地ID必须是非负整数'),
  body('enabled').optional().isBoolean().withMessage('启用状态必须是布尔值'),
  crossFieldRules({ partial: false })
];

const updateIntentRules = [
  body('mode').optional().isIn(intentService.INTENT_MODES).withMessage('模式只能是 auto_lock 或 notify'),
  body('date').optional({ nullable: true }).isString().withMessage('日期必须是文本'),
  body('weekdays').optional({ nullable: true }).isArray({ min: 1 }).withMessage('星期几必须是非空数组'),
  body('windowStart').optional().isString().withMessage('窗口开始时间必须是文本'),
  body('windowEnd').optional().isString().withMessage('窗口结束时间必须是文本'),
  body('durationHours').optional().isInt({ min: 1, max: 12 }).withMessage('打球时长必须是 1-12 的整数'),
  body('courtsNeeded').optional().isInt({ min: 1, max: 3 }).withMessage('同时片数必须是 1-3 的整数'),
  body('preferredAreaIds').optional({ nullable: true }).isArray().withMessage('场地偏好必须是数组'),
  body('preferredAreaIds.*').isInt({ min: 0 }).withMessage('场地ID必须是非负整数'),
  body('enabled').optional().isBoolean().withMessage('启用状态必须是布尔值'),
  crossFieldRules({ partial: true })
];

module.exports = { updateConfigRules, createIntentRules, updateIntentRules };
