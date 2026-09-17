const { success, error, notFound, validationError } = require('../utils/response');
const intentService = require('../services/intentService');
const watchEngine = require('../services/watchEngine');
const bookingLockService = require('../services/bookingLockService');
const lockRun = require('../services/lockRun');
const { validateDateText } = require('../utils/validators');
const crypto = require('crypto');

// 字段校验全部在 validators/intentValidators.js（express-validator 声明式 +
// 跨字段 custom），本层只做 404 存在性检查、状态事实注入与服务编排。

/** 查询参数只接受非空字符串（数组/对象一律当未提供） */
function queryText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * 意图状态事实提供者：引擎风控重试集 + 锁场锁齐判定 + 最近一次尝试。
 * 派生只有 intentService.deriveIntentStatus 一处，这里只负责供料。
 */
function intentStatusFacts() {
  const retries = watchEngine.getRiskRetries();
  const retryByKey = new Map(retries.map(r => [`${r.intentId}|${r.date}`, r]));
  const riskRetryKeys = new Set(retryByKey.keys());
  return (row) => {
    const retry = retryByKey.get(`${row.id}|${row.date}`) || null;
    return {
      riskRetryKeys,
      isFulfilled: lockRun.isOccurrenceFulfilled(row, bookingLockService.lockedRowsFor(row.id, row.date)),
      verifyDeadline: retry ? new Date(retry.deadline).toISOString() : null,
      lastAttempt: bookingLockService.lastAttemptFor(row.id, row.date)
    };
  };
}

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
  const from = queryText(req.query.from);
  const to = queryText(req.query.to);
  for (const [value, label] of [[from, '开始日期'], [to, '结束日期']]) {
    const dateError = validateDateText(value, label);
    if (dateError) return validationError(res, dateError);
  }
  const rows = intentService.listIntents({ from, to }, intentStatusFacts());
  success(res, rows);
}

function createIntent(req, res) {
  const { mode, date, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled } = req.body;
  const intent = intentService.createIntent({
    mode,
    date,
    windowStart,
    windowEnd,
    durationHours,
    courtsNeeded,
    preferredAreaIds: preferredAreaIds ?? [],
    enabled
  }, intentStatusFacts());
  success(res, intent, 201);
}

function updateIntent(req, res) {
  const existing = intentService.getIntentById(req.params.id);
  if (!existing) return notFound(res, '订场意图不存在');

  const { mode, date, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled } = req.body;
  const patch = {};
  if (mode !== undefined) patch.mode = mode;
  if (windowStart !== undefined) patch.windowStart = windowStart;
  if (windowEnd !== undefined) patch.windowEnd = windowEnd;
  if (durationHours !== undefined) patch.durationHours = durationHours;
  if (courtsNeeded !== undefined) patch.courtsNeeded = courtsNeeded;
  if (enabled !== undefined) patch.enabled = enabled;
  if (preferredAreaIds !== undefined) patch.preferredAreaIds = preferredAreaIds;
  // 显式 null 视为未提供，避免误清空日期
  if (date !== undefined && date !== null) patch.date = date;
  const updated = intentService.updateIntent(req.params.id, patch, intentStatusFacts());
  // 停用 → 启用：通知引擎下一 tick 直接评估当前在架可订（锁到即停后的手动重开入口）
  if (!existing.enabled && patch.enabled === true) {
    watchEngine.requestEvaluation(req.params.id);
  }
  success(res, updated);
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

// === 推送历史（可按意图 / 日期过滤） ===

function listNotifications(req, res) {
  const pageNo = Math.max(parseInt(req.query.pageNo, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const date = queryText(req.query.date);
  const dateError = validateDateText(date, '日期');
  if (dateError) return validationError(res, dateError);
  success(res, intentService.listNotifications({ pageNo, pageSize, intentId: queryText(req.query.intentId), date }));
}

// === 锁场记录（自动锁场结果，倒序分页，可按意图 / 日期过滤） ===

function listLocks(req, res) {
  const pageNo = Math.max(parseInt(req.query.pageNo, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  const date = queryText(req.query.date);
  const dateError = validateDateText(date, '日期');
  if (dateError) return validationError(res, dateError);
  success(res, bookingLockService.listLockRecords({ pageNo, pageSize, intentId: queryText(req.query.intentId), date }));
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

// === 更新小程序 token（供 Stream 抓包后快捷指令上报；独立于管理令牌的专用密钥） ===

function updateToken(req, res) {
  const key = req.get('x-token-key') || '';
  const expected = intentService.getTokenUpdateKey();
  const ok = key.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
  if (!ok) return error(res, 'token 更新密钥无效', 'FORBIDDEN', 403);

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (token.length < 10 || /\s/.test(token)) return validationError(res, 'token 格式不对');
  intentService.setRuntimeToken(token);
  success(res, { updated: true, tokenPreview: `${token.slice(0, 6)}…` });
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
  getAvailability,
  updateToken
};
