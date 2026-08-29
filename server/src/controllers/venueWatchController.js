const { success, error, notFound, validationError } = require('../utils/response');
const venueWatchService = require('../services/venueWatchService');
const venueWatchPoller = require('../services/venueWatchPoller');
const venueWatchDigest = require('../services/venueWatchDigest');
const venueWatchNotifier = require('../services/venueWatchNotifier');
const {
  validateDateText,
  validateTimeText
} = require('../utils/validators');

// === 配置（v2：凭证走服务器 .env，这里只管总开关） ===

function getConfig(req, res) {
  success(res, venueWatchService.getConfig());
}

function updateConfig(req, res) {
  if (typeof req.body.enabled !== 'boolean') {
    return validationError(res, '总开关必须是布尔值');
  }
  success(res, venueWatchService.updateConfig({ enabled: req.body.enabled }));
}

// === 监控目标 ===

function validateWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0) return '星期几必须是非空数组';
  const seen = new Set();
  for (const d of value) {
    if (!Number.isInteger(d) || d < 0 || d > 6) return '星期几必须是 0-6 的整数（0=周日）';
    if (seen.has(d)) return '星期几不能重复';
    seen.add(d);
  }
  return null;
}

function validateAreaIds(value) {
  if (!Array.isArray(value)) return '场地列表必须是数组';
  for (const id of value) {
    if (!Number.isInteger(id) || id < 0) return '场地ID必须是非负整数';
  }
  return null;
}

/**
 * date 与 weekdays 二选一（创建时必填其一）。
 * partial 模式（更新）下两者都省略表示不切换模式。
 */
function validateTargetPayload(body, options = {}) {
  const { partial = false } = options;

  const hasDate = body.date !== undefined && body.date !== null;
  const hasWeekdays = body.weekdays !== undefined && body.weekdays !== null;

  if (hasDate && hasWeekdays) return '监控日期与每周重复只能二选一';
  if (!partial && !hasDate && !hasWeekdays) return '请填写监控日期或选择每周重复';

  if (hasDate) {
    const dateError = validateDateText(body.date, '监控日期', { required: true });
    if (dateError) return dateError;
    // 场馆只放今天起 4 天的票，窗口外的日期无法监控
    if (!venueWatchService.isDateBookable(body.date)) {
      return '监控日期只能选今天起 4 天内（场馆只放 4 天的票）';
    }
  }
  if (hasWeekdays) {
    const weekdaysError = validateWeekdays(body.weekdays);
    if (weekdaysError) return weekdaysError;
  }

  const startError = validateTimeText(body.startTime, '开始时间', { required: !partial });
  if (startError) return startError;

  const endError = validateTimeText(body.endTime, '结束时间', { required: !partial });
  if (endError) return endError;

  if (body.areaIds !== undefined && body.areaIds !== null) {
    const areaIdsError = validateAreaIds(body.areaIds);
    if (areaIdsError) return areaIdsError;
  }

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return '启用状态必须是布尔值';
  }

  if (body.excludeUnavailable !== undefined && typeof body.excludeUnavailable !== 'boolean') {
    return '排除不可用日期开关必须是布尔值';
  }

  return null;
}

function listTargets(req, res) {
  success(res, venueWatchService.listTargets());
}

function createTarget(req, res) {
  const payloadError = validateTargetPayload(req.body);
  if (payloadError) return validationError(res, payloadError);
  if (req.body.startTime >= req.body.endTime) {
    return validationError(res, '结束时间必须晚于开始时间');
  }
  const { date, weekdays, startTime, endTime, areaIds, excludeUnavailable, enabled } = req.body;
  const target = venueWatchService.createTarget({
    date: date ?? null,
    weekdays: weekdays ?? null,
    startTime,
    endTime,
    areaIds: areaIds ?? [],
    excludeUnavailable,
    enabled
  });
  success(res, target, 201);
}

