const { success, error, notFound, validationError } = require('../utils/response');
const intentService = require('../services/intentService');
const watchEngine = require('../services/watchEngine');
const bookingLockService = require('../services/bookingLockService');
const { validateDateText } = require('../utils/validators');

// 字段校验全部在 validators/intentValidators.js（express-validator 声明式 +
// 跨字段 custom），本层只做 404 存在性检查与服务编排。

// === 配置（凭证走服务器 .env，这里只管总开关与全局场地优先级） ===

function getConfig(req, res) {
  success(res, intentService.getConfig());
}

function updateConfig(req, res) {
  const patch = {};
  if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
  if (req.body.areaPriority !== undefined) patch.areaPriority = req.body.areaPriority;
  success(res, intentService.updateConfig(patch));
}

// === 订场意图 ===

function listIntents(req, res) {
  success(res, intentService.listIntents());
}

function createIntent(req, res) {
  const { mode, date, weekdays, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled } = req.body;
  const intent = intentService.createIntent({
    mode,
    date: date ?? null,
    weekdays: weekdays ?? null,
    windowStart,
    windowEnd,
    durationHours,
    courtsNeeded,
    preferredAreaIds: preferredAreaIds ?? [],
    enabled
  });
  success(res, intent, 201);
}

function updateIntent(req, res) {
  const existing = intentService.getIntentById(req.params.id);
  if (!existing) return notFound(res, '订场意图不存在');

  const { mode, date, weekdays, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled } = req.body;
  const patch = {};
  if (mode !== undefined) patch.mode = mode;
  if (windowStart !== undefined) patch.windowStart = windowStart;
  if (windowEnd !== undefined) patch.windowEnd = windowEnd;
  if (durationHours !== undefined) patch.durationHours = durationHours;
  if (courtsNeeded !== undefined) patch.courtsNeeded = courtsNeeded;
  if (enabled !== undefined) patch.enabled = enabled;
  if (preferredAreaIds !== undefined) patch.preferredAreaIds = preferredAreaIds;
  // 显式 null 视为未提供，避免误清空模式；date/weekdays 传其一即切换模式
  if (weekdays !== undefined && weekdays !== null) patch.weekdays = weekdays;
  else if (date !== undefined && date !== null) patch.date = date;
  success(res, intentService.updateIntent(req.params.id, patch));
}

function deleteIntent(req, res) {
  const existing = intentService.getIntentById(req.params.id);
  if (!existing) return notFound(res, '订场意图不存在');
  success(res, intentService.deleteIntent(req.params.id));
}

// === 场地列表（引擎顺带记录，供全局优先级设置选择） ===

function listAreas(req, res) {
  success(res, intentService.listAreas());
}

// === 推送历史（可按意图过滤） ===

function listNotifications(req, res) {
  const pageNo = Math.max(parseInt(req.query.pageNo, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  success(res, intentService.listNotifications({ pageNo, pageSize, intentId: req.query.intentId || undefined }));
}

// === 锁场记录（自动锁场结果，倒序分页，可按意图过滤） ===

function listLocks(req, res) {
  const pageNo = Math.max(parseInt(req.query.pageNo, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  success(res, bookingLockService.listLockRecords({ pageNo, pageSize, intentId: req.query.intentId || undefined }));
}

// === 当日可订查询（外部接口透传，只读） ===

async function getAvailability(req, res) {
  const dateError = validateDateText(req.query.date, '查询日期', { required: true });
  if (dateError) return validationError(res, dateError);

  const env = intentService.getEnvConfig();
  if (!env.tokenUser) return validationError(res, '请先在服务器 .env 配置小程序 token');

  const resp = await watchEngine.fetchAreaLease(req.query.date, env.tokenUser);
  if (resp.body && resp.body.code === 401) {
    return validationError(res, '小程序 token 已失效，请更新服务器 .env 并重启');
  }
  // 场次尚未开售（放票窗口最后一天在 9:00 前）：透传上游文案
  if (resp.body && resp.body.code === 403) {
    return validationError(res, resp.body.message || '该日期场次尚未开始售卖');
  }
  if (!resp.httpOk || !resp.body || !resp.body.data) {
    return error(res, '查询场馆可订状态失败，请稍后再试', 'UPSTREAM_ERROR', 502);
  }
  success(res, resp.body.data);
}

module.exports = {
  getConfig,
  updateConfig,
  listIntents,
  createIntent,
  updateIntent,
  deleteIntent,
  listAreas,
  listNotifications,
  listLocks,
  getAvailability
};
