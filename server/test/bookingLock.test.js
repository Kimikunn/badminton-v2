const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-booking-lock-test-');

const intentService = require('../src/services/intentService');
const bookingLockService = require('../src/services/bookingLockService');
const venueLockSigner = require('../src/services/venueLockSigner');
const kit = require('./helpers/watchTestKit');

function resetLock() {
  prepare('DELETE FROM booking_intents').run();
  prepare('DELETE FROM booking_intent_locks').run();
  prepare('DELETE FROM watch_notifications').run();
  prepare('DELETE FROM watch_areas').run();
  prepare('DELETE FROM watch_slot_state').run();
  prepare(`UPDATE watch_config SET enabled = 1, token_invalid_notified = 0, poll_failure_notified = 0, area_priority = NULL WHERE id = 1`).run();
  kit.clearEnv();
  kit.PUSH_CALLS.length = 0;
  kit.stubFetch(null);
}

test.before(async () => {
  kit.installFetchStub();
  await setupTestDb();
});

test.after(() => {
  kit.restoreFetch();
  kit.clearEnv();
  closeTestDb();
});

/** 建意图并取回 DB 行（tryFulfill 吃 snake_case 行） */
function makeIntentRow(overrides = {}) {
  const created = intentService.createIntent({
    mode: 'auto_lock',
    date: kit.datePlus(1),
    weekdays: null,
    windowStart: '17:00',
    windowEnd: '20:00',
    durationHours: 2,
    courtsNeeded: 1,
    preferredAreaIds: [],
    ...overrides
  });
  return intentService.getIntentById(created.id);
}

/** flattenSlots 形态的可用 slot（tryFulfill 的 daySlots 入参） */
function flatSlot(uniqNo, startTime, endTime, { areaId = 41, areaName = '1号场', price = 60 } = {}) {
  const raw = kit.slot(uniqNo, startTime, endTime, { areaId, areaName, price });
  return { uniqNo, areaId, areaName, date: null, startTime, endTime, price, available: 1, raw };
}

/** 某日窗口 17:00-20:00 的整点 slot 序列，skip 列出不可订的小时起 */
function windowSlots(date, { areaId = 41, areaName = '1号场', skip = [], only = null } = {}) {
  const hours = [['17:00', '18:00'], ['18:00', '19:00'], ['19:00', '20:00']];
  return hours
    .filter(([st]) => (only ? only.includes(st) : !skip.includes(st)))
    .map(([st, et]) => flatSlot(`${areaId}_${date}_${st}`, st, et, { areaId, areaName }));
}

function lockedRows(intentId) {
  return prepare(`SELECT * FROM booking_intent_locks WHERE intent_id = ? AND status = 'locked' ORDER BY start_time`)
    .all(intentId);
}

// === 签名模块（链路依赖，保持回归） ===

test('signer：未配置时 isSignerConfigured=false 且签名抛 SignNotConfiguredError', () => {
  resetLock();
  assert.equal(venueLockSigner.isSignerConfigured(), false);
  assert.throws(
    () => venueLockSigner.signCreateOrder(),
    (err) => err.name === 'SignNotConfiguredError' && /GYM_SIGN_PRIVATE_KEY/.test(err.message)
  );
});

