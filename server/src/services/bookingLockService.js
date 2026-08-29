/**
 * 订场锁场服务 — 意图命中可订时段时调外部 createOrder 下单锁场
 *
 * 满足判定（tryFulfill）：在意图的时间窗口内找一段**连续 duration_hours 小时**、
 * 且每小时可订场地数 ≥ courts_needed 的小时段（连续小时允许跨场地），逐格
 * createOrderCheck → createOrder（带签名）→ 落库。整段锁齐 = 该次发生满足，
 * 当日停手；锁不齐则已锁的保留，剩余等格子回流后再续。
 *
 * 两击降级（handleUnpaidReturn）：引擎 diff 发现"我锁过的格子再次 0→1"=
 * 超时未支付。第 1 次自动重锁并再发支付提醒；第 2 次该次发生降级为仅提醒
 * 并推送原因。计数持久化在 booking_intent_locks.unpaid_expired_count（重启不丢）。
 *
 * 去重：booking_intent_locks 对 uniq_no 的部分唯一索引（WHERE status='locked'）
 * 只拦"已锁到"的重复占坑；failed 记录不阻塞回流后的重抢。
 *
 * 任何失败（含 SignNotConfiguredError、check 不通过、网络错）都落
 * status='failed' 记录并返回 { success:false, error }，绝不抛出，
 * 保证锁场失败不炸引擎、不影响推送与其他意图。
 *
 * 未支付订单约 5 分钟自动过期释放，抢到后需用户在 5 分钟内手动支付
 * （WX_PAY 只能在微信客户端内调起）。
 */
const { prepare } = require('../config/db');
const logger = require('../utils/logger');
const { prefixedId } = require('../utils/id');
const { parseJson } = require('../utils/json');
const intentService = require('./intentService');
const gymOrderClient = require('./gymOrderClient');
const venueLockSigner = require('./venueLockSigner');
const notifier = require('./watchNotifier');
const { hhmmToMinutes } = require('./venueShared');

const UNPAID_EXPIRE_LIMIT = 2; // 同一时段超时未支付次数上限，达到即降级仅提醒

function lockId() {
  return prefixedId('bil');
}

/**
 * 组装 createOrderCheck/createOrder 的 areaItems 请求项。
 * 【已反编译确认】小程序直接把 listAreaLease 返回的原始 item 对象放进
 * areaItems（含 status/showStatus 等全部字段），因此优先透传 slot.raw；
 * 缺 raw 时（如手工构造数据）退化为按已知字段组装。
 */
function buildAreaItems(slot) {
  if (slot.raw && typeof slot.raw === 'object') return [{ ...slot.raw }];
  return [{
    areaId: slot.areaId,
    uniqNo: slot.uniqNo,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    price: slot.price ?? undefined
  }];
}

/** 业务失败文案：优先外部接口返回的 msg/message */
function bizError(prefix, resp) {
  const msg = resp && resp.body && (resp.body.msg || resp.body.message);
  return msg ? `${prefix}：${msg}` : `${prefix}（HTTP ${resp ? resp.status : '无响应'}）`;
}

