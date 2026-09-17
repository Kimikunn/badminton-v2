/**
 * 订场锁场服务 — 意图命中可订时段时调外部 createOrder 下单锁场
 *
 * 满足判定（tryFulfill）：在意图的时间窗口内找一段**连续 duration_hours 小时**、
 * 且每小时可订场地数 ≥ courts_needed 的小时段（连续小时允许跨场地），把这段的
 * 全部片次**打包成一笔订单**（createOrderCheck → createOrder，带签名）后落库。
 *
 * 整单打包（2026-09-17 实测决策）：一笔订单可装多个片次；逐片次各下一笔会撞上
 * 场馆“有未支付订单就不能再下单”的限制（UNPAID），整段永远凑不齐。
 *
 * 场馆反馈 → 行为映射（2026-09-17）：
 * - createOrderCheck 的 LIMITED_BY_START_TIME 是“距开场不足 12 小时不可退款”的
 *   软提示，不阻断下单（实测该码后 createOrder 仍返回 200）；成功后推送注明不可退款。
 * - createOrder 文案含“未支付订单” → UNPAID：不再重试，推「需要先支付」并自动停用
 *   意图（用户付款后在订场页重新打开开关即可继续抢）。
 * - 429/403004 图形验证 → RISK_CONTROL：本轮放弃，交引擎 4 分钟重试窗口。
 *
 * 锁到即停（2026-08-30 用户决策）：整段锁齐 = 成功，意图自动停用，
 * 由用户判断是否支付——不支付就手动重开意图，支付了本就不再需要监控。
 * 部分锁齐（时长没凑够）不停用，继续等回流续锁。
 *
 * 不跟踪支付：锁场成功即终点，系统不关心支付结果。引擎发现"我锁过的格子
 * 再次 0→1"时只做一件事：记录标记为 expired（释放每日限订额度与 uniq_no
 * 占位），不重锁、不推送（markExpiredOnReturn）。
 *
 * 去重：booking_intent_locks 对 uniq_no 的部分唯一索引（WHERE status='locked'）
 * 只拦"已锁到"的重复占坑；failed / expired 记录不阻塞回流后的重抢。
 *
 * 任何失败（含 SignNotConfiguredError、check 不通过、网络错）都落
 * status='failed' 记录并返回 { success:false, error }，绝不抛出，
 * 保证锁场失败不炸引擎、不影响推送与其他意图。
 *
 * 支付截止：下单响应 expireTime（实测为北京时间）转 UTC 落 booking_intent_locks.expire_at，
 * 推送时再按北京时间渲染，比“约 5 分钟”更准（migration 019）；未支付订单仍约 5 分钟
 * 自动过期释放（WX_PAY 只能在微信客户端内调起）。
 */
const { prepare } = require('../config/db');
const logger = require('../utils/logger');
const { prefixedId } = require('../utils/id');
const { parseJson } = require('../utils/json');
const intentService = require('./intentService');
const lockRun = require('./lockRun');
const gymOrderClient = require('./gymOrderClient');
const venueLockSigner = require('./venueLockSigner');
const notifier = require('./watchNotifier');
const { hhmmToMinutes } = require('./venueShared');

function lockId() {
  return prefixedId('bil');
}

/**
 * 组装 createOrderCheck/createOrder 的 areaItems 请求项（整单全部片次，≤2 条）。
 * 【已反编译确认】小程序直接把 listAreaLease 返回的原始 item 对象放进
 * areaItems（含 status/showStatus 等全部字段），因此优先透传 item.raw；
 * 缺 raw 时（如手工构造数据）退化为按已知字段组装。
 */
function buildAreaItems(items) {
  return items.map(item => {
    if (item.raw && typeof item.raw === 'object') return { ...item.raw };
    return {
      areaId: item.areaId,
      uniqNo: item.uniqNo,
      date: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      price: item.price ?? undefined
    };
  });
}

/** 业务失败文案：优先外部接口返回的 msg/message */
function bizError(prefix, resp) {
  const msg = resp && resp.body && (resp.body.msg || resp.body.message);
  return msg ? `${prefix}：${msg}` : `${prefix}（HTTP ${resp ? resp.status : '无响应'}）`;
}

/**
 * 失败原因 → 结构化错误码（RISK_CONTROL | SOLDOUT | LIMIT | UNPAID | OTHER）。
 * 判定顺序：风控 → 未支付 → 限订 → 下单前校验失败/已被预订 → 其他；
 * 优先用上游业务码（如 BOOKING_CONFLICT），中文文案仅作兜底，UI 不靠文案匹配。
 * 注意：check 阶段的 LIMITED_BY_START_TIME 是软提示（不可退款），不进入本函数。
 */
