/**
 * 订场监控轮询器 — 定时拉取外部场馆可订状态，diff 快照表，0→1 命中目标时推送（v2）
 *
 * - start()/stop() 由 server.js 在 listen 成功 / gracefulShutdown 时调用
 * - pollOnce() 供 POST /poll-now 手动触发与测试使用
 * - 凭证/推送参数每 tick 读 process.env（改 .env 后需重启生效）；
 *   缺 GYM_TOKEN_USER 或推送配置时跳过该 tick
 * - 目标双模式：单日（date < 今天即过期跳过）/ 每周（weekdays 展开未来 7 天）
 * - 首 poll（slot_state 为空）只播种基线不推送，避免启动刷屏
 * - 外部接口 401（body.code === 401）时告警一次（token_invalid_notified 去重），
 *   一次成功轮询后清零
 *
 * 安全：token 只出现在请求头，绝不写日志。
 */
const { prepare, transaction } = require('../config/db');
const logger = require('../utils/logger');
const venueWatchService = require('./venueWatchService');
const notifier = require('./venueWatchNotifier');
const { buildNotifyTitle } = require('./venueWatchDigest');
const { parseJson } = require('../utils/json');

const LIST_AREA_LEASE_URL = 'https://shop.chuanshatiyuchang.cn/gym/miniprogram/venue/listAreaLease';
const FETCH_TIMEOUT_MS = 15000;
const JITTER_MAX_MS = 15000;

let timer = null;
let stopped = true;
let polling = false;

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStr(d);
}

/**
 * 拉取某日可订状态。网络异常 / 超时抛出；HTTP 错误或业务码不抛出，
 * 由调用方检查 body.code（401 = 登录态失效）。
 */