test('signer：配置私钥后产出三元组，签名串与小程序反编译算法一致', () => {
  resetLock();
  process.env.GYM_SIGN_PRIVATE_KEY = kit.TEST_PRIVATE_KEY;
  assert.equal(venueLockSigner.isSignerConfigured(), true);

  const { timestamp, nonce, signature } = venueLockSigner.signCreateOrder();
  // timestamp 为秒级（小程序：Math.floor(Date.now()/1000).toString()）
  assert.match(timestamp, /^\d{10}$/);
  // nonce 为 6~8 位 [a-z0-9]（小程序 generateRandomString）
  assert.match(nonce, /^[a-z0-9]{6,8}$/);
  // 签名串 = timestamp\nnonce\nAPP_SECRET\n（反编译确认，末尾带 \n，body 不参与）
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${timestamp}\n${nonce}\nade2223c47623d82ecbc413fa5cc6dc1\n`, 'utf8'),
    kit.TEST_PUBLIC_KEY,
    Buffer.from(signature, 'base64')
  );
  assert.equal(ok, true);
});

test('signer：env 中字面量 \\n 转义的 PEM 也能加载', () => {
  resetLock();
  process.env.GYM_SIGN_PRIVATE_KEY = kit.TEST_PRIVATE_KEY.replace(/\n/g, '\\n');
  assert.equal(venueLockSigner.isSignerConfigured(), true);
  const { timestamp, nonce, signature } = venueLockSigner.signCreateOrder();
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${timestamp}\n${nonce}\nade2223c47623d82ecbc413fa5cc6dc1\n`, 'utf8'),
    kit.TEST_PUBLIC_KEY,
    Buffer.from(signature, 'base64')
  );
  assert.equal(ok, true);
});

// === 连续时长满足判定（含跨场） ===

test('tryFulfill：17-19 连续两小时可订 → 锁这两个小时，发已锁场推送', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();
  const env = intentService.getEnvConfig();

  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);

  const result = await bookingLockService.tryFulfill(intent, date, windowSlots(date), env);
  assert.equal(result.fulfilled, true);
  assert.equal(result.locked, 2);
  assert.equal(result.failed, 0);

  // 17-18、18-19 各 check + create 一次；create 带签名头与 token
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create', 'check', 'create']);
  const createCall = fetchStub.orderCalls[1];
  assert.ok(createCall.headers['X-Ca-Timestamp']);
  assert.ok(createCall.headers['X-Ca-Nonce']);
  assert.ok(createCall.headers['X-Ca-Signature']);
  assert.equal(createCall.headers['token-user'], 'wxtoken-secret-9999');
  assert.equal(createCall.body.venueSportId, 1);
  // areaItems 透传 listAreaLease 原始 item
  assert.equal(createCall.body.areaItems[0].uniqNo, `41_${date}_17:00`);

  const rows = lockedRows(intent.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => `${r.start_time}-${r.end_time}`), ['17:00-18:00', '18:00-19:00']);
  assert.ok(rows.every(r => r.order_id === 'ORD-123' && r.area_name === '1号场'));
  assert.match(rows[0].id, /^bil-/);

  // 整段锁齐：一条醒目推送（含订单号与 5 分钟支付提醒）
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /【已锁场】/);
  assert.match(kit.PUSH_CALLS[0].body.content, /订单号 ORD-123/);
  assert.match(kit.PUSH_CALLS[0].body.content, /5 分钟/);

  // 幂等：已满足的发生直接跳过
  const again = await bookingLockService.tryFulfill(intent, date, windowSlots(date), env);
  assert.equal(again.skipped, 'fulfilled');
  assert.equal(fetchStub.orderCalls.length, 4);
});

test('tryFulfill：17-18 与 19-20 可订但 18-19 断开 → 不满足，不下单', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);

  const result = await bookingLockService.tryFulfill(
    intent, date, windowSlots(date, { skip: ['18:00'] }), intentService.getEnvConfig());
  assert.equal(result.fulfilled, false);
  assert.equal(result.skipped, 'no_run');
  assert.equal(fetchStub.orderCalls.length, 0);
  assert.equal(lockedRows(intent.id).length, 0);
  assert.equal(kit.PUSH_CALLS.length, 0);
});