function classifyErrorCode({ stage, code, message, riskControl = false } = {}) {
  if (riskControl) return 'RISK_CONTROL';
  const text = `${code || ''} ${message || ''}`.toUpperCase();
  if (/UNPAID|未支付/.test(text)) return 'UNPAID';
  if (/LIMIT|限订|限购/.test(text)) return 'LIMIT';
  if (stage === 'check' || /SOLDOUT|SOLD_OUT|已被预订|已预订/.test(text)) return 'SOLDOUT';
  return 'OTHER';
}

const PAD2 = (n) => String(n).padStart(2, '0');
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * 场馆 expireTime（北京时间 'YYYY-MM-DD HH:MM:SS'）→ UTC 'YYYY-MM-DD HH:MM:SS'。
 * 落库口径与 created_at 一致；解析失败返回 null——支付截止是附加信息，
 * 不能因为时间格式异常丢掉整笔锁场成功。
 */
function beijingToUtc(text) {
  const m = DATETIME_RE.exec(String(text || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] || 0)));
  return `${d.getUTCFullYear()}-${PAD2(d.getUTCMonth() + 1)}-${PAD2(d.getUTCDate())} ${PAD2(d.getUTCHours())}:${PAD2(d.getUTCMinutes())}:${PAD2(d.getUTCSeconds())}`;
}

/** 落库的 UTC 时间串 → 北京时间 'HH:MM'（推送文案用；非法输入返回 null） */
function beijingHm(utcText) {
  const m = DATETIME_RE.exec(String(utcText || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 8, +m[5], +(m[6] || 0)));
  return `${PAD2(d.getUTCHours())}:${PAD2(d.getUTCMinutes())}`;
}

