/**
 * 订场监控引擎（ADR-0002）— 单一监控引擎 + 取数计划，取代旧 poller + 9 点 rush 两套机制
 *
 * - 调度器：单 timer，每分钟对齐 tick
 * - 取数计划：放票窗口（今天起 BOOKING_WINDOW_DAYS 天）内每天一条 { date, nextFetchAt, mode }
 *   - 新放票日（今天+BOOKING_WINDOW_DAYS-1）：09:00:00 起 burst（1s × ≤10 次，出数即止），
 *     随后并入常规节奏；09:00 前仍按常规节奏试探
 *   - 其余日期：常规 POLL_INTERVAL_SEC 节奏（含抖动）
 * - 下游只有一条管道：取数 → 更新 watch_slot_state 快照得 0→1 变化 →
 *   匹配启用中的意图（日期/星期 + 窗口覆盖 + 场地过滤）→
 *   auto_lock 意图走 bookingLockService.tryFulfill；notify 意图走推送
 * - 快照 diff 只用于通知去重；锁场去重独立（booking_intent_locks 部分唯一索引）
 * - 我锁过的格子再次 0→1 = 订单已释放（超时未支付或手动取消），交
 *   bookingLockService.markExpiredOnReturn 记账（释放限订额度），不重锁不推送
 *
 * - start()/stop() 由 server.js 在 listen 成功 / gracefulShutdown 时调用
 * - 凭证/推送参数每 tick 读 process.env（改 .env 后需重启生效）；
 *   缺 GYM_TOKEN_USER 或推送配置时跳过该 tick
 * - 首 poll（快照表为空）只播种基线不推送，避免启动刷屏（burst 例外：放票日出数即触发）
 * - 外部接口 401（业务码 body.code===401 或网关级 HTTP 401）时告警一次
 *   （token_invalid_notified 去重），真的拉到数据后才清零；403 = 该日尚未开售，按空数据处理不计失败
 *
 * 安全：token 只出现在请求头，绝不写日志。
 */
const { prepare, transaction } = require('../config/db');
const logger = require('../utils/logger');
const intentService = require('./intentService');
const notifier = require('./watchNotifier');
const venueLockSigner = require('./venueLockSigner');
const bookingLockService = require('./bookingLockService');
const digest = require('./watchDigest');
const { GYM_API_BASE } = require('./gymOrderClient');
const { BOOKING_WINDOW_DAYS, dateStr, today, yesterday, isSlotAvailable } = require('./venueShared');
const { parseJson } = require('../utils/json');

const LIST_AREA_LEASE_URL = `${GYM_API_BASE}/venue/listAreaLease`;
const FETCH_TIMEOUT_MS = 15000;
const JITTER_MAX_MS = 15000;

const RUSH_HOUR = 9;              // 每天 09:00:00 放新放票日的票
const BURST_MAX_ATTEMPTS = 10;    // burst：1s × ≤10 次，出数即止
const BURST_INTERVAL_MS = 1000;

let timer = null;
let stopped = true;
let ticking = false;
let bursting = false;

// 取数计划：date → { date, mode: 'normal' | 'burst' | 'bursting', nextFetchAt }
const plan = new Map();

// 重新启用的意图待评估集合：diff 只报"新出现"的可订，重开意图时已在架的
// 可订格子不产生 0→1，需要绕过 diff 直接评估一次（见 requestEvaluation）
const pendingEvaluation = new Set();

// 风控重试：09:00 放票高峰 createOrder 必过图形验证（账号级拦截），
// 引导用户在小程序里过一次验证（服务端按会话免验证，我们与小程序共用
// token-user），随后在窗口期内自动重试。key = `${intentId}|${date}`
const rcRetrying = new Set();
// 重试时序配置（测试可调小；resetEngineState 时恢复默认值，避免用例间互相污染）
const RC_RETRY_DEFAULTS = { intervalMs: 12000, windowMs: 4 * 60 * 1000 };
const rcRetryConfig = { ...RC_RETRY_DEFAULTS };

// 告警状态：拉取连败计数（进程内）与"签名未配置"一次性提醒（进程内）
let consecutivePollFailures = 0;
let signerWarned = false;
const POLL_FAILURE_ALERT_THRESHOLD = 2;