test('tryFulfill：17-18 在场地 A、18-19 在场地 B（跨场）也算满足', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  kit.stubFetch(kit.lockFlowFetch());
  const slots = [
    ...windowSlots(date, { areaId: 41, areaName: '1号场', only: ['17:00'] }),
    ...windowSlots(date, { areaId: 42, areaName: '2号场', only: ['18:00'] })
  ];
  const result = await bookingLockService.tryFulfill(intent, date, slots, intentService.getEnvConfig());

  assert.equal(result.fulfilled, true);
  const rows = lockedRows(intent.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.area_id), [41, 42]);
});

test('tryFulfill：courts_needed=2 时每小时需 2 片，不足则不满足', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow({ courtsNeeded: 2, durationHours: 1, windowStart: '17:00', windowEnd: '18:00' });

  // 每小时只有 1 片 → no_run
  kit.stubFetch(kit.lockFlowFetch());
  const short = await bookingLockService.tryFulfill(intent, date, windowSlots(date, { only: ['17:00'] }), intentService.getEnvConfig());
  assert.equal(short.skipped, 'no_run');
  assert.equal(lockedRows(intent.id).length, 0);

  // 两片可订 → 同小时锁两片（跨场地）
  const twoCourts = [
    ...windowSlots(date, { areaId: 41, areaName: '1号场', only: ['17:00'] }),
    ...windowSlots(date, { areaId: 42, areaName: '2号场', only: ['17:00'] })
  ];
  const result = await bookingLockService.tryFulfill(intent, date, twoCourts, intentService.getEnvConfig());
  assert.equal(result.fulfilled, true);
  assert.equal(result.locked, 2);
  const rows = lockedRows(intent.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.area_id).sort(), [41, 42]);
});

test('tryFulfill：候选场地按意图 preferred_area_ids 排序，缺省回退全局 area_priority', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);

  // 意图自身偏好 42 优先（场馆返回顺序 41 在前）
  const intent = makeIntentRow({ durationHours: 1, windowStart: '17:00', windowEnd: '18:00', preferredAreaIds: [42, 41] });
  const twoCourts = [
    ...windowSlots(date, { areaId: 41, areaName: '1号场', only: ['17:00'] }),
    ...windowSlots(date, { areaId: 42, areaName: '2号场', only: ['17:00'] })
  ];
  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);
  await bookingLockService.tryFulfill(intent, date, twoCourts, intentService.getEnvConfig());
  assert.equal(fetchStub.orderCalls[1].body.areaItems[0].areaId, 42);
  assert.equal(lockedRows(intent.id)[0].area_id, 42);

  // 意图偏好为空 → 回退全局 area_priority（41 优先）
  const fallback = makeIntentRow({ durationHours: 1, windowStart: '17:00', windowEnd: '18:00', preferredAreaIds: [] });
  intentService.updateConfig({ areaPriority: [41, 42] });
  const fetchStub2 = kit.lockFlowFetch();
  kit.stubFetch(fetchStub2);
  await bookingLockService.tryFulfill(fallback, date, twoCourts, intentService.getEnvConfig());
  assert.equal(fetchStub2.orderCalls[1].body.areaItems[0].areaId, 41);
});

test('tryFulfill：签名未配置 → skipped no_signer，不下单不推送', async () => {
  resetLock();
  kit.configureEnv({ withKey: false });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);
  const result = await bookingLockService.tryFulfill(intent, date, windowSlots(date), intentService.getEnvConfig());
  assert.equal(result.skipped, 'no_signer');
  assert.equal(fetchStub.orderCalls.length, 0);
  assert.equal(kit.PUSH_CALLS.length, 0);
});