function insertLockRecord({ intentId, slot, status, orderId = null, expireAt = null, error = null, errorCode = null }) {
  prepare(`INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, expire_at, status, error, error_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    lockId(),
    intentId,
    slot.uniqNo,
    slot.date,
    slot.startTime,
    slot.endTime,
    slot.areaId ?? null,
    slot.areaName || '',
    orderId,
    expireAt,
    status,
    error,
    errorCode
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
  }).then(result => {
    // 全量推送审计日志（同引擎侧约定）
    if (result.success) logger.info(`push ok - ${title}`);
    else logger.error(`push fail - ${title}: ${result.error}`);
    return result;
  });
}

// === 下单原语 ===

/**
 * 对整组片次执行一次 createOrderCheck → createOrder（一笔订单装 N 个片次）。
 * 【实测 2026-09-17】areaItems 多条时两个时段进同一笔订单（totalAmount = N × 单价）。
 * @param {object[]} items 本次要下单的全部片次（≤2，已剔除 locked 的）
 * @returns {Promise<{ success: boolean, orderId?: string|null, expireAt?: string|null,
 *   softNotice?: string|null, error?: string, errorCode?: string, riskControl?: boolean }>} 绝不抛出
 */
async function placeOrder(items) {
  const uniqNos = items.map(it => it.uniqNo).join(', ');
  try {
    const areaItems = buildAreaItems(items);

    const check = await gymOrderClient.createOrderCheck(areaItems);
    let softNotice = null;
    // 成功判定【已反编译确认】：HTTP 2xx 后看 body.data.success === 'Y'
    // （'N' = 冲突/不可订，原因在 body.data.code）
    if (!check.httpOk || !check.body || !check.body.data || check.body.data.success !== 'Y') {
      const reason = (check.body && check.body.data && check.body.data.code)
        || (check.body && (check.body.msg || check.body.message));
      // 【实测 2026-09-17】LIMITED_BY_START_TIME 是"距开场不足 12 小时不可退款"的软提示，
      // 不阻断下单（该码出现后 createOrder 仍返回 200），仅置软提示供推送文案使用
      if (reason !== 'LIMITED_BY_START_TIME') {
        return {
          success: false,
          errorCode: classifyErrorCode({ stage: 'check', code: reason }),
          error: `下单前校验未通过：${reason || `HTTP ${check.status}`}`
        };
      }
      softNotice = 'no_refund';
    }

    const created = await gymOrderClient.createOrder(areaItems);
    // 成功判定【已反编译确认】：body.code === 200；429/403004 = 触发风控（图形验证，账号级拦截）
    if (!created.httpOk || !created.body || created.body.code !== 200) {
      const code = created.body && created.body.code;
      if (code === 429 || code === 403004) {
        return { success: false, riskControl: true, errorCode: 'RISK_CONTROL', error: '自动锁场触发风控，需在小程序内完成验证码后重试' };
      }
      const message = created.body && (created.body.msg || created.body.message);
      return {
        success: false,
        errorCode: classifyErrorCode({ stage: 'create', code, message }),
        error: bizError('自动锁场下单失败', created),
        softNotice
      };
    }

    // 订单号字段【已反编译确认】：列表/支付页使用 areaOrderId，兜底 orderId/id。
    // expireTime = 未支付订单自动释放时刻（实测北京时间）→ 统一转 UTC 落库。
    const data = created.body.data || {};
    const orderId = data.areaOrderId || data.orderId || data.id ? String(data.areaOrderId || data.orderId || data.id) : null;
    return { success: true, orderId, expireAt: beijingToUtc(data.expireTime), softNotice };
  } catch (err) {
    logger.error(`bookingLock.placeOrder - ${uniqNos}: ${err.message}`);
    return { success: false, errorCode: 'OTHER', error: `自动锁场异常：${err.message}` };
  }
}

/**
 * 尝试把一组片次打包成一笔订单锁场（含"已锁到"去重；失败记录不阻塞后续重试）。
 * 成功：N 条 locked 记录共享同一 order_id / expire_at；
 * 失败：N 条 failed 记录共享同一 error / error_code。
 * @param {{ intent: object, items: object[], date: string }} params
 * @returns {Promise<{ success: boolean, skipped?: string, locked: number, failed: number,
 *   orderId?: string|null, expireAt?: string|null, softNotice?: string|null,
 *   error?: string, errorCode?: string, riskControl?: boolean }>}
 */
async function attemptLockOrder({ intent, items, date }) {
  const pending = [];
  const heldOrderIds = [];
  for (const item of items) {
    const existing = prepare(`SELECT order_id FROM booking_intent_locks WHERE uniq_no = ? AND status = 'locked'`).get(item.uniqNo);
    if (existing) heldOrderIds.push(existing.order_id || null);
    else pending.push(item);
  }
  if (!pending.length) {
    return {
      success: true,
      skipped: 'already_locked',
      locked: 0,
      failed: 0,
      orderId: heldOrderIds.find(Boolean) || null
    };
  }

  const lockItems = pending.map(item => ({ ...item, date }));
  const result = await placeOrder(lockItems);

  let inserted = 0;
  for (const item of lockItems) {
    try {
      insertLockRecord({
        intentId: intent.id,
        slot: item,
        status: result.success ? 'locked' : 'failed',
        orderId: result.success ? (result.orderId || null) : null,
        expireAt: result.success ? (result.expireAt || null) : null,
        error: result.success ? null : result.error,
        errorCode: result.success ? null : (result.errorCode || 'OTHER')
      });
      inserted += 1;
    } catch (insertErr) {
      // 部分唯一索引兜底并发双锁等极端情况：落库失败只记日志，不再抛出
      logger.error(`bookingLock.attemptLockOrder - ${item.uniqNo} 记录落库异常: ${insertErr.message}`);
    }
  }

  if (result.success && inserted !== lockItems.length) {
    // 订单已下但记录没全落库：后续 occurrenceFulfilled 会为假、限订闸门会少计，留一条告警便于排查
    logger.warn(`bookingLock.attemptLockOrder - 订单 ${result.orderId || '?'} 已下但记录落库不完整（${inserted}/${lockItems.length}）`);
  }

  if (result.success) {
    return {
      success: true,
      locked: inserted,
      failed: 0,
      orderId: result.orderId || null,
      expireAt: result.expireAt || null,
      softNotice: result.softNotice || null
    };
  }
  return {
    success: false,
    locked: 0,
    failed: inserted,
    error: result.error,
    errorCode: result.errorCode || 'OTHER',
    riskControl: !!result.riskControl,
    softNotice: result.softNotice || null
  };
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
 * 判定实现在 lockRun（纯函数，与 intentService 状态派生共用同一份）。
 */
function occurrenceFulfilled(intent, date) {
  return lockRun.isOccurrenceFulfilled(intent, lockedRowsFor(intent.id, date));
}

/**
 * 格子回流记账：引擎 diff 发现"我锁过的格子再次 0→1"时调用。
 * 只做一件事：该 locked 记录标记为 expired（订单已释放——超时未支付或用户取消，
 * 我们不区分也不关心），释放每日限订额度与 uniq_no 占位。不重锁、不推送。
 * 意图仍启用时，同一轮 diff 的 tryFulfill 会按普通可订格子重新尝试。
 *
 * @returns {boolean} 是否有记录被标记（true = 是我锁过的格子）
 */
function markExpiredOnReturn(slot) {
  const row = prepare(`SELECT id FROM booking_intent_locks
    WHERE uniq_no = ? AND status = 'locked' ORDER BY created_at DESC LIMIT 1`).get(slot.uniqNo);
  if (!row) return false;
  prepare(`UPDATE booking_intent_locks SET status = 'expired', error = NULL WHERE id = ?`).run(row.id);
  logger.info(`bookingLock.expired - ${slot.uniqNo} 锁场订单已释放（超时未支付或手动取消）`);
  return true;
}

/**
 * 当日（北京时间）当前持有中的锁场订单数。
 * 未支付超时释放的不计入（场馆规则：取消返还额度）；created_at 存 UTC，+8h 转北京日期。
 */
function heldOrdersToday() {
  return prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks
    WHERE status = 'locked' AND date(datetime(created_at, '+8 hours')) = date(datetime('now', '+8 hours'))`)
    .get().cnt;
}