function insertLockRecord({ intentId, slot, status, orderId = null, error = null }) {
  prepare(`INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    lockId(),
    intentId,
    slot.uniqNo,
    slot.date,
    slot.startTime,
    slot.endTime,
    slot.areaId ?? null,
    slot.areaName || '',
    orderId,
    status,
    error
  );
}

function notify(env, title, content) {
  return notifier.notify({
    type: env.pushType,
    url: env.pushUrl,
    token: env.pushToken,
    topic: env.pushTopic,
    title,
    content
  });
}

// === 下单原语 ===

/**
 * 对单个 slot 执行 createOrderCheck → createOrder。
 * @returns {Promise<{ success: boolean, orderId?: string, error?: string }>} 绝不抛出
 */
async function placeOrder(slot) {
  try {
    const areaItems = buildAreaItems(slot);

    const check = await gymOrderClient.createOrderCheck(areaItems);
    // 成功判定【已反编译确认】：HTTP 2xx 后看 body.data.success === 'Y'
    // （'N' = 冲突/不可订，原因在 body.data.code，如 LIMITED_BY_START_TIME）
    if (!check.httpOk || !check.body || !check.body.data || check.body.data.success !== 'Y') {
      const reason = (check.body && check.body.data && check.body.data.code)
        || (check.body && (check.body.msg || check.body.message));
      return { success: false, error: `下单前校验未通过：${reason || `HTTP ${check.status}`}` };
    }

    const created = await gymOrderClient.createOrder(areaItems);
    // 成功判定【已反编译确认】：body.code === 200；429/403004 = 触发风控需验证码
    if (!created.httpOk || !created.body || created.body.code !== 200) {
      const code = created.body && created.body.code;
      const error = (code === 429 || code === 403004)
        ? '自动锁场触发风控，需在小程序内完成验证码后重试'
        : bizError('自动锁场下单失败', created);
      return { success: false, error };
    }

    // 订单号字段【已反编译确认】：列表/支付页使用 areaOrderId，兜底 orderId/id
    const data = created.body.data || {};
    const orderId = data.areaOrderId || data.orderId || data.id ? String(data.areaOrderId || data.orderId || data.id) : null;
    return { success: true, orderId };
  } catch (err) {
    logger.error(`bookingLock.placeOrder - ${slot.uniqNo}: ${err.message}`);
    return { success: false, error: `自动锁场异常：${err.message}` };
  }
}

/**
 * 尝试对单个 slot 锁场（含"已锁到"去重；失败记录不阻塞后续重试）。
 * @returns {Promise<{ success: boolean, skipped?: boolean, orderId?: string, error?: string }>}
 */
async function attemptLock({ intent, slot, date }) {
  const uniqNo = slot.uniqNo;
  const existing = prepare(`SELECT order_id FROM booking_intent_locks WHERE uniq_no = ? AND status = 'locked'`).get(uniqNo);
  if (existing) {
    return { success: true, skipped: true, orderId: existing.order_id || undefined };
  }

  const lockSlot = { ...slot, date };
  const result = await placeOrder(lockSlot);
  try {
    insertLockRecord({
      intentId: intent.id,
      slot: lockSlot,
      status: result.success ? 'locked' : 'failed',
      orderId: result.orderId || null,
      error: result.success ? null : result.error
    });
  } catch (insertErr) {
    // 部分唯一索引兜底并发双锁等极端情况：落库失败只记日志，不再抛出
    logger.error(`bookingLock.attemptLock - ${uniqNo} 记录落库异常: ${insertErr.message}`);
    if (result.success) return { success: true, skipped: true, orderId: result.orderId };
  }
  return result;
}

// === 满足判定（连续时长，允许跨场地） ===

/** 该意图在某天已锁到的记录（status='locked'） */
function lockedRowsFor(intentId, date) {
  return prepare(`SELECT * FROM booking_intent_locks
    WHERE intent_id = ? AND date = ? AND status = 'locked' ORDER BY start_time ASC`)
    .all(intentId, date);
}

/**
 * 该次发生是否已满足：窗口内存在一段连续 duration_hours 小时、
 * 每小时 locked 数 ≥ courts_needed 的小时段。
 */
function occurrenceFulfilled(intent, date) {
  return !!findRun(buildHourMap(intent, date, []), intent);
}

/** 该次发生是否已降级为仅提醒（任一格两击超时未支付） */
function isDowngraded(intentId, date) {
  return !!prepare(`SELECT 1 FROM booking_intent_locks
    WHERE intent_id = ? AND date = ? AND status = 'locked' AND unpaid_expired_count >= ? LIMIT 1`)
    .get(intentId, date, UNPAID_EXPIRE_LIMIT);
}

/**
 * 聚合窗口内每小时的可订/已锁场地。
 * @returns {Map<string, { startMin: number, endMin: number, available: object[], lockedCount: number }>}
 *   key = startTime（'HH:MM'）
 */
function buildHourMap(intent, date, daySlots) {
  const map = new Map();
  for (const slot of daySlots) {
    if (slot.available !== 1) continue;
    if (slot.startTime < intent.window_start || slot.endTime > intent.window_end) continue;
    if (!map.has(slot.startTime)) {
      map.set(slot.startTime, {
        startMin: hhmmToMinutes(slot.startTime),
        endMin: hhmmToMinutes(slot.endTime),
        available: [],
        lockedCount: 0
      });
    }
    map.get(slot.startTime).available.push(slot);
  }
  for (const row of lockedRowsFor(intent.id, date)) {
    if (row.start_time < intent.window_start || row.end_time > intent.window_end) continue;
    if (!map.has(row.start_time)) {
      map.set(row.start_time, {
        startMin: hhmmToMinutes(row.start_time),
        endMin: hhmmToMinutes(row.end_time),
        available: [],
        lockedCount: 0
      });
    }
    map.get(row.start_time).lockedCount += 1;
  }
  return map;
}

/**
 * 在 hourMap 中找一段连续 duration_hours 小时、每小时可锁数
 * （当前可订 + 我已锁）≥ courts_needed 的小时段。
 * 多候选时按最早开始取一段；返回按开始时间排序的小时数组或 null。
 */
function findRun(hourMap, intent) {
  const hours = [...hourMap.values()].sort((a, b) => a.startMin - b.startMin);
  let run = [];
  for (const hour of hours) {
    const prev = run[run.length - 1];
    const consecutive = prev && prev.endMin === hour.startMin;
    const enough = (hour.available.length + hour.lockedCount) >= intent.courts_needed;
    run = consecutive && enough ? [...run, hour] : (enough ? [hour] : []);
    if (run.length >= intent.duration_hours) return run.slice(0, intent.duration_hours);
  }
  return null;
}

/**
 * 尝试满足该意图在某日的订场需求。引擎在每次 diff 后对命中的
 * auto_lock 意图调用；幂等：已满足/已降级/无可行段时直接返回。
 *
 * @param {object} intent booking_intents 行
 * @param {string} date YYYY-MM-DD
 * @param {object[]} daySlots 该日 flattenSlots 结果（含 available 与 raw）
 * @param {object} env intentService.getEnvConfig()
 * @returns {Promise<{ fulfilled: boolean, locked: number, failed: number, skipped?: string }>}
 */
async function tryFulfill(intent, date, daySlots, env) {
  if (!venueLockSigner.isSignerConfigured()) return { fulfilled: false, locked: 0, failed: 0, skipped: 'no_signer' };
  if (isDowngraded(intent.id, date)) return { fulfilled: false, locked: 0, failed: 0, skipped: 'downgraded' };

  const hourMap = buildHourMap(intent, date, daySlots);
  if (occurrenceFulfilled(intent, date)) return { fulfilled: true, locked: 0, failed: 0, skipped: 'fulfilled' };

  // 场地偏好：意图自身 preferred_area_ids 优先；为空时回退全局 area_priority
  const preferenceIds = parseJson(intent.preferred_area_ids, []);
  const priorityIds = preferenceIds.length ? preferenceIds : intentService.getAreaPriority();
  const preference = new Map(priorityIds.map((id, i) => [id, i]));

  const run = findRun(hourMap, intent);
  if (!run) return { fulfilled: false, locked: 0, failed: 0, skipped: 'no_run' };

  let locked = 0;
  let failed = 0;
  for (const hour of run) {
    let need = intent.courts_needed - hour.lockedCount;
    if (need <= 0) continue;
    const candidates = hour.available
      .slice()
      .sort((a, b) =>
        (preference.get(a.areaId) ?? Number.MAX_SAFE_INTEGER) - (preference.get(b.areaId) ?? Number.MAX_SAFE_INTEGER));
    for (const slot of candidates) {
      if (need <= 0) break;
      let result;
      try {
        result = await attemptLock({ intent, slot, date });
      } catch (err) {
        result = { success: false, error: `自动锁场异常：${err.message}` };
      }
      if (result.success) {
        if (!result.skipped) locked += 1;
        need -= 1;
      } else {
        failed += 1;
      }
    }
  }

  if (occurrenceFulfilled(intent, date)) {
    await notifyFulfilled(intent, date, env);
    return { fulfilled: true, locked, failed };
  }
  // 锁不齐：已锁的保留，剩余等格子回流后由后续触发续锁
  return { fulfilled: false, locked, failed };
}

/** 整段锁齐：一条醒目推送（含订单号与 5 分钟支付提醒） */
async function notifyFulfilled(intent, date, env) {
  const rows = lockedRowsFor(intent.id, date);
  const lines = rows.map(r =>
    `- ${r.area_name || '场地'} ${r.start_time}-${r.end_time} 订单号 ${r.order_id || '未知'}`);
  const result = await notify(env,
    `【已锁场】${date} ${rows.length} 个时段`,
    `**${date} 自动锁场成功**\n\n${lines.join('\n')}\n\n请 5 分钟内在小程序完成支付，超时订单自动释放。`);
  if (!result.success) {
    logger.error(`bookingLock.fulfilledNotify - ${result.error}`);
  }
}

// === 两击降级：我锁过的格子超时未支付回流 ===

/**
 * 引擎 diff 发现 0→1 时调用：若该格子有我的 locked 记录，说明订单超时未支付。
 * 第 1 次自动重锁并再发支付提醒；第 2 次（unpaid_expired_count 达到上限）
 * 该次发生降级为仅提醒并推送原因。
 *
 * @returns {Promise<{ handled: boolean, downgraded?: boolean }>} handled=false 表示不是我锁的格子
 */
async function handleUnpaidReturn(slot, env) {
  const row = prepare(`SELECT * FROM booking_intent_locks
    WHERE uniq_no = ? AND status = 'locked' ORDER BY created_at DESC LIMIT 1`).get(slot.uniqNo);
  if (!row) return { handled: false };

  const intent = intentService.getIntentById(row.intent_id);
  if (!intent || !intent.enabled) return { handled: false };

  const count = (row.unpaid_expired_count || 0) + 1;

  if (count >= UNPAID_EXPIRE_LIMIT) {
    prepare('UPDATE booking_intent_locks SET unpaid_expired_count = ? WHERE id = ?').run(count, row.id);
    const content = `**${row.date} ${row.area_name || '场地'} ${row.start_time}-${row.end_time}** 锁场订单两次超时未支付，本次订场意图已降级为**仅提醒**，场地再次可订时只推送通知、不再自动锁场。`;
    const result = await notify(env, `【已降级】${row.date} ${row.start_time}`, content);
    intentService.recordNotification({
      intentId: intent.id,
      uniqNo: row.uniq_no,
      areaName: row.area_name,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      success: result.success,
      error: result.success ? null : result.error
    });
    logger.info(`bookingLock.downgrade - intent ${intent.id} ${row.date} ${row.start_time} 两击超时未支付，降级仅提醒`);
    return { handled: true, downgraded: true };
  }

  // 第 1 次：自动重锁（原行更新，保持部分唯一索引一行一 locked）
  const lockSlot = {
    uniqNo: row.uniq_no,
    areaId: slot.areaId ?? row.area_id,
    areaName: slot.areaName || row.area_name || '',
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    price: slot.price ?? null,
    raw: slot.raw
  };
  const result = await placeOrder(lockSlot);
  if (result.success) {
    prepare(`UPDATE booking_intent_locks
      SET order_id = ?, unpaid_expired_count = ?, error = NULL, created_at = datetime('now')
      WHERE id = ?`).run(result.orderId || null, count, row.id);
    const notifyResult = await notify(env,
      `【重新锁场】${row.date} ${row.start_time}`,
      `**${row.date} ${row.area_name || '场地'} ${row.start_time}-${row.end_time}** 上一订单超时未支付已释放，系统已自动重新锁场（订单号 ${result.orderId || '未知'}）。请 5 分钟内在小程序完成支付；再次超时本次意图将降级为仅提醒。`);
    intentService.recordNotification({
      intentId: intent.id,
      uniqNo: row.uniq_no,
      areaName: lockSlot.areaName,
      date: row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      success: notifyResult.success,
      error: notifyResult.success ? null : notifyResult.error
    });
    logger.info(`bookingLock.relock - intent ${intent.id} ${row.date} ${row.start_time} 超时未支付，已重锁`);
  } else {
    // 重锁失败（格子被他人抢先）：holding 已死，原行转 failed 释放 uniq_no 占位，
    // 格子下次回流时由 tryFulfill 按新尝试重抢
    prepare(`UPDATE booking_intent_locks SET status = 'failed', error = ? WHERE id = ?`)
      .run(`超时未支付后重锁失败：${result.error}`, row.id);
    logger.error(`bookingLock.relock - intent ${intent.id} ${row.date} ${row.start_time} 重锁失败: ${result.error}`);
  }
  return { handled: true, downgraded: false };
}

// === 锁场记录查询（GET /locks 分页） ===

function formatLockRecord(row) {
  return {
    id: row.id,
    intentId: row.intent_id,
    uniqNo: row.uniq_no,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    areaId: row.area_id,
    areaName: row.area_name || '',
    orderId: row.order_id,
    status: row.status,
    error: row.error,
    unpaidExpiredCount: row.unpaid_expired_count,
    createdAt: row.created_at
  };
}

function listLockRecords({ pageNo = 1, pageSize = 20, intentId: filterIntentId } = {}) {
  const where = filterIntentId ? 'WHERE intent_id = ?' : '';
  const args = filterIntentId ? [filterIntentId] : [];
  const total = prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks ${where}`).get(...args).cnt;
  const rows = prepare(`SELECT * FROM booking_intent_locks ${where}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (pageNo - 1) * pageSize);
  return { list: rows.map(formatLockRecord), total, pageNo, pageSize };
}

module.exports = {
  UNPAID_EXPIRE_LIMIT,
  buildAreaItems,
  attemptLock,
  tryFulfill,
  handleUnpaidReturn,
  occurrenceFulfilled,
  isDowngraded,
  lockedRowsFor,
  listLockRecords,
  formatLockRecord
};
