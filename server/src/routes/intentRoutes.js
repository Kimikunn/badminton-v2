const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/intentController');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const {
  updateConfigRules,
  createIntentRules,
  updateIntentRules
} = require('../validators/intentValidators');

// 配置（GET 脱敏输出；PUT 受全局 requireWriteAuth 保护）
router.get('/config', asyncHandler(ctrl.getConfig, 'intent.getConfig'));
router.put('/config', updateConfigRules, validate, asyncHandler(ctrl.updateConfig, 'intent.updateConfig'));

// 订场意图
router.get('/', asyncHandler(ctrl.listIntents, 'intent.listIntents'));
router.post('/', createIntentRules, validate, asyncHandler(ctrl.createIntent, 'intent.createIntent'));
router.put('/:id', updateIntentRules, validate, asyncHandler(ctrl.updateIntent, 'intent.updateIntent'));
router.delete('/:id', asyncHandler(ctrl.deleteIntent, 'intent.deleteIntent'));

// 推送历史（倒序分页，可按 ?intentId= 过滤）
router.get('/notifications', asyncHandler(ctrl.listNotifications, 'intent.listNotifications'));

// 锁场记录（自动锁场结果，倒序分页，只读，可按 ?intentId= 过滤）
router.get('/locks', asyncHandler(ctrl.listLocks, 'intent.listLocks'));

// 场地列表（引擎顺带记录，供全局优先级设置选择，只读）
router.get('/areas', asyncHandler(ctrl.listAreas, 'intent.listAreas'));

// 当日可订查询（透传外部接口，只读）
router.get('/availability', asyncHandler(ctrl.getAvailability, 'intent.getAvailability'));

module.exports = router;