// "已达当日限订"推送去重：每意图每天只推一次（进程内；重启当日重复推一次可接受）
const dailyLimitNotified = new Set();

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
 * 尝试满足该意图在某日的订场需求。引擎在每次 diff 后对命中的
 * auto_lock 意图调用；幂等：已满足/无可行段时直接返回。
 * 整段锁齐后意图自动停用（锁到即停），由用户决定是否支付、是否重开。
 *
 * @param {object} intent booking_intents 行
 * @param {string} date YYYY-MM-DD
 * @param {object[]} daySlots 该日 flattenSlots 结果（含 available 与 raw）
 * @param {object} env intentService.getEnvConfig()
 * @returns {Promise<{ fulfilled: boolean, locked: number, failed: number, skipped?: string, aborted?: string }>}
 */
async function tryFulfill(intent, date, daySlots, env) {
  // 引擎只会对启用中的意图调用；意图已停用（含 UNPAID 停机）时不再发起下单
  if (!intent.enabled) return { fulfilled: false, locked: 0, failed: 0, skipped: 'disabled' };
  if (!venueLockSigner.isSignerConfigured()) return { fulfilled: false, locked: 0, failed: 0, skipped: 'no_signer' };

  const hourMap = buildHourMap(intent, date, daySlots);
  if (occurrenceFulfilled(intent, date)) {
    // 已满足但仍启用（历史数据或跨轮续锁完成）：补齐自动停用
    intentService.updateIntent(intent.id, { enabled: false });
    return { fulfilled: true, locked: 0, failed: 0, skipped: 'fulfilled' };
  }

  // 场地偏好：意图自身 preferred_area_ids 优先；为空时回退全局 area_priority
  const preferenceIds = parseJson(intent.preferred_area_ids, []);
  const priorityIds = preferenceIds.length ? preferenceIds : intentService.getAreaPriority();
  const preference = new Map(priorityIds.map((id, i) => [id, i]));

  const run = lockRun.findRun(hourMap, intent);
  if (!run) return { fulfilled: false, locked: 0, failed: 0, skipped: 'no_run' };

  // 整单打包：run 内每小时取 need = courts_needed - lockedCount 个候选（按场地偏好排序），
  // 全部放进一笔订单。已 locked 的片次直接跳过（部分唯一索引是全局 uniq_no 维度）。
  const lockedUniqNos = new Set(prepare(`SELECT uniq_no FROM booking_intent_locks
    WHERE status = 'locked' AND date = ?`).all(date).map(r => r.uniq_no));
  const items = [];
  for (const hour of run) {
    const need = intent.courts_needed - hour.lockedCount;
    if (need <= 0) continue;
    const candidates = hour.available
      .filter(slot => !lockedUniqNos.has(slot.uniqNo))
      .sort((a, b) =>
        (preference.get(a.areaId) ?? Number.MAX_SAFE_INTEGER) - (preference.get(b.areaId) ?? Number.MAX_SAFE_INTEGER));
    for (const slot of candidates.slice(0, need)) items.push(slot);
  }
  if (!items.length) return { fulfilled: false, locked: 0, failed: 0, skipped: 'already_locked' };

  // 每日限订闸门：本地预估当前持有片次数 + 本次需要的片次数，超额当天停手并告知
  const limit = env.dailyOrderLimit || 2;
  const held = heldOrdersToday();
  if (held + items.length > limit) {
    await notifyDailyLimit(intent, date, held, items.length, limit, env);
    return { fulfilled: false, locked: 0, failed: 0, skipped: 'daily_limit' };
  }

  let result;
  try {
    result = await attemptLockOrder({ intent, items, date });
  } catch (err) {
    result = { success: false, locked: 0, failed: 0, error: `自动锁场异常：${err.message}`, errorCode: 'OTHER' };
  }

  if (occurrenceFulfilled(intent, date)) {
    // 锁到即停：整段满足后意图自动停用（部分满足不停，继续监控剩余）
    intentService.updateIntent(intent.id, { enabled: false });
    await notifyFulfilled(intent, date, env, { softNotice: result.softNotice });
    return { fulfilled: true, locked: result.locked, failed: result.failed };
  }
  if (!result.success) {
    // 图形验证是账号级拦截：本轮放弃，引擎进入重试窗口并推"需要人工验证"引导（这里不重复推）
    if (result.riskControl) {
      return { fulfilled: false, locked: 0, failed: result.failed, aborted: 'risk_control' };
    }
    // 存在未支付订单：场馆明确拒绝，重试无意义 → 推「需要先支付」并停用意图，由用户决定支付与重开
    if (result.errorCode === 'UNPAID') {
      intentService.updateIntent(intent.id, { enabled: false });
      await notifyUnpaid(intent, date, env);
      return { fulfilled: false, locked: 0, failed: result.failed, skipped: 'unpaid' };
    }
    // 锁不齐：已锁的保留，剩余等格子回流后由后续触发续锁；失败即时推送（用户需要知情）
    await notifyLockFailed(intent, date, items, result.error, env);
  }
  return {
    fulfilled: false,
    locked: result.locked || 0,
    failed: result.failed || 0,
    ...(result.skipped ? { skipped: result.skipped } : {})
  };
}