/** 今天 + offset 天的日期串 */
function todayPlus(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return dateStr(d);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 拉取某日可订状态。网络异常 / 超时抛出；HTTP 错误或业务码不抛出，
 * 由调用方检查 body.code（401 = 登录态失效，403 = 该日尚未开售）。
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
        available: isSlotAvailable(item) ? 1 : 0,
        // 原始 item 透传给自动锁场的 areaItems（小程序下单即透传原始对象）
        raw: item
      });
    }
  }
  return slots;
}

/** 启用意图 → 展开日期集合（单次过期 / 每周无匹配日期的意图被过滤掉） */
function loadActiveIntents() {
  const rows = prepare('SELECT * FROM booking_intents WHERE enabled = 1').all();
  return rows
    .map(row => ({
      row,
      dates: new Set(intentService.expandIntentDates(row)),
      areaIds: new Set(parseJson(row.preferred_area_ids, []))
    }))
    .filter(t => t.dates.size > 0);
}

// === 风控重试：图形验证引导 + 窗口期自动重试 ===

/** tryFulfill 的引擎侧包装：风控中止时进入重试窗口 */
async function fulfillWithRiskRetry(intent, date, slots, env) {
  const result = await bookingLockService.tryFulfill(intent.row, date, slots, env);
  if (result.aborted === 'risk_control') {
    scheduleRiskControlRetry(intent.row, date, env);
  }
  return result;
}

function scheduleRiskControlRetry(intentRow, date, env, opts = {}) {
  riskControlRetryLoop(intentRow, date, env, opts)
    .catch(err => logger.error(`watchEngine.rcRetry - ${intentRow.id} ${date}: ${err.message}`));
}

/**
 * 风控重试循环：先推验证引导（小程序过一次图形验证，服务端按会话免验证，
 * 我们与小程序共用 token-user），然后窗口期内每隔 intervalMs 重新拉取并
 * 直接评估该意图，直到锁到、意图被停用或窗口超时。同意图同日重入直接跳过。
 */
async function riskControlRetryLoop(intentRow, date, env, { intervalMs = rcRetryConfig.intervalMs, windowMs = rcRetryConfig.windowMs } = {}) {
  const key = `${intentRow.id}|${date}`;
  if (rcRetrying.has(key)) return;
  rcRetrying.add(key);
  try {
    const guide = await notifyWith(env, `【需要过验证】${date}`,
      `**放票高峰触发了场馆的图形验证**，自动下单被拦。\n\n请打开小程序：任意选一个时段点「预订」→ 完成图形验证 → 看到「验证成功」即可退出（不用真的下单）。\n\n验证过后，系统会在 ${Math.round(windowMs / 60000)} 分钟内自动重试锁场，锁到会再通知你。`);
    intentService.recordNotification({
      intentId: intentRow.id, uniqNo: null, date,
      startTime: intentRow.window_start, endTime: intentRow.window_end,
      success: guide.success, error: guide.success ? null : guide.error
    });

    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const current = intentService.getIntentById(intentRow.id);
      if (!current || !current.enabled) return; // 意图被关/删，停止
      if (!intentService.getFlags().enabled) return; // 总开关关闭，停止（与主流程一致）
      let resp;
      try {
        resp = await fetchAreaLease(date, env.tokenUser);
      } catch { continue; }
      if (resp.status === 401 || (resp.body && resp.body.code === 401)) return; // token 失效，告警走主流程
      if (!resp.httpOk || !resp.body || !resp.body.data) continue;
      pendingEvaluation.add(intentRow.id); // 绕过 diff 直接评估
      await processFetch(date, resp.body.data, env, loadActiveIntents(), { baseline: false });
      if (bookingLockService.occurrenceFulfilled(current, date)) return; // 成功推送由 tryFulfill 发出
    }
    const failResult = await notifyWith(env, `【锁场失败】${date}`,
      `**${date} 自动锁场未成功**：重试窗口内未能锁到（可能验证未完成或场地已抢光）。可在小程序手动订；格子回流时系统仍会照常尝试。`);
    intentService.recordNotification({
      intentId: intentRow.id, uniqNo: null, date,
      startTime: intentRow.window_start, endTime: intentRow.window_end,
      success: failResult.success, error: failResult.success ? null : failResult.error
    });
  } finally {
    rcRetrying.delete(key);
  }
}

