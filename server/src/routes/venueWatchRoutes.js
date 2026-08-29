const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/venueWatchController');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const {
  updateConfigRules,
  createTargetRules,
  updateTargetRules
} = require('../validators/venueWatchValidators');

// 配置（GET 脱敏输出；PUT 受全局 requireWriteAuth 保护）
router.get('/config', asyncHandler(ctrl.getConfig, 'venueWatch.getConfig'));
router.put('/config', updateConfigRules, validate, asyncHandler(ctrl.updateConfig, 'venueWatch.updateConfig'));

// 监控目标
router.get('/targets', asyncHandler(ctrl.listTargets, 'venueWatch.listTargets'));
router.post('/targets', createTargetRules, validate, asyncHandler(ctrl.createTarget, 'venueWatch.createTarget'));
router.put('/targets/:id', updateTargetRules, validate, asyncHandler(ctrl.updateTarget, 'venueWatch.updateTarget'));
router.delete('/targets/:id', asyncHandler(ctrl.deleteTarget, 'venueWatch.deleteTarget'));

// 推送历史（倒序分页）
router.get('/notifications', asyncHandler(ctrl.listNotifications, 'venueWatch.listNotifications'));

// 当日可订查询（透传外部接口，只读）
router.get('/availability', asyncHandler(ctrl.getAvailability, 'venueWatch.getAvailability'));

// 每日场次汇总：预览排版 / 推送（POST 受全局 requireWriteAuth 保护）
router.get('/digest', asyncHandler(ctrl.getDigest, 'venueWatch.getDigest'));
router.post('/digest/send', asyncHandler(ctrl.sendDigest, 'venueWatch.sendDigest'));

// 手动触发一次轮询
router.post('/poll-now', asyncHandler(ctrl.pollNow, 'venueWatch.pollNow'));

module.exports = router;