/** 锁场失败即时推送：失败明细 + 回流提示（风控中止与 UNPAID 停机不走这里，各有专属推送） */
async function notifyLockFailed(intent, date, items, error, env) {
  const lines = items.map(item =>
    `- ${item.areaName || '场地'} ${item.startTime}-${item.endTime}：${error}`);
  const content = `**${date} 自动锁场失败**\n\n${lines.join('\n')}\n\n格子可能刚被他人抢先，回流可订时系统会自动重试。`;
  const result = await notify(env, `【锁场失败】${date}`, content);
  if (!result.success) {
    logger.error(`bookingLock.failedNotify - ${result.error}`);
  }
  for (const item of items) {
    intentService.recordNotification({
      intentId: intent.id,
      uniqNo: item.uniqNo,
      areaName: item.areaName,
      date,
      startTime: item.startTime,
      endTime: item.endTime,
      price: item.price ?? null,
      success: result.success,
      error: result.success ? null : result.error
    });
  }
}

/** 存在未支付订单：推「需要先支付」并说明监控已暂停（意图停用由调用方完成） */
async function notifyUnpaid(intent, date, env) {
  const content = '你有一笔未支付的订单，场馆要求先完成支付才能继续下单；监控已暂停。\n\n完成支付后，在订场页重新打开开关即可继续抢。';
  const result = await notify(env, `【需要先支付】${date}`, content);
  if (!result.success) {
    logger.error(`bookingLock.unpaidNotify - ${result.error}`);
  }
  intentService.recordNotification({
    intentId: intent.id,
    uniqNo: null,
    date,
    startTime: intent.window_start,
    endTime: intent.window_end,
    success: result.success,
    error: result.success ? null : result.error
  });
  return result;
}

/** 当日限订额度不足：当天停手并推送告知（每意图每天只推一次） */
async function notifyDailyLimit(intent, date, held, need, limit, env) {
  const dayKey = prepare(`SELECT date(datetime('now', '+8 hours')) AS d`).get().d;
  const dedupeKey = `${intent.id}|${dayKey}`;
  for (const key of [...dailyLimitNotified]) {
    if (!key.endsWith(`|${dayKey}`)) dailyLimitNotified.delete(key);
  }
  if (dailyLimitNotified.has(dedupeKey)) return;
  dailyLimitNotified.add(dedupeKey);

  const content = `**${date} 锁场暂停：已达当日限订**\n\n场馆限制每账号每天最多订 ${limit} 个片次（场地×小时），当前已持有 ${held} 个（含等待支付的），本意图还需 ${need} 个，额度不足，今天不再自动下单。若有订单超时取消返还额度，系统会自动恢复尝试。`;
  const result = await notify(env, `【已达限订】${date}`, content);
  if (!result.success) {
    logger.error(`bookingLock.dailyLimitNotify - ${result.error}`);
  }
}

