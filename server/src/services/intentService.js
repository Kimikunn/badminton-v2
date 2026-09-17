/**
 * 订场意图 — 配置 / 意图 / 推送记录的 CRUD 与查询
 *
 * 单模型（2026-09-17 用户决策 D6）：一条意图绑定一个具体日期（date），一天可有
 * 多条（多时段）；不再有每周重复。启用期间到了放票时间就监控并锁场（或仅提醒），
 * 锁到即停（成功后意图自动 enabled=0）。提前设置（窗口外的未来日期）允许，进窗口
 * 后自动生效。
 *
 * 每条意图的对外 `status` 由 deriveIntentStatus() 纯函数派生（唯一事实来源，顺序即
 * 契约），外部事实（引擎风控重试集、锁场满足事实）由 controller 注入。
 *
 * 凭证与推送参数全部来自服务器环境变量（GYM_TOKEN_USER / PUSH_TYPE /
 * PUSH_TOKEN / PUSH_TOPIC / PUSH_URL / POLL_INTERVAL_SEC），每次调用实时读
 * process.env；DB 的 watch_config 只保留 enabled、告警去重标记与全局场地
 * 优先级。接口输出绝不包含凭证原文，只暴露是否已配置的布尔值。
 */
const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');
const { prefixedId } = require('../utils/id');
const { parseJson, stringifyJson } = require('../utils/json');
const { BOOKING_WINDOW_DAYS, RUSH_HOUR, dateStr, today, hhmmToMinutes } = require('./venueShared');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUSH_TYPES = ['wxpusher', 'pushplus', 'wecom', 'serverchan'];
const MIN_POLL_INTERVAL_SEC = 60;
const DEFAULT_POLL_INTERVAL_SEC = 120;
const INTENT_MODES = ['auto_lock', 'notify'];

// formatIntent 缺省 ctx 的共享空集合（避免每行新建 Set）
const EMPTY_RETRY_KEYS = new Set();

function intentId() {
  return prefixedId('int');
}

function notificationId() {
  return prefixedId('ntf');
}

// === 环境变量配置 ===

/** 推送通道是否已配置：pushplus 需 PUSH_TOKEN，wxpusher 需 PUSH_TOKEN+PUSH_TOPIC，wecom/serverchan 需 PUSH_URL */
function isPushConfigured(type, token, url, topic) {
  if (!PUSH_TYPES.includes(type)) return false;
  if (type === 'wxpusher') return !!token && !!topic;
  return type === 'pushplus' ? !!token : !!url;
}

/**
 * 实时读取环境变量配置。敏感值仅供引擎内部使用，禁止用于接口输出与日志。
 *
 * token-user 优先读运行时文件 server/runtime/gym-token（token 捕获代理抓到
 * 新 token 时写入，见 tools/tokenproxy/），文件不存在才回退 GYM_TOKEN_USER
 * 环境变量——token 是短期凭证会过期，活文件让它免重启热更新。
 */
// 运行时目录每次调用实时解析：测试用 GYM_RUNTIME_DIR 隔离，避免并发测试文件互相污染
// （gym-token 由 token 捕获代理 / token 更新接口写入，模块级常量会锁死生产目录）
function runtimeFile(name) {
  const dir = process.env.GYM_RUNTIME_DIR || path.join(__dirname, '..', '..', 'runtime');
  return path.join(dir, name);
}

function readTokenUser() {
  try {
    const t = fs.readFileSync(runtimeFile('gym-token'), 'utf-8').trim();
    if (t) return t;
  } catch (_) { /* 文件不存在属常态，回退 env */ }
  return process.env.GYM_TOKEN_USER || '';
}

/** token 更新接口的密钥：runtime/token-update-key，首次使用时生成（gitignored） */
function getTokenUpdateKey() {
  const keyFile = runtimeFile('token-update-key');
  try {
    const k = fs.readFileSync(keyFile, 'utf-8').trim();
    if (k) return k;
  } catch (_) { /* 首次，往下生成 */ }
  const key = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}

/** 写入运行时 token（token 更新接口 / 捕获代理共用通道） */
function setRuntimeToken(token) {
  const file = runtimeFile('gym-token');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token.trim());
}

