/**
 * 订场监控 — 配置 / 监控目标 / 推送记录的 CRUD 与查询（v2）
 *
 * v2：凭证与推送参数全部来自服务器环境变量（GYM_TOKEN_USER / PUSH_TYPE /
 * PUSH_TOKEN / PUSH_TOPIC / PUSH_URL / POLL_INTERVAL_SEC），每次调用实时读
 * process.env；DB 的 venue_watch_config 只保留 enabled 与 token_invalid_notified。
 * 接口输出绝不包含凭证原文，只暴露是否已配置的布尔值。
 */
const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');
const { prefixedId } = require('../utils/id');
const { parseJson, stringifyJson } = require('../utils/json');

const PUSH_TYPES = ['wxpusher', 'pushplus', 'wecom', 'serverchan'];
const MIN_POLL_INTERVAL_SEC = 60;
const DEFAULT_POLL_INTERVAL_SEC = 120;
// 场馆放票窗口：今天起 4 天（今天~第 4 天，每天 9:00 滚动放第 4 天的票）
const BOOKING_WINDOW_DAYS = 4;

function targetId() {
  return prefixedId('vwt');
}

function notificationId() {
  return prefixedId('vwn');
}

// === 环境变量配置（v2） ===

/** 推送通道是否已配置：pushplus 需 PUSH_TOKEN，wxpusher 需 PUSH_TOKEN+PUSH_TOPIC，wecom/serverchan 需 PUSH_URL */
function isPushConfigured(type, token, url, topic) {
  if (!PUSH_TYPES.includes(type)) return false;
  if (type === 'wxpusher') return !!token && !!topic;
  return type === 'pushplus' ? !!token : !!url;
}

/**
 * 实时读取环境变量配置。敏感值仅供 poller 内部使用，禁止用于接口输出与日志。
 */
function getEnvConfig() {
  const type = process.env.PUSH_TYPE || 'wxpusher';
  const tokenUser = process.env.GYM_TOKEN_USER || '';
  const pushToken = process.env.PUSH_TOKEN || '';
  const pushUrl = process.env.PUSH_URL || '';
  const pushTopic = process.env.PUSH_TOPIC || '';
  const interval = parseInt(process.env.POLL_INTERVAL_SEC, 10);
  return {
    tokenUser,
    pushType: type,
    pushToken,
    pushTopic,
    pushUrl,
    pollIntervalSec: Math.max(Number.isInteger(interval) ? interval : DEFAULT_POLL_INTERVAL_SEC, MIN_POLL_INTERVAL_SEC),
    gymTokenConfigured: !!tokenUser,
    pushConfigured: isPushConfigured(type, pushToken, pushUrl, pushTopic)
  };
}

// === 日期工具（单日/每周双模式共用） ===

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() {
  return dateStr(new Date());
}

function isWeeklyRow(row) {
  return row.weekdays !== null && row.weekdays !== undefined;
}

/** 单日模式且 date < 今天 → 过期（poller 跳过，输出 expired=true） */
function isTargetExpired(row, todayStr = today()) {
  return !isWeeklyRow(row) && !!row.date && row.date < todayStr;
}

/**
 * 目标展开的轮询日期集合：
 * - 单日模式：未过期 → [date]；过期 → []
 * - 每周模式：放票窗口（今天起 BOOKING_WINDOW_DAYS 天）内匹配 weekdays 的具体日期
 * - row.exclude_unavailable=1 时，过滤掉 unavailable_days 标记的日期
 *   （单日被排除 → 展开为空、不轮询；每周逐日排除）
 */