/**
 * 整段锁齐：一条醒目推送（含订单号、支付截止、意图已自动暂停说明），落通知记录。
 * softNotice='no_refund' 时追加不可退款提醒（createOrderCheck 的 LIMITED_BY_START_TIME 软提示）。
 */
async function notifyFulfilled(intent, date, env, { softNotice } = {}) {
  const rows = lockedRowsFor(intent.id, date);
  const lines = rows.map(r =>
    `- ${r.area_name || '场地'} ${r.start_time}-${r.end_time} 订单号 ${r.order_id || '未知'}`);
  // 整单共用一个 expire_at（下单响应 expireTime 转 UTC 落库），渲染为北京时间。
  // 跨轮拼接时取最晚的一条（早的那笔可能已经过期）
  const expireAt = rows.map(r => r.expire_at).filter(Boolean).sort().pop() || null;
  const expireHm = expireAt ? beijingHm(expireAt) : null;
  const payLine = expireHm
    ? `请于北京时间 ${expireHm} 前在小程序完成支付，超时订单自动释放。`
    : '请 5 分钟内在小程序完成支付，超时订单自动释放。';
  const refundLine = softNotice === 'no_refund' ? '该场次距开场不足 12 小时，**不可退款**。\n\n' : '';
  const result = await notify(env,
    `【已锁场】${date} ${rows.length} 个时段`,
    `**${date} 自动锁场成功**\n\n${lines.join('\n')}\n\n${payLine}\n\n${refundLine}本意图已自动暂停；不支付的话，在订场页重新打开开关即可继续监控。`);
  for (const r of rows) {
    intentService.recordNotification({
      intentId: intent.id,
      uniqNo: r.uniq_no,
      areaName: r.area_name,
      date,
      startTime: r.start_time,
      endTime: r.end_time,
      success: result.success,
      error: result.success ? null : result.error
    });
  }
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
    expireAt: row.expire_at || null, // 未支付订单自动释放时刻（UTC；+8h 为北京时间）
    status: row.status, // locked=成功持有中 / failed=失败 / expired=成功但已释放（超时未支付或手动取消）
    error: row.error,
    errorCode: row.error_code || null, // RISK_CONTROL | SOLDOUT | LIMIT | UNPAID | OTHER（失败原因结构化）
    createdAt: row.created_at
  };
}

/**
 * 某意图某天的最近一次尝试（status 与 error_code）与当日失败次数。
 * 供意图列表的 lastAttempt 输出（状态派生的 UI 补充信息）。
 */
function lastAttemptFor(intentId, date) {
  const row = prepare(`SELECT status, error, error_code, created_at FROM booking_intent_locks
    WHERE intent_id = ? AND date = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(intentId, date);
  if (!row) return null;
  const attempts = prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks
    WHERE intent_id = ? AND date = ? AND status = 'failed'`).get(intentId, date).cnt;
  return {
    status: row.status,
    errorCode: row.error_code || null,
    error: row.error,
    createdAt: row.created_at,
    attempts
  };
}

function listLockRecords({ pageNo = 1, pageSize = 20, intentId: filterIntentId, date: filterDate } = {}) {
  const where = [];
  const args = [];
  if (filterIntentId) { where.push('intent_id = ?'); args.push(filterIntentId); }
  if (filterDate) { where.push('date = ?'); args.push(filterDate); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks ${whereSql}`).get(...args).cnt;
  const rows = prepare(`SELECT * FROM booking_intent_locks ${whereSql}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (pageNo - 1) * pageSize);
  return { list: rows.map(formatLockRecord), total, pageNo, pageSize };
}

module.exports = {
  buildAreaItems,
  classifyErrorCode,
  attemptLockOrder,
  tryFulfill,
  markExpiredOnReturn,
  occurrenceFulfilled,
  heldOrdersToday,
  lockedRowsFor,
  listLockRecords,
  lastAttemptFor,
  formatLockRecord
};
