/**
 * 订场意图验证规则 — express-validator 声明式规则
 *
 * 全部校验集中在本层（含跨字段业务规则：日期必填且不早于今天、窗口先后、
 * 时长不超过窗口），controller 只做 404 存在性检查与服务编排。
 *
 * 单模型（2026-09-17 用户决策 D2/D6）：只接受具体日期 `date`，不再有每周重复；
 * 任意未来日期都能设监控（窗口外为"等待放票"，进窗口自动生效），只要求不早于今天。
 */
const { body } = require('express-validator');
const intentService = require('../services/intentService');
const { hhmmToMinutes, today } = require('../services/venueShared');

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

/**
 * 跨字段业务校验。partial（更新）时省略的字段取已有行值合并校验；
 * 行不存在时跳过（由 controller 返回 404）。
 */
function crossFieldRules({ partial }) {
  return body().custom((value, { req }) => {
    // 单模型：任何形态的 weekdays 都不再接受（null 也不行，避免前端残留字段静默失效）
    if (value.weekdays !== undefined) throw new Error('不再支持每周重复，请按日期设置');

    let existing = null;
    if (partial) {
      existing = intentService.getIntentById(req.params.id);
      if (!existing) return true;
    }

    const hasDate = value.date !== undefined && value.date !== null;
    if (!partial && !hasDate) throw new Error('请选择日期');
    const date = hasDate ? value.date : (existing && existing.date);
    if (hasDate && !date) throw new Error('请选择日期');
    if (date) {
      if (!DATE_RE.test(date)) throw new Error('日期格式必须是 YYYY-MM-DD');
      // 允许任意未来日期（提前设置），只拦过去
      if (date < today()) throw new Error('不能给过去的日期设置监控');
    }

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
      // 同一天同一时间段不重复建监控（UI 会先拦一次，这里是绕过 UI 的兜底）
      if (date) {
        const clash = intentService.findByWindow({
          date,
          windowStart,
          windowEnd,
          excludeId: partial ? req.params.id : null
        });
        if (clash) throw new Error('该时段已有监控');
      }
    }
    return true;
  });
}

const createIntentRules = [
  body('mode').optional().isIn(intentService.INTENT_MODES).withMessage('模式只能是 auto_lock 或 notify'),
  body('date').notEmpty().withMessage('请选择日期'),
  body('date').isString().withMessage('日期必须是文本'),
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