function getEnvConfig() {
  const type = process.env.PUSH_TYPE || 'wxpusher';
  const tokenUser = readTokenUser();
  const pushToken = process.env.PUSH_TOKEN || '';
  const pushUrl = process.env.PUSH_URL || '';
  const pushTopic = process.env.PUSH_TOPIC || '';
  const interval = parseInt(process.env.POLL_INTERVAL_SEC, 10);
  const orderLimit = parseInt(process.env.GYM_DAILY_ORDER_LIMIT, 10);
  return {
    tokenUser,
    pushType: type,
    pushToken,
    pushTopic,
    pushUrl,
    pollIntervalSec: Math.max(Number.isInteger(interval) ? interval : DEFAULT_POLL_INTERVAL_SEC, MIN_POLL_INTERVAL_SEC),
    // 场馆每账号每日限订笔数（默认 2；场馆放宽后改 GYM_DAILY_ORDER_LIMIT 并重启）
    dailyOrderLimit: Number.isInteger(orderLimit) && orderLimit > 0 ? orderLimit : 2,
    gymTokenConfigured: !!tokenUser,
    pushConfigured: isPushConfigured(type, pushToken, pushUrl, pushTopic)
  };
}

// === 日期工具（单模型：只有一个具体日期） ===

/** 单次模式且 date < 今天 → 过期（引擎跳过，输出 status='expired'，数据保留） */
function isIntentExpired(row, todayStr = today()) {
  return !!row.date && row.date < todayStr;
}

/** 放票窗口最后一天（今天 + BOOKING_WINDOW_DAYS - 1） */
function windowEndDate(todayStr = today()) {
  const d = new Date(`${todayStr}T00:00:00`);
  d.setDate(d.getDate() + BOOKING_WINDOW_DAYS - 1);
  return dateStr(d);
}

/**
 * 意图展开的可订日期集合：未过期 → [date]；过期 → []；
 * unavailable_days 标记的日期排除（场馆不开放，无需监控）。
 */
function expandIntentDates(row, todayStr = today()) {
  if (!row.date) return [];
  let dates = isIntentExpired(row, todayStr) ? [] : [row.date];
  if (dates.length) {
    const excluded = new Set(prepare('SELECT date FROM unavailable_days').all().map(r => r.date));
    dates = dates.filter(d => !excluded.has(d));
  }
  return dates;
}

// === 状态派生（唯一事实来源；顺序即契约） ===

/**
 * 纯函数：不含 IO。ctx 的所有外部事实由调用方注入，便于逐条测试。
 * 优先级从上往下，首个命中即为准；**顺序即契约，改顺序必须改测试**。
 *
 *   1 expired          date < today
 *   2 awaiting_verify  引擎风控重试窗口内（riskRetryKeys 含 `${id}|${date}`）
 *   3 fulfilled        该意图当天 locked 记录能凑齐整段
 *   4 pending_release  date === windowEnd 且当前本地时刻 < RUSH_HOUR(09:00)
 *   5 waiting          enabled && date > windowEnd
 *   6 watching         enabled && date ∈ [today, windowEnd]
 *   7 paused           其余（!enabled && date ∈ 窗口）
 *
 * 不可用日（unavailable_days）是正交的日期维度，不参与本状态机。
 *
 * @param {object} row booking_intents 行
 * @param {{today: string, now: Date, windowEnd: string, riskRetryKeys: Set<string>, isFulfilled: boolean}} ctx
 */
function deriveIntentStatus(row, ctx) {
  if (isIntentExpired(row, ctx.today)) return 'expired';
  if (ctx.riskRetryKeys && ctx.riskRetryKeys.has(`${row.id}|${row.date}`)) return 'awaiting_verify';
  if (ctx.isFulfilled) return 'fulfilled';
  if (row.enabled && row.date === ctx.windowEnd && ctx.now.getHours() < RUSH_HOUR) return 'pending_release';
  if (row.enabled && row.date > ctx.windowEnd) return 'waiting';
  if (row.enabled && row.date >= ctx.today && row.date <= ctx.windowEnd) return 'watching';
  return 'paused';
}

/**
 * 每日清扫：过期意图（date < today）置为 enabled=0（保留行与历史）。
 * 读路径不写库，清扫由引擎 tick 触发（每日一次）。
 * @returns {number} 被停用的行数
 */
function sweepExpiredIntents(todayStr = today()) {
  return prepare('UPDATE booking_intents SET enabled = 0 WHERE date < ? AND enabled = 1').run(todayStr).changes;
}

// === 格式化输出 ===

function getConfigRow() {
  return prepare('SELECT * FROM watch_config WHERE id = 1').get();
}

/** 对外输出：只暴露布尔与开关，绝不回凭证原文 */
function getConfig() {
  const row = getConfigRow();
  const env = getEnvConfig();
  const areaPriority = parseJson(row.area_priority, []);
  return {
    enabled: !!row.enabled,
    pushConfigured: env.pushConfigured,
    gymTokenConfigured: env.gymTokenConfigured,
    pollIntervalSec: env.pollIntervalSec,
    areaPriority,
    areaPriorityNames: resolveAreaNames(areaPriority)
  };
}