test('tryFulfill：部分锁不齐时已锁的保留，等回流后续锁', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  // 18-19 首次下单被别人抢先：只锁到 17-18
  const fetchStub = kit.lockFlowFetch({
    createBody: (body) => body.areaItems[0].uniqNo.endsWith('18:00')
      ? { code: 1001, msg: '该时段已被预订' }
      : { code: 200, data: { areaOrderId: 'ORD-FIRST' } }
  });
  kit.stubFetch(fetchStub);
  const first = await bookingLockService.tryFulfill(intent, date, windowSlots(date, { only: ['17:00', '18:00'] }), intentService.getEnvConfig());
  assert.equal(first.fulfilled, false);
  assert.equal(first.locked, 1);
  assert.equal(first.failed, 1);
  assert.equal(lockedRows(intent.id).length, 1);
  const failedRow = prepare(`SELECT * FROM booking_intent_locks WHERE status = 'failed'`).get();
  assert.match(failedRow.error, /该时段已被预订/);
  assert.equal(kit.PUSH_CALLS.length, 0); // 锁不齐不发已锁场推送

  // 18-19 回流后再触发：续锁成功，整段满足
  kit.stubFetch(kit.lockFlowFetch({ createBody: { code: 200, data: { areaOrderId: 'ORD-SECOND' } } }));
  const second = await bookingLockService.tryFulfill(intent, date, windowSlots(date, { only: ['18:00'] }), intentService.getEnvConfig());
  assert.equal(second.fulfilled, true);
  assert.equal(second.locked, 1);
  const rows = lockedRows(intent.id);
  assert.deepEqual(rows.map(r => r.order_id), ['ORD-FIRST', 'ORD-SECOND']);
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /【已锁场】/);
});

// === 下单失败路径 ===

test('attemptLock：check 未通过 → failed 记录，不再调 createOrder', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  const fetchStub = kit.lockFlowFetch({
    // 真实响应形态：成功信封里 data.success='N'，原因在 data.code
    checkBody: { code: 200, data: { code: 'LIMITED_BY_START_TIME', success: 'N' }, message: 'success' }
  });
  kit.stubFetch(fetchStub);

  const result = await bookingLockService.attemptLock({ intent, slot: flatSlot(`41_${date}_17:00`, '17:00', '18:00'), date });
  assert.equal(result.success, false);
  assert.match(result.error, /LIMITED_BY_START_TIME/);
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check']);

  const row = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ?`).get(`41_${date}_17:00`);
  assert.equal(row.status, 'failed');
  assert.equal(row.order_id, null);
});

test('attemptLock：createOrder 返回 429/403004 → failed 记录提示风控验证码', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();

  kit.stubFetch(kit.lockFlowFetch({ createBody: { code: 429, msg: 'too many requests' } }));
  const result = await bookingLockService.attemptLock({ intent, slot: flatSlot(`41_${date}_17:00`, '17:00', '18:00'), date });
  assert.equal(result.success, false);
  assert.match(result.error, /触发风控/);

  const row = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ?`).get(`41_${date}_17:00`);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /风控/);
});

// === 部分唯一索引：失败不阻塞重试，已锁不重复下单 ===

test('部分唯一索引：failed 记录存在时同 uniq_no 可再锁成功', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();
  const uniqNo = `41_${date}_17:00`;
  const slotData = flatSlot(uniqNo, '17:00', '18:00');

  // 第一次下单失败 → failed 记录
  kit.stubFetch(kit.lockFlowFetch({ createBody: { code: 1001, msg: '该时段已被预订' } }));
  const first = await bookingLockService.attemptLock({ intent, slot: slotData, date });
  assert.equal(first.success, false);
  assert.equal(prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks WHERE uniq_no = ?`).get(uniqNo).cnt, 1);

  // 格子回流后重试：failed 不阻塞，同 uniq_no 再锁成功
  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);
  const second = await bookingLockService.attemptLock({ intent, slot: slotData, date });
  assert.equal(second.success, true);
  assert.equal(second.orderId, 'ORD-123');
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create']);

  const rows = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ? ORDER BY created_at, id`).all(uniqNo);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.status).sort(), ['failed', 'locked']);
});

