/**
 * 订场意图 — 配置 / 意图 / 推送记录的 CRUD 与查询
 *
 * 意图（booking intent）是长期有效的站位指令：启用期间每逢设定时间就监控
 * 并锁场（或仅提醒），没有"完成后自动结束"；不想要了就关闭或删除。
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
const { BOOKING_WINDOW_DAYS, dateStr, today, hhmmToMinutes } = require('./venueShared');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUSH_TYPES = ['wxpusher', 'pushplus', 'wecom', 'serverchan'];
const MIN_POLL_INTERVAL_SEC = 60;
const DEFAULT_POLL_INTERVAL_SEC = 120;
const INTENT_MODES = ['auto_lock', 'notify'];

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
const TOKEN_FILE = path.join(__dirname, '..', '..', 'runtime', 'gym-token');
const TOKEN_UPDATE_KEY_FILE = path.join(__dirname, '..', '..', 'runtime', 'token-update-key');

function readTokenUser() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
    if (t) return t;
  } catch (_) { /* 文件不存在属常态，回退 env */ }
  return process.env.GYM_TOKEN_USER || '';
}

/** token 更新接口的密钥：runtime/token-update-key，首次使用时生成（gitignored） */
function getTokenUpdateKey() {
  try {
    const k = fs.readFileSync(TOKEN_UPDATE_KEY_FILE, 'utf-8').trim();
    if (k) return k;
  } catch (_) { /* 首次，往下生成 */ }
  const key = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(TOKEN_UPDATE_KEY_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_UPDATE_KEY_FILE, key, { mode: 0o600 });
  return key;
}

/** 写入运行时 token（token 更新接口 / 捕获代理共用通道） */
function setRuntimeToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim());
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

// === 日期工具（单次/每周双模式共用） ===

function isWeeklyRow(row) {
  return row.weekdays !== null && row.weekdays !== undefined;
}

/** 单次模式且 date < 今天 → 过期（引擎跳过，输出 expired=true，数据保留） */
function isIntentExpired(row, todayStr = today()) {
  return !isWeeklyRow(row) && !!row.date && row.date < todayStr;
}

/**
 * 意图展开的可订日期集合：
 * - 单次模式：未过期 → [date]；过期 → []
 * - 每周模式：放票窗口（今天起 BOOKING_WINDOW_DAYS 天）内匹配 weekdays 的具体日期
 * - unavailable_days 标记的日期一律排除（场馆不开放，无需监控）
 */
function expandIntentDates(row, todayStr = today()) {
  let dates;
  if (!isWeeklyRow(row)) {
    dates = isIntentExpired(row, todayStr) ? [] : [row.date];
  } else {
    const weekdays = parseJson(row.weekdays, []);
    if (!Array.isArray(weekdays) || weekdays.length === 0) return [];
    const set = new Set(weekdays);
    dates = [];
    const base = new Date(`${todayStr}T00:00:00`);
    for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      if (set.has(d.getDay())) dates.push(dateStr(d));
    }
  }
  if (dates.length) {
    const excluded = new Set(prepare('SELECT date FROM unavailable_days').all().map(r => r.date));
    dates = dates.filter(d => !excluded.has(d));
  }
  return dates;
}

/** 日期是否在放票窗口内（今天 ~ 今天+BOOKING_WINDOW_DAYS-1） */
function isDateBookable(date, todayStr = today()) {
  const base = new Date(`${todayStr}T00:00:00`);
  const max = new Date(base);
  max.setDate(base.getDate() + BOOKING_WINDOW_DAYS - 1);
  return date >= todayStr && date <= dateStr(max);
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

function formatIntent(row, todayStr = today()) {
  const preferredAreaIds = parseJson(row.preferred_area_ids, []);
  return {
    id: row.id,
    mode: row.mode,
    date: isWeeklyRow(row) ? null : row.date,
    weekdays: isWeeklyRow(row) ? parseJson(row.weekdays, []) : null,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    durationHours: row.duration_hours,
    courtsNeeded: row.courts_needed,
    preferredAreaIds,
    preferredAreaNames: resolveAreaNames(preferredAreaIds),
    enabled: !!row.enabled,
    expired: isIntentExpired(row, todayStr),
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

function listIntents() {
  return prepare('SELECT * FROM booking_intents ORDER BY created_at ASC, window_start ASC').all()
    .map(row => formatIntent(row));
}

function getIntentById(id) {
  return prepare('SELECT * FROM booking_intents WHERE id = ?').get(id);
}

function createIntent(data) {
  const id = intentId();
  const weekly = Array.isArray(data.weekdays);
  prepare(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    data.mode || 'auto_lock',
    weekly ? null : data.date,
    weekly ? stringifyJson(data.weekdays) : null,
    data.windowStart,
    data.windowEnd,
    data.durationHours,
    Number.isInteger(data.courtsNeeded) ? data.courtsNeeded : 1,
    stringifyJson(Array.isArray(data.preferredAreaIds) ? data.preferredAreaIds : []),
    data.enabled === undefined ? 1 : (data.enabled ? 1 : 0)
  );
  return formatIntent(getIntentById(id));
}

function updateIntent(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    mode: 'mode',
    windowStart: 'window_start',
    windowEnd: 'window_end',
    durationHours: 'duration_hours',
    courtsNeeded: 'courts_needed',
    enabled: { column: 'enabled', transform: (v) => (v ? 1 : 0) }
  });

  // date / weekdays 二选一：传其一即切换模式，另一列清空
  if (patch.weekdays !== undefined) {
    sets.push('weekdays = ?', 'date = NULL');
    params.push(patch.weekdays === null ? null : stringifyJson(patch.weekdays));
  } else if (patch.date !== undefined) {
    sets.push('date = ?', 'weekdays = NULL');
    params.push(patch.date);
  }

  if (patch.preferredAreaIds !== undefined) {
    sets.push('preferred_area_ids = ?');
    params.push(stringifyJson(Array.isArray(patch.preferredAreaIds) ? patch.preferredAreaIds : []));
  }

  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    params.push(id);
    prepare(`UPDATE booking_intents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  return formatIntent(getIntentById(id));
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

function listNotifications({ pageNo = 1, pageSize = 20, intentId: filterIntentId } = {}) {
  const where = filterIntentId ? 'WHERE intent_id = ?' : '';
  const args = filterIntentId ? [filterIntentId] : [];
  const total = prepare(`SELECT COUNT(*) AS cnt FROM watch_notifications ${where}`).get(...args).cnt;
  const rows = prepare(`SELECT * FROM watch_notifications ${where}
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
  isDateBookable,
  expandIntentDates,
  listIntents,
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