/** 内部使用（引擎）：全局开关与告警去重标记 */
function getFlags() {
  const row = getConfigRow();
  return {
    enabled: !!row.enabled,
    tokenInvalidNotified: !!row.token_invalid_notified,
    pollFailureNotified: !!row.poll_failure_notified
  };
}

/** 全局锁场场地优先级（有序 areaId 数组，空 = 按场馆返回顺序） */
function getAreaPriority() {
  return parseJson(getConfigRow().area_priority, []);
}

/** 按 areaIds 解析场地名（来自引擎记录的 watch_areas；查不到则省略） */
function resolveAreaNames(areaIds) {
  if (!areaIds.length) return [];
  const placeholders = areaIds.map(() => '?').join(', ');
  const rows = prepare(`SELECT area_id, area_name FROM watch_areas WHERE area_id IN (${placeholders})`)
    .all(...areaIds);
  const nameById = new Map(rows.map(r => [r.area_id, r.area_name]));
  return areaIds.map(id => nameById.get(id)).filter(Boolean);
}

/**
 * 意图对外输出。status 由 deriveIntentStatus 派生；ctx 缺省时只按时间事实派生
 * （create/update 响应与单元测试），controller 会注入引擎重试集与锁场事实。
 *
 * @param {object} row booking_intents 行
 * @param {{today?: string, now?: Date, windowEnd?: string, riskRetryKeys?: Set<string>,
 *   isFulfilled?: boolean, verifyDeadline?: string|null, lastAttempt?: object|null}} [ctx]
 */