test('部分唯一索引：已有 locked 记录时 attemptLock 跳过，不重复下单', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(1);
  const intent = makeIntentRow();
  const uniqNo = `41_${date}_17:00`;
  const slotData = flatSlot(uniqNo, '17:00', '18:00');

  const fetchStub = kit.lockFlowFetch();
  kit.stubFetch(fetchStub);

  const first = await bookingLockService.attemptLock({ intent, slot: slotData, date });
  assert.equal(first.success, true);

  const second = await bookingLockService.attemptLock({ intent, slot: slotData, date });
  assert.equal(second.success, true);
  assert.equal(second.skipped, true);
  assert.equal(second.orderId, 'ORD-123');

  // 第二次未触发任何下单请求
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create']);
  assert.equal(prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks`).get().cnt, 1);
});

test('部分唯一索引：DB 层拦同 uniq_no 双 locked，放行 failed 并存', async () => {
  resetLock();
  const intent = makeIntentRow();
  const insert = (id, uniqNo, status) => prepare(
    `INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, status)
     VALUES (?, ?, ?, ?, '17:00', '18:00', ?)`).run(id, intent.id, uniqNo, kit.datePlus(1), status);

  insert('bil-a1', 'u-dup', 'locked');
  assert.throws(() => insert('bil-a2', 'u-dup', 'locked'), /UNIQUE/);
  // failed 与 locked 可同 uniq_no 并存；多条 failed 也可并存
  insert('bil-a3', 'u-dup', 'failed');
  insert('bil-a4', 'u-dup', 'failed');
  assert.equal(prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks WHERE uniq_no = 'u-dup'`).get().cnt, 3);
});

// === 两击降级 ===

/** 造一条 locked 记录（走真实下单链路），返回 { intent, uniqNo, date } */
async function seedLockedRow() {
  const date = kit.datePlus(1);
  const intent = makeIntentRow({ durationHours: 1, windowStart: '17:00', windowEnd: '18:00' });
  const uniqNo = `41_${date}_17:00`;
  kit.stubFetch(kit.lockFlowFetch());
  await bookingLockService.attemptLock({ intent, slot: flatSlot(uniqNo, '17:00', '18:00'), date });
  return { intent, uniqNo, date };
}

test('两击降级：第 1 次回流自动重锁 + 重锁通知，第 2 次降级仅提醒 + 降级通知', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const { intent, uniqNo, date } = await seedLockedRow();
  const env = intentService.getEnvConfig();
  const returned = flatSlot(uniqNo, '17:00', '18:00');

  // 第 1 次 0→1 回流：自动重锁
  const fetchStub = kit.lockFlowFetch({ createBody: { code: 200, data: { areaOrderId: 'ORD-RELOCK' } } });
  kit.stubFetch(fetchStub);
  kit.PUSH_CALLS.length = 0;
  const first = await bookingLockService.handleUnpaidReturn(returned, env);
  assert.deepEqual(first, { handled: true, downgraded: false });
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create']);

  let row = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ?`).get(uniqNo);
  assert.equal(row.unpaid_expired_count, 1);
  assert.equal(row.status, 'locked'); // 原行更新，不新增 locked 行
  assert.equal(row.order_id, 'ORD-RELOCK');
  assert.equal(prepare(`SELECT COUNT(*) AS cnt FROM booking_intent_locks WHERE uniq_no = ?`).get(uniqNo).cnt, 1);

  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /【重新锁场】/);
  assert.match(kit.PUSH_CALLS[0].body.content, /ORD-RELOCK/);
  assert.match(kit.PUSH_CALLS[0].body.content, /5 分钟/);
  // 重锁通知落 watch_notifications（带 intentId）
  const relockNotif = prepare(`SELECT * FROM watch_notifications WHERE uniq_no = ?`).get(uniqNo);
  assert.equal(relockNotif.intent_id, intent.id);
  assert.equal(relockNotif.success, 1);

  // 第 2 次 0→1 回流：降级为仅提醒，不再自动锁场
  kit.stubFetch(kit.lockFlowFetch());
  kit.PUSH_CALLS.length = 0;
  const second = await bookingLockService.handleUnpaidReturn(returned, env);
  assert.deepEqual(second, { handled: true, downgraded: true });

  row = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ?`).get(uniqNo);
  assert.equal(row.unpaid_expired_count, 2);
  assert.equal(bookingLockService.isDowngraded(intent.id, date), true);

  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /【已降级】/);
  assert.match(kit.PUSH_CALLS[0].body.content, /降级为.*仅提醒/);
  assert.match(kit.PUSH_CALLS[0].body.content, /不再自动锁场/);

  // 降级后该次发生不再自动锁场
  const fulfill = await bookingLockService.tryFulfill(intent, date, [returned], env);
  assert.equal(fulfill.skipped, 'downgraded');
  assert.equal(fulfill.locked, 0);
});