function expandTargetDates(row, todayStr = today()) {
  let dates;
  if (!isWeeklyRow(row)) {
    dates = isTargetExpired(row, todayStr) ? [] : [row.date];
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
  if (dates.length && row.exclude_unavailable) {
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
  return prepare('SELECT * FROM venue_watch_config WHERE id = 1').get();
}

/** 对外输出：只暴露布尔与开关，绝不回凭证原文 */
function getConfig() {
  const row = getConfigRow();
  const env = getEnvConfig();
  return {
    enabled: !!row.enabled,
    pushConfigured: env.pushConfigured,
    gymTokenConfigured: env.gymTokenConfigured,
    pollIntervalSec: env.pollIntervalSec
  };
}

/** 内部使用（poller）：全局开关与 401 告警去重标记 */
function getFlags() {
  const row = getConfigRow();
  return {
    enabled: !!row.enabled,
    tokenInvalidNotified: !!row.token_invalid_notified
  };
}

/** 按 areaIds 解析场地名（来自 poller 记录的 venue_watch_areas；查不到则省略） */
function resolveAreaNames(areaIds) {
  if (!areaIds.length) return [];
  const placeholders = areaIds.map(() => '?').join(', ');
  const rows = prepare(`SELECT area_id, area_name FROM venue_watch_areas WHERE area_id IN (${placeholders})`)
    .all(...areaIds);
  const nameById = new Map(rows.map(r => [r.area_id, r.area_name]));
  return areaIds.map(id => nameById.get(id)).filter(Boolean);
}

function formatTarget(row, todayStr = today()) {
  const areaIds = parseJson(row.area_ids, []);
  return {
    id: row.id,
    date: isWeeklyRow(row) ? null : row.date,
    weekdays: isWeeklyRow(row) ? parseJson(row.weekdays, []) : null,
    startTime: row.start_time,
    endTime: row.end_time,
    areaIds,
    areaNames: resolveAreaNames(areaIds),
    excludeUnavailable: !!row.exclude_unavailable,
    enabled: !!row.enabled,
    expired: isTargetExpired(row, todayStr),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatNotification(row) {
  return {
    id: row.id,
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

/** v2：只接受 { enabled }，凭证走 .env 不在此更新 */
function updateConfig(patch) {
  const { sets, params } = buildUpdate(patch, {
    enabled: { column: 'enabled', transform: (v) => (v ? 1 : 0) }
  });

  sets.push(`updated_at = datetime('now')`);
  prepare(`UPDATE venue_watch_config SET ${sets.join(', ')} WHERE id = 1`).run(...params);
  return getConfig();
}

function setTokenInvalidNotified(value) {
  prepare('UPDATE venue_watch_config SET token_invalid_notified = ? WHERE id = 1').run(value ? 1 : 0);
}

// === 监控目标 ===

function listTargets() {
  return prepare('SELECT * FROM venue_watch_targets ORDER BY created_at ASC, start_time ASC').all()
    .map(row => formatTarget(row));
}

function getTargetById(id) {
  return prepare('SELECT * FROM venue_watch_targets WHERE id = ?').get(id);
}

function createTarget(data) {
  const id = targetId();
  const weekly = Array.isArray(data.weekdays);
  prepare(`INSERT INTO venue_watch_targets (id, date, weekdays, start_time, end_time, area_ids, exclude_unavailable, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    weekly ? null : data.date,
    weekly ? stringifyJson(data.weekdays) : null,
    data.startTime,
    data.endTime,
    stringifyJson(Array.isArray(data.areaIds) ? data.areaIds : []),
    data.excludeUnavailable === undefined ? 1 : (data.excludeUnavailable ? 1 : 0),
    data.enabled === undefined ? 1 : (data.enabled ? 1 : 0)
  );
  return formatTarget(getTargetById(id));
}

function updateTarget(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    startTime: 'start_time',
    endTime: 'end_time',
    excludeUnavailable: { column: 'exclude_unavailable', transform: (v) => (v ? 1 : 0) },
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

  if (patch.areaIds !== undefined) {
    sets.push('area_ids = ?');
    params.push(stringifyJson(Array.isArray(patch.areaIds) ? patch.areaIds : []));
  }

  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    params.push(id);
    prepare(`UPDATE venue_watch_targets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  return formatTarget(getTargetById(id));
}

function deleteTarget(id) {
  prepare('DELETE FROM venue_watch_targets WHERE id = ?').run(id);
  return null;
}

// === 场地名映射（poller 拉取时顺带记录） ===

function recordAreaNames(areas) {
  for (const area of areas) {
    if (!area || area.areaId === null || area.areaId === undefined) continue;
    prepare(`INSERT INTO venue_watch_areas (area_id, area_name, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(area_id) DO UPDATE SET area_name = excluded.area_name, updated_at = excluded.updated_at`)
      .run(area.areaId, area.areaName || '');
  }
}

// === 推送记录 ===

function listNotifications({ pageNo = 1, pageSize = 20 }) {
  const total = prepare('SELECT COUNT(*) AS cnt FROM venue_watch_notifications').get().cnt;
  const rows = prepare(`SELECT * FROM venue_watch_notifications
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(pageSize, (pageNo - 1) * pageSize);
  return { list: rows.map(formatNotification), total, pageNo, pageSize };
}

function recordNotification(data) {
  const id = notificationId();
  prepare(`INSERT INTO venue_watch_notifications (id, uniq_no, area_name, date, start_time, end_time, price, success, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
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
  getEnvConfig,
  getConfig,
  getFlags,
  updateConfig,
  setTokenInvalidNotified,
  isTargetExpired,
  isDateBookable,
  expandTargetDates,
  listTargets,
  getTargetById,
  createTarget,
  updateTarget,
  deleteTarget,
  recordAreaNames,
  listNotifications,
  recordNotification,
  formatTarget,
  formatNotification
};