function formatIntent(row, ctx = {}) {
  const todayStr = ctx.today || today();
  const status = deriveIntentStatus(row, {
    today: todayStr,
    now: ctx.now || new Date(),
    windowEnd: ctx.windowEnd || windowEndDate(todayStr),
    riskRetryKeys: ctx.riskRetryKeys || EMPTY_RETRY_KEYS,
    isFulfilled: !!ctx.isFulfilled
  });
  const preferredAreaIds = parseJson(row.preferred_area_ids, []);
  return {
    id: row.id,
    mode: row.mode,
    date: row.date,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationHours: row.duration_hours,
    courtsNeeded: row.courts_needed,
    preferredAreaIds,
    preferredAreaNames: resolveAreaNames(preferredAreaIds),
    enabled: !!row.enabled,
    status,
    // 风控验证截止时间（引擎注入）：只在 awaiting_verify 时对外暴露
    verifyDeadline: status === 'awaiting_verify' ? (ctx.verifyDeadline || null) : null,
    lastAttempt: ctx.lastAttempt || null,
    expired: status === 'expired', // 兼容位，等价 date < today
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatNotification(row) {
  return {
    id: row.id,
    intentId: row.intent_id,
    uniqNo: row.uniq_no,
    areaName: row.area_name || '',
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    price: row.price,
    success: !!row.success,
    error: row.error,
    createdAt: row.created_at
  };
}

// === 配置 ===

/** 只接受 { enabled, areaPriority }，凭证走 .env 不在此更新 */
function updateConfig(patch) {
  const { sets, params } = buildUpdate(patch, {
    enabled: { column: 'enabled', transform: (v) => (v ? 1 : 0) },
    areaPriority: { column: 'area_priority', transform: (v) => stringifyJson(Array.isArray(v) ? v : []) }
  });

  sets.push(`updated_at = datetime('now')`);
  prepare(`UPDATE watch_config SET ${sets.join(', ')} WHERE id = 1`).run(...params);
  return getConfig();
}

function setTokenInvalidNotified(value) {
  prepare('UPDATE watch_config SET token_invalid_notified = ? WHERE id = 1').run(value ? 1 : 0);
}

function setPollFailureNotified(value) {
  prepare('UPDATE watch_config SET poll_failure_notified = ? WHERE id = 1').run(value ? 1 : 0);
}

/** 引擎顺带记录的场地列表（供全局优先级设置选择） */
function listAreas() {
  return prepare('SELECT area_id AS areaId, area_name AS areaName FROM watch_areas ORDER BY area_id ASC').all();
}

// === 订场意图 ===

function listIntents({ from, to } = {}, statusCtxFor = null) {
  const where = [];
  const args = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  const rows = prepare(`SELECT * FROM booking_intents ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at ASC, window_start ASC`).all(...args);
  // statusCtxFor 由 controller 注入每行的引擎事实（风控重试 / 锁场满足）
  return rows.map(row => formatIntent(row, statusCtxFor ? statusCtxFor(row) : {}));
}

function getIntentById(id) {
  return prepare('SELECT * FROM booking_intents WHERE id = ?').get(id);
}

/**
 * 同一天同一时间窗口是否已有监控（编辑时用 excludeId 排除自身）。
 * 判定为“日期 + 窗口起 + 窗口止”完全相同；部分重叠不算重复。
 */
function findByWindow({ date, windowStart, windowEnd, excludeId = null } = {}) {
  if (!date || !windowStart || !windowEnd) return null;
  return prepare(`SELECT * FROM booking_intents
    WHERE date = ? AND window_start = ? AND window_end = ? AND id != COALESCE(?, '')
    LIMIT 1`).get(date, windowStart, windowEnd, excludeId) || null;
}

function createIntent(data, statusCtxFor = null) {
  const id = intentId();
  prepare(`INSERT INTO booking_intents (id, mode, date, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    data.mode || 'auto_lock',
    data.date,
    data.windowStart,
    data.windowEnd,
    data.durationHours,
    Number.isInteger(data.courtsNeeded) ? data.courtsNeeded : 1,
    stringifyJson(Array.isArray(data.preferredAreaIds) ? data.preferredAreaIds : []),
    data.enabled === undefined ? 1 : (data.enabled ? 1 : 0)
  );
  const row = getIntentById(id);
  return formatIntent(row, statusCtxFor ? statusCtxFor(row) : {});
}

function updateIntent(id, patch, statusCtxFor = null) {
  const { sets, params } = buildUpdate(patch, {
    mode: 'mode',
    date: 'date',
    windowStart: 'window_start',
    windowEnd: 'window_end',
    durationHours: 'duration_hours',
    courtsNeeded: 'courts_needed',
    enabled: { column: 'enabled', transform: (v) => (v ? 1 : 0) }
  });

  if (patch.preferredAreaIds !== undefined) {
    sets.push('preferred_area_ids = ?');
    params.push(stringifyJson(Array.isArray(patch.preferredAreaIds) ? patch.preferredAreaIds : []));
  }

  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    params.push(id);
    prepare(`UPDATE booking_intents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  const row = getIntentById(id);
  return formatIntent(row, statusCtxFor ? statusCtxFor(row) : {});
}

function deleteIntent(id) {
  prepare('DELETE FROM booking_intents WHERE id = ?').run(id);
  return null;
}

// === 场地名映射（引擎拉取时顺带记录） ===

function recordAreaNames(areas) {
  for (const area of areas) {
    if (!area || area.areaId === null || area.areaId === undefined) continue;
    prepare(`INSERT INTO watch_areas (area_id, area_name, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(area_id) DO UPDATE SET area_name = excluded.area_name, updated_at = excluded.updated_at`)
      .run(area.areaId, area.areaName || '');
  }
}

// === 推送记录 ===

function listNotifications({ pageNo = 1, pageSize = 20, intentId: filterIntentId, date: filterDate } = {}) {
  const where = [];
  const args = [];
  if (filterIntentId) { where.push('intent_id = ?'); args.push(filterIntentId); }
  if (filterDate) { where.push('date = ?'); args.push(filterDate); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = prepare(`SELECT COUNT(*) AS cnt FROM watch_notifications ${whereSql}`).get(...args).cnt;
  const rows = prepare(`SELECT * FROM watch_notifications ${whereSql}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (pageNo - 1) * pageSize);
  return { list: rows.map(formatNotification), total, pageNo, pageSize };
}

function recordNotification(data) {
  const id = notificationId();
  prepare(`INSERT INTO watch_notifications (id, intent_id, uniq_no, area_name, date, start_time, end_time, price, success, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    data.intentId || null,
    data.uniqNo,
    data.areaName || '',
    data.date,
    data.startTime,
    data.endTime,
    data.price ?? null,
    data.success ? 1 : 0,
    data.error || null
  );
  return id;
}

module.exports = {
  PUSH_TYPES,
  MIN_POLL_INTERVAL_SEC,
  BOOKING_WINDOW_DAYS,
  INTENT_MODES,
  getEnvConfig,
  getTokenUpdateKey,
  setRuntimeToken,
  getConfig,
  getFlags,
  updateConfig,
  setTokenInvalidNotified,
  setPollFailureNotified,
  getAreaPriority,
  listAreas,
  isIntentExpired,
  windowEndDate,
  deriveIntentStatus,
  sweepExpiredIntents,
  expandIntentDates,
  listIntents,
  findByWindow,
  getIntentById,
  createIntent,
  updateIntent,
  deleteIntent,
  recordAreaNames,
  listNotifications,
  recordNotification,
  formatIntent,
  formatNotification
};