test('handleUnpaidReturn：重锁失败（格子被抢）→ 原行转 failed 释放占位', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const { intent, uniqNo, date } = await seedLockedRow();

  kit.stubFetch(kit.lockFlowFetch({ createBody: { code: 1001, msg: '该时段已被预订' } }));
  const result = await bookingLockService.handleUnpaidReturn(flatSlot(uniqNo, '17:00', '18:00'), intentService.getEnvConfig());
  assert.deepEqual(result, { handled: true, downgraded: false });

  const row = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ?`).get(uniqNo);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /重锁失败/);

  // failed 释放 uniq_no 占位：tryFulfill 可按新尝试重抢
  kit.stubFetch(kit.lockFlowFetch());
  const fulfill = await bookingLockService.tryFulfill(intent, date, [flatSlot(uniqNo, '17:00', '18:00')], intentService.getEnvConfig());
  assert.equal(fulfill.fulfilled, true);
  const rows = prepare(`SELECT * FROM booking_intent_locks WHERE uniq_no = ? ORDER BY created_at, id`).all(uniqNo);
  assert.deepEqual(rows.map(r => r.status).sort(), ['failed', 'locked']);
});

test('handleUnpaidReturn：不是我锁的格子 / 意图已停用 → handled=false', async () => {
  resetLock();
  kit.configureEnv({ withKey: true });
  const env = intentService.getEnvConfig();

  const unknown = await bookingLockService.handleUnpaidReturn(flatSlot('u-notmine', '17:00', '18:00'), env);
  assert.deepEqual(unknown, { handled: false });

  const { intent, uniqNo } = await seedLockedRow();
  intentService.updateIntent(intent.id, { enabled: false });
  const disabled = await bookingLockService.handleUnpaidReturn(flatSlot(uniqNo, '17:00', '18:00'), env);
  assert.deepEqual(disabled, { handled: false });
});

// === 锁场记录查询 ===

test('listLockRecords：intentId 过滤 + 倒序分页 + 字段输出', () => {
  resetLock();
  const a = makeIntentRow({ date: kit.datePlus(1) });
  const b = makeIntentRow({ date: kit.datePlus(2) });
  const insert = (id, intentId, uniqNo) => prepare(
    `INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status)
     VALUES (?, ?, ?, ?, '17:00', '18:00', 41, '1号场', 'ORD-1', 'locked')`)
    .run(id, intentId, uniqNo, kit.datePlus(1));
  insert('bil-1', a.id, 'u-1');
  insert('bil-2', a.id, 'u-2');
  insert('bil-3', b.id, 'u-3');

  const page1 = bookingLockService.listLockRecords({ pageNo: 1, pageSize: 2 });
  assert.equal(page1.total, 3);
  assert.equal(page1.list.length, 2);
  assert.equal(page1.list[0].orderId, 'ORD-1');
  assert.equal(page1.list[0].areaName, '1号场');

  const filtered = bookingLockService.listLockRecords({ intentId: b.id });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.list[0].uniqNo, 'u-3');
  assert.equal(filtered.list[0].intentId, b.id);
});