/** slot 是否命中意图：日期 + 窗口覆盖（slot 完整落在窗口内）+ 场地过滤 */
function matchesIntent(slot, intent) {
  if (!intent.dates.has(slot.date)) return false;
  if (!(slot.startTime >= intent.row.window_start && slot.endTime <= intent.row.window_end)) return false;
  if (intent.areaIds.size > 0 && !intent.areaIds.has(slot.areaId)) return false;
  return true;
}

// === 取数计划 ===

/** 新放票日 = 窗口最后一天 */
function releaseDate() {
  return todayPlus(BOOKING_WINDOW_DAYS - 1);
}

/** 刷新计划：补齐窗口内日期，清理过期日期 */
function refreshPlan() {
  const todayStr = today();
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    const date = todayPlus(i);
    if (!plan.has(date)) {
      plan.set(date, { date, mode: 'normal', nextFetchAt: 0 });
    }
  }
  for (const date of [...plan.keys()]) {
    if (date < todayStr) plan.delete(date);
  }
}

// === 推送 ===

async function notifyWith(env, title, content) {
  const result = await notifier.notify({
    type: env.pushType,
    url: env.pushUrl,
    token: env.pushToken,
    topic: env.pushTopic,
    title,
    content
  });
  // 全量推送审计日志：9/13 出现过"接口成功但用户没收到"的悬案，每条推送留痕
  if (result.success) logger.info(`push ok - ${title}`);
  else logger.error(`push fail - ${title}: ${result.error}`);
  return result;
}

async function notifyTokenInvalid(env) {
  const flags = intentService.getFlags();
  if (flags.tokenInvalidNotified) return;
  const result = await notifyWith(env, '订场监控告警',
    '**小程序 token 已失效**，请更新服务器 .env 并重启。');
  if (result.success) {
    intentService.setTokenInvalidNotified(true);
  } else {
    logger.error(`watchEngine.tokenInvalidAlert - ${result.error}`);
  }
}

/** 连续拉取失败告警（监控可能已失效）：连败阈值触发一次，恢复后清零 */
async function notifyPollFailure(env, failCount) {
  const flags = intentService.getFlags();
  if (flags.pollFailureNotified) return;
  const result = await notifyWith(env, '订场监控告警',
    `**场馆接口连续 ${consecutivePollFailures} 轮拉取失败**（本轮 ${failCount} 个日期全部失败），监控与锁场可能已失效，请检查服务器网络或场馆接口状态。`);
  if (result.success) {
    intentService.setPollFailureNotified(true);
  } else {
    logger.error(`watchEngine.pollFailureAlert - ${result.error}`);
  }
}

/** 有 auto_lock 意图但签名私钥未配置：提醒一次（锁场静默跳过 ≠ 用户知情） */
async function notifySignerMissing(env) {
  const result = await notifyWith(env, '订场监控告警',
    '**自动锁场未生效**：有订场意图开启了自动锁场，但 createOrder 签名私钥未配置（.env 的 GYM_SIGN_PRIVATE_KEY）。当前只推送可订提醒，不会自动锁场。');
  if (!result.success) {
    logger.error(`watchEngine.signerMissingAlert - ${result.error}`);
  }
}

// === 下游管道（取数 → 快照 diff → 匹配意图 → 锁场/通知） ===

function buildMarkdown(date, slots) {
  const lines = slots.map(s => {
    const price = s.price !== null && s.price !== undefined ? ` ¥${s.price}` : '';
    return `- ${s.areaName || '场地'} ${s.startTime}-${s.endTime}${price}`;
  });
  return `**${date} 场地可订提醒**\n\n${lines.join('\n')}\n\n共 ${slots.length} 个时段可订，请尽快预订。`;
}

/**
 * 处理一日取数结果：更新快照、得 0→1 变化、驱动锁场与通知。
 * @param {object} [opts] baseline=true 时只播种快照不触发（首次启动防刷屏）；
 *   burst 放票日取数传 false——出数即新场次，直接触发
 */