async function fetchAreaLease(date, tokenUser) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${LIST_AREA_LEASE_URL}?venueSportId=1&date=${encodeURIComponent(date)}`;
    const resp = await fetch(url, {
      headers: {
        'token-user': tokenUser,
        'x-gym-client-id': '1',
        'content-type': 'application/json'
      },
      signal: controller.signal
    });
    const body = await resp.json().catch(() => null);
    return { httpOk: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function isSlotAvailable(item) {
  return item && item.status === 'NORMAL' && item.showStatus === 'AVAILABLE' ? 1 : 0;
}

/** 外部响应 → 扁平 slot 列表（字段缺失的条目跳过） */
function flattenSlots(date, data) {
  const slots = [];
  for (const area of (data && data.areas) || []) {
    for (const item of area.items || []) {
      if (!item || !item.uniqNo) continue;
      slots.push({
        uniqNo: item.uniqNo,
        areaId: area.areaId ?? null,
        areaName: area.areaName || '',
        date,
        startTime: item.startTime || '',
        endTime: item.endTime || '',
        price: item.price ?? null,
        available: isSlotAvailable(item)
      });
    }
  }
  return slots;
}

/** 启用目标 → 展开日期集合（单日过期 / 每周无匹配日期的目标被过滤掉） */
function loadActiveTargets() {
  const rows = prepare('SELECT * FROM venue_watch_targets WHERE enabled = 1').all();
  return rows
    .map(row => ({
      row,
      dates: new Set(venueWatchService.expandTargetDates(row)),
      areaIds: new Set(parseJson(row.area_ids, []))
    }))
    .filter(t => t.dates.size > 0);
}

function matchesTarget(slot, target) {
  if (!target.dates.has(slot.date)) return false;
  if (!(slot.startTime >= target.row.start_time && slot.startTime < target.row.end_time)) return false;
  if (target.areaIds.size > 0 && !target.areaIds.has(slot.areaId)) return false;
  return true;
}

function buildMarkdown(date, slots) {
  const lines = slots.map(s => {
    const price = s.price !== null && s.price !== undefined ? ` ¥${s.price}` : '';
    return `- ${s.areaName || '场地'} ${s.startTime}-${s.endTime}${price}`;
  });
  return `**${date} 场地可订提醒**\n\n${lines.join('\n')}\n\n共 ${slots.length} 个时段可订，请尽快预订。`;
}

function notifyWith(env, title, content) {
  return notifier.notify({
    type: env.pushType,
    url: env.pushUrl,
    token: env.pushToken,
    topic: env.pushTopic,
    title,
    content
  });
}

async function notifyTokenInvalid(env) {
  const flags = venueWatchService.getFlags();
  if (flags.tokenInvalidNotified) return;
  const result = await notifyWith(env, '订场监控告警',
    '**小程序 token 已失效**，请更新服务器 .env 并重启。');
  if (result.success) {
    venueWatchService.setTokenInvalidNotified(true);
  } else {
    logger.error(`venueWatch.tokenInvalidAlert - ${result.error}`);
  }
}

/**
 * 执行一次轮询。
 * @returns {Promise<{ dates: string[], notified: number, baseline?: boolean, skipped?: string }>}
 */
async function pollOnce() {
  if (polling) return { dates: [], notified: 0, skipped: 'in_progress' };
  polling = true;
  try {
    return await doPoll();
  } finally {
    polling = false;
  }
}

async function doPoll() {
  const flags = venueWatchService.getFlags();
  if (!flags.enabled) return { dates: [], notified: 0, skipped: 'disabled' };

  const env = venueWatchService.getEnvConfig();
  if (!env.tokenUser) return { dates: [], notified: 0, skipped: 'no_token' };
  if (!env.pushConfigured) return { dates: [], notified: 0, skipped: 'no_webhook' };

  const targets = loadActiveTargets();
  const dates = [...new Set(targets.flatMap(t => [...t.dates]))].sort();
  if (dates.length === 0) return { dates: [], notified: 0, skipped: 'no_targets' };

  // 首 poll 基线：快照表为空时只播种不推送
  const baseline = prepare('SELECT COUNT(*) AS cnt FROM venue_watch_slot_state').get().cnt === 0;

  const transitions = [];
  for (const date of dates) {
    let resp;
    try {
      resp = await fetchAreaLease(date, env.tokenUser);
    } catch (err) {
      logger.error(`venueWatch.poll - 拉取 ${date} 失败: ${err.message}`);
      continue;
    }
    if (resp.body && resp.body.code === 401) {
      await notifyTokenInvalid(env);
      return { dates, notified: 0, skipped: 'token_invalid' };
    }
    if (!resp.httpOk || !resp.body || !resp.body.data) {
      logger.error(`venueWatch.poll - ${date} 响应异常 (HTTP ${resp.status})`);
      continue;
    }

    const slots = flattenSlots(date, resp.body.data);
    transaction(() => {
      // 顺带清理过期快照（date < 今天-1）
      prepare('DELETE FROM venue_watch_slot_state WHERE date < ?').run(yesterday());
      // 顺带记录场地名映射，供目标输出 areaNames
      venueWatchService.recordAreaNames((resp.body.data && resp.body.data.areas) || []);
      for (const slot of slots) {
        const old = prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(slot.uniqNo);
        const oldAvailable = old ? old.available : 0;
        prepare(`INSERT INTO venue_watch_slot_state (uniq_no, date, available, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(uniq_no) DO UPDATE SET available = excluded.available, updated_at = excluded.updated_at`)
          .run(slot.uniqNo, slot.date, slot.available);
        // 仅 0→1（含新出现的 key）触发；1→0 只更新快照
        if (!baseline && oldAvailable === 0 && slot.available === 1) {
          transitions.push(slot);
        }
      }
    });
  }

  // 一次成功轮询后清零 401 告警标记
  if (flags.tokenInvalidNotified) {
    venueWatchService.setTokenInvalidNotified(false);
  }

  let notified = 0;
  if (!baseline && transitions.length > 0) {
    // 同一 tick 同一目标同一日期命中的多 slot 合并为一条推送
    const byTargetDate = new Map();
    for (const slot of transitions) {
      for (const target of targets) {
        if (!matchesTarget(slot, target)) continue;
        const key = `${target.row.id}|${slot.date}`;
        if (!byTargetDate.has(key)) byTargetDate.set(key, []);
        byTargetDate.get(key).push(slot);
      }
    }

    for (const slots of byTargetDate.values()) {
      const date = slots[0].date;
      const result = await notifyWith(env, buildNotifyTitle(date, slots), buildMarkdown(date, slots));
      notified += 1;
      if (!result.success) {
        logger.error(`venueWatch.notify - ${result.error}`);
      }
      transaction(() => {
        for (const slot of slots) {
          venueWatchService.recordNotification({
            uniqNo: slot.uniqNo,
            areaName: slot.areaName,
            date: slot.date,
            startTime: slot.startTime,
            endTime: slot.endTime,
            price: slot.price,
            success: result.success,
            error: result.success ? null : result.error
          });
        }
      });
    }
  }

  return { dates, notified, ...(baseline ? { baseline: true } : {}) };
}

function scheduleNext() {
  if (stopped) return;
  let intervalMs = 120000;
  try {
    intervalMs = venueWatchService.getEnvConfig().pollIntervalSec * 1000;
  } catch (_) { /* 异常时用默认间隔 */ }
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  timer = setTimeout(tick, intervalMs + jitter);
  if (timer.unref) timer.unref();
}

async function tick() {
  try {
    await pollOnce();
  } catch (err) {
    logger.error(`venueWatch.tick - ${err.message}`);
  }
  scheduleNext();
}

function start() {
  if (!stopped) return;
  stopped = false;
  scheduleNext();
}

function stop() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // 进行中的 tick 不等待，其 DB 写入由自身事务保证一致性
}

module.exports = { start, stop, pollOnce, fetchAreaLease };