function updateTarget(req, res) {
  const existing = venueWatchService.getTargetById(req.params.id);
  if (!existing) return notFound(res, '监控目标不存在');

  const payloadError = validateTargetPayload(req.body, { partial: true });
  if (payloadError) return validationError(res, payloadError);

  const { date, weekdays, startTime, endTime, areaIds, excludeUnavailable, enabled } = req.body;
  const finalStart = startTime ?? existing.start_time;
  const finalEnd = endTime ?? existing.end_time;
  if (finalStart >= finalEnd) return validationError(res, '结束时间必须晚于开始时间');

  const patch = { startTime, endTime, excludeUnavailable, enabled };
  // 显式 null 视为未提供，避免误清空模式；date/weekdays 传其一即切换模式
  if (weekdays !== undefined && weekdays !== null) patch.weekdays = weekdays;
  else if (date !== undefined && date !== null) patch.date = date;
  if (areaIds !== undefined) patch.areaIds = areaIds;
  success(res, venueWatchService.updateTarget(req.params.id, patch));
}

function deleteTarget(req, res) {
  const existing = venueWatchService.getTargetById(req.params.id);
  if (!existing) return notFound(res, '监控目标不存在');
  success(res, venueWatchService.deleteTarget(req.params.id));
}

// === 推送历史 ===

function listNotifications(req, res) {
  const pageNo = Math.max(parseInt(req.query.pageNo, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 100);
  success(res, venueWatchService.listNotifications({ pageNo, pageSize }));
}

// === 当日可订查询（外部接口透传，只读） ===

async function getAvailability(req, res) {
  const dateError = validateDateText(req.query.date, '查询日期', { required: true });
  if (dateError) return validationError(res, dateError);

  const env = venueWatchService.getEnvConfig();
  if (!env.tokenUser) return validationError(res, '请先在服务器 .env 配置小程序 token');

  const resp = await venueWatchPoller.fetchAreaLease(req.query.date, env.tokenUser);
  if (resp.body && resp.body.code === 401) {
    return validationError(res, '小程序 token 已失效，请更新服务器 .env 并重启');
  }
  if (!resp.httpOk || !resp.body || !resp.body.data) {
    return error(res, '查询场馆可订状态失败，请稍后再试', 'UPSTREAM_ERROR', 502);
  }
  success(res, resp.body.data);
}

// === 手动触发轮询 ===

async function pollNow(req, res) {
  const result = await venueWatchPoller.pollOnce();
  success(res, { dates: result.dates, notified: result.notified });
}

// === 每日场次汇总（digest） ===

/** 构造 digest；失败时按 availability 的方式直接响应错误，返回 null */
async function loadDigestOrRespond(req, res) {
  const env = venueWatchService.getEnvConfig();
  if (!env.tokenUser) {
    validationError(res, '请先在服务器 .env 配置小程序 token');
    return null;
  }
  const digest = await venueWatchDigest.buildDigest(env);
  if (digest.error === 'token_invalid') {
    validationError(res, '小程序 token 已失效，请更新服务器 .env 并重启');
    return null;
  }
  if (digest.error) {
    error(res, '查询场馆可订状态失败，请稍后再试', 'UPSTREAM_ERROR', 502);
    return null;
  }
  return { env, digest };
}

async function getDigest(req, res) {
  const loaded = await loadDigestOrRespond(req, res);
  if (!loaded) return;
  success(res, { title: loaded.digest.title, content: loaded.digest.content });
}

async function sendDigest(req, res) {
  const loaded = await loadDigestOrRespond(req, res);
  if (!loaded) return;
  const { env, digest } = loaded;
  if (!env.pushConfigured) return validationError(res, '请先在服务器 .env 配置推送通道');

  const result = await venueWatchNotifier.notify({
    type: env.pushType,
    url: env.pushUrl,
    token: env.pushToken,
    topic: env.pushTopic,
    title: digest.title,
    content: digest.content
  });
  success(res, {
    success: result.success,
    title: digest.title,
    ...(result.success ? {} : { error: result.error })
  });
}

module.exports = {
  getConfig,
  updateConfig,
  listTargets,
  createTarget,
  updateTarget,
  deleteTarget,
  listNotifications,
  getAvailability,
  pollNow,
  getDigest,
  sendDigest
};