async function processFetch(date, data, env, intents, { baseline } = {}) {
  const slots = flattenSlots(date, data);
  const transitions = [];
  transaction(() => {
    // 顺带清理过期快照（date < 今天-1）
    prepare('DELETE FROM watch_slot_state WHERE date < ?').run(yesterday());
    // 顺带记录场地名映射，供意图输出 preferredAreaNames
    intentService.recordAreaNames((data && data.areas) || []);
    for (const slot of slots) {
      const old = prepare('SELECT available FROM watch_slot_state WHERE uniq_no = ?').get(slot.uniqNo);
      const oldAvailable = old ? old.available : 0;
      prepare(`INSERT INTO watch_slot_state (uniq_no, date, available, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(uniq_no) DO UPDATE SET available = excluded.available, updated_at = excluded.updated_at`)
        .run(slot.uniqNo, slot.date, slot.available);
      // 仅 0→1（含新出现的 key）触发；1→0 只更新快照
      if (!baseline && oldAvailable === 0 && slot.available === 1) {
        transitions.push(slot);
      }
    }
  });

  // 重新启用的意图：已在架的可订格子不产生 0→1，绕过 diff 直接评估一次（每意图一次）。
  // 必须在 transitions 早退之前执行——重开意图时往往没有任何新变化。
  for (const intent of intents) {
    if (!pendingEvaluation.has(intent.row.id)) continue;
    if (intent.row.mode !== 'auto_lock' || !intent.dates.has(date)) continue;
    pendingEvaluation.delete(intent.row.id);
    try {
      await fulfillWithRiskRetry(intent, date, slots, env);
    } catch (err) {
      logger.error(`watchEngine.reevaluate - intent ${intent.row.id} ${date}: ${err.message}`);
    }
  }

  if (!transitions.length) return { notified: 0 };

  const fulfillIntents = new Map(); // intentId → intent 包装
  const notifyGroups = new Map();   // intentId → { intent, slots: [] }

  for (const slot of transitions) {
    // 我锁过的格子再次可订 = 订单已释放：仅记账（释放限订额度与 uniq_no 占位），
    // 不重锁不推送；意图仍启用时下面会按普通可订格子重新匹配尝试
    bookingLockService.markExpiredOnReturn(slot);

    for (const intent of intents) {
      if (!matchesIntent(slot, intent)) continue;
      if (intent.row.mode === 'auto_lock') {
        fulfillIntents.set(intent.row.id, intent);
      } else {
        if (!notifyGroups.has(intent.row.id)) notifyGroups.set(intent.row.id, { intent, slots: [] });
        notifyGroups.get(intent.row.id).slots.push(slot);
      }
    }
  }

  // auto_lock 意图：满足判定以"整天"为单位（连续时长可能跨多个变化 slot）
  for (const intent of fulfillIntents.values()) {
    try {
      await fulfillWithRiskRetry(intent, date, slots, env);
    } catch (err) {
      logger.error(`watchEngine.tryFulfill - intent ${intent.row.id} ${date}: ${err.message}`);
    }
  }

  // notify 意图：同一意图同一日期合并为一条推送
  let notified = 0;
  for (const { intent, slots: matched } of notifyGroups.values()) {
    const result = await notifyWith(env, digest.buildNotifyTitle(date, matched), buildMarkdown(date, matched));
    notified += 1;
    if (!result.success) {
      logger.error(`watchEngine.notify - ${result.error}`);
    }
    transaction(() => {
      for (const slot of matched) {
        intentService.recordNotification({
          intentId: intent.row.id,
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
  return { notified };
}

// === burst：新放票日 09:00 起 1s × ≤10 次，出数即止 ===

function hasItems(resp) {
  return !!(resp.httpOk && resp.body && resp.body.data
    && (resp.body.data.areas || []).some(a => (a.items || []).length > 0));
}

async function maybeStartBurst(env, intents) {
  const date = releaseDate();
  const entry = plan.get(date);
  if (!entry || entry.mode !== 'normal' || bursting) return;
  if (new Date().getHours() < RUSH_HOUR) return;
  // 没有意图覆盖新放票日则无需 burst（常规节奏够用了）
  if (!intents.some(i => i.dates.has(date))) return;

  bursting = true;
  entry.mode = 'bursting';
  try {
    for (let i = 0; i < BURST_MAX_ATTEMPTS; i++) {
      try {
        const resp = await fetchAreaLease(date, env.tokenUser);
        if (resp.status === 401 || (resp.body && resp.body.code === 401)) {
          await notifyTokenInvalid(env);
          break;
        }
        if (hasItems(resp)) {
          // 放票数据出现：出数即触发（不播种基线），随后并入常规节奏
          await processFetch(date, resp.body.data, env, intents, { baseline: false });
          entry.mode = 'normal';
          entry.nextFetchAt = Date.now() + env.pollIntervalSec * 1000;
          logger.info(`watchEngine.burst - ${date} 第 ${i + 1} 次拉取到放票数据，转入常规节奏`);
          return;
        }
        logger.info(`watchEngine.burst - ${date} 第 ${i + 1} 次拉取尚无场次数据，稍后重试`);
      } catch (err) {
        logger.error(`watchEngine.burst - 拉取 ${date} 失败: ${err.message}`);
      }
      if (i < BURST_MAX_ATTEMPTS - 1) await sleep(BURST_INTERVAL_MS);
    }
    // 出数失败：告警一次，并入常规节奏继续等
    logger.error(`watchEngine.burst - ${date} 放票数据连续 ${BURST_MAX_ATTEMPTS} 次拉取失败，本轮放弃`);
    await notifyWith(env, '订场监控告警',
      `**9 点抢场失败**：${date} 放票数据连续 ${BURST_MAX_ATTEMPTS} 次拉取失败，请检查网络或场馆接口状态，必要时手动订场。`);
    entry.mode = 'normal';
    entry.nextFetchAt = Date.now() + env.pollIntervalSec * 1000;
  } finally {
    bursting = false;
  }
}

// === digest 已移除：用户不需要全量场次汇总推送（2026-08-30 反馈），
// === 只保留按意图的精准通知（可订提醒 / 锁场成功 / 锁场失败 / 已达限订）。

// === 主流程 ===

async function runTick() {
  const env = intentService.getEnvConfig();

  const flags = intentService.getFlags();
  if (!flags.enabled) return { skipped: 'disabled' };
  if (!env.tokenUser) return { skipped: 'no_token' };
  if (!env.pushConfigured) return { skipped: 'no_webhook' };

  const intents = loadActiveIntents();
  if (!intents.length) return { skipped: 'no_intents' };

  // 有意图开了自动锁场但签名私钥未配置：提醒一次（每进程一次，重启后重新评估）
  if (!signerWarned && intents.some(i => i.row.mode === 'auto_lock') && !venueLockSigner.isSignerConfigured()) {
    signerWarned = true;
    await notifySignerMissing(env);
  }

  refreshPlan();

  // 新放票日 burst（09:00 起，出数即止）
  await maybeStartBurst(env, intents);

  // 常规节奏：拉取到期日期
  const baseline = prepare('SELECT COUNT(*) AS cnt FROM watch_slot_state').get().cnt === 0;
  const now = Date.now();
  const due = [...plan.values()].filter(e => e.mode === 'normal' && e.nextFetchAt <= now);
  let failedFetches = 0;
  let hadSuccess = false; // 本轮至少一个日期拉到有效数据（才允许清零 token 告警标记）
  let notified = 0;
  for (const entry of due) {
    entry.nextFetchAt = now + env.pollIntervalSec * 1000 + Math.floor(Math.random() * JITTER_MAX_MS);
    let resp;
    try {
      resp = await fetchAreaLease(entry.date, env.tokenUser);
    } catch (err) {
      logger.error(`watchEngine.poll - 拉取 ${entry.date} 失败: ${err.message}`);
      failedFetches += 1;
      continue;
    }
    // token 失效两种形态：业务码 {code:401} 与网关级 HTTP 401（body 结构不同）
    if (resp.status === 401 || (resp.body && resp.body.code === 401)) {
      await notifyTokenInvalid(env);
      return { skipped: 'token_invalid' };
    }
    // 403 = 该日尚未开售（放票日 09:00 前）：按空数据处理，不计失败
    if (resp.body && resp.body.code === 403) continue;
    if (!resp.httpOk || !resp.body || !resp.body.data) {
      logger.error(`watchEngine.poll - ${entry.date} 响应异常 (HTTP ${resp.status})`);
      failedFetches += 1;
      continue;
    }
    hadSuccess = true;
    const result = await processFetch(entry.date, resp.body.data, env, intents, { baseline });
    notified += result.notified;
  }

  // 只有真的拉到过数据才清零 401 告警标记（全失败的轮次不能误判为"已恢复"）
  if (hadSuccess && flags.tokenInvalidNotified) {
    intentService.setTokenInvalidNotified(false);
  }

  // 拉取连败告警：全部日期失败累计，达到阈值提醒一次；有成功即清零恢复
  if (due.length > 0 && failedFetches === due.length) {
    consecutivePollFailures += 1;
    if (consecutivePollFailures >= POLL_FAILURE_ALERT_THRESHOLD) {
      await notifyPollFailure(env, failedFetches);
    }
  } else if (due.length > 0) {
    consecutivePollFailures = 0;
    if (flags.pollFailureNotified) {
      intentService.setPollFailureNotified(false);
    }
  }

  return { notified };
}

/**
 * 执行一次完整轮询（测试用）：忽略计划节奏，立即拉取窗口内全部日期。
 */
async function pollOnce() {
  const env = intentService.getEnvConfig();
  const flags = intentService.getFlags();
  if (!flags.enabled) return { dates: [], notified: 0, skipped: 'disabled' };
  if (!env.tokenUser) return { dates: [], notified: 0, skipped: 'no_token' };
  if (!env.pushConfigured) return { dates: [], notified: 0, skipped: 'no_webhook' };

  const intents = loadActiveIntents();
  if (!intents.length) return { dates: [], notified: 0, skipped: 'no_intents' };

  refreshPlan();
  const baseline = prepare('SELECT COUNT(*) AS cnt FROM watch_slot_state').get().cnt === 0;
  const dates = [...plan.keys()];
  let notified = 0;
  for (const date of dates) {
    let resp;
    try {
      resp = await fetchAreaLease(date, env.tokenUser);
    } catch (err) {
      logger.error(`watchEngine.pollOnce - 拉取 ${date} 失败: ${err.message}`);
      continue;
    }
    if (resp.status === 401 || (resp.body && resp.body.code === 401)) {
      await notifyTokenInvalid(env);
      return { dates, notified: 0, skipped: 'token_invalid' };
    }
    if (resp.body && resp.body.code === 403) continue;
    if (!resp.httpOk || !resp.body || !resp.body.data) continue;
    const result = await processFetch(date, resp.body.data, env, intents, { baseline });
    notified += result.notified;
  }
  return { dates, notified, ...(baseline ? { baseline: true } : {}) };
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await runTick();
  } catch (err) {
    logger.error(`watchEngine.tick - ${err.message}`);
  } finally {
    ticking = false;
    scheduleNext();
  }
}

/** 单 timer：每分钟对齐 tick */
function scheduleNext() {
  if (stopped) return;
  const now = Date.now();
  const nextMinute = Math.ceil(now / 60000) * 60000;
  timer = setTimeout(tick, Math.max(nextMinute - now, 1000));
  if (timer.unref) timer.unref();
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

/** 测试用：重置进程内状态（连败计数、签名提醒、取数计划、待评估意图） */
function resetEngineState() {
  consecutivePollFailures = 0;
  signerWarned = false;
  plan.clear();
  pendingEvaluation.clear();
  rcRetrying.clear();
  Object.assign(rcRetryConfig, RC_RETRY_DEFAULTS);
}

/**
 * 意图从停用变为启用时由 controller 调用：下一 tick 对该意图覆盖的日期
 * 绕过快照 diff 直接评估一次当前在架可订（锁到即停后手动重开的入口）。
 */
function requestEvaluation(intentId) {
  pendingEvaluation.add(intentId);
}

module.exports = {
  start,
  stop,
  tick,
  pollOnce,
  fetchAreaLease,
  flattenSlots,
  matchesIntent,
  loadActiveIntents,
  resetEngineState,
  requestEvaluation,
  rcRetryConfig,
  RUSH_HOUR,
  BURST_MAX_ATTEMPTS,
  BURST_INTERVAL_MS
};
