const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { api, setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-intent-api-test-');

const intentService = require('../src/services/intentService');
const { today } = require('../src/services/venueShared');
const kit = require('./helpers/watchTestKit');

const ADMIN = { 'x-admin-token': 'test-admin-token' };

function resetIntents() {
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

// === 配置 ===

test('GET /config 只返回布尔与开关，PUT 只接受 enabled/areaPriority', async () => {
  resetIntents();

  const initial = await api.get('/api/intents/config').expect(200);
  assert.equal(initial.body.success, true);
  assert.deepEqual(initial.body.data, {
    enabled: true,
    pushConfigured: false,
    gymTokenConfigured: false,
    pollIntervalSec: 120,
    areaPriority: [],
    areaPriorityNames: []
  });

  kit.configureEnv();
  process.env.POLL_INTERVAL_SEC = '300';
  const configured = await api.get('/api/intents/config').expect(200);
  assert.equal(configured.body.data.pushConfigured, true);
  assert.equal(configured.body.data.gymTokenConfigured, true);
  assert.equal(configured.body.data.pollIntervalSec, 300);
  assert.doesNotMatch(JSON.stringify(configured.body), /wxtoken-secret-9999|pp-token-abcd1234/);

  // PUT 只认 enabled/areaPriority；附带凭证字段被忽略且不回显
  const put = await api.put('/api/intents/config').set(ADMIN)
    .send({ enabled: false, tokenUser: 'should-be-ignored', webhookToken: 'also-ignored' }).expect(200);
  assert.equal(put.body.data.enabled, false);
  assert.equal(put.body.data.gymTokenConfigured, true); // 来自 env，不受 PUT 影响
  assert.doesNotMatch(JSON.stringify(put.body), /should-be-ignored|also-ignored/);
  const columns = prepare('PRAGMA table_info(watch_config)').all().map(c => c.name);
  assert.deepEqual(columns, ['id', 'enabled', 'token_invalid_notified', 'area_priority', 'poll_failure_notified', 'updated_at']);

  const badEnabled = await api.put('/api/intents/config').set(ADMIN).send({ enabled: 'yes' }).expect(422);
  assert.match(badEnabled.body.error.message, /总开关/);

  const missing = await api.put('/api/intents/config').set(ADMIN).send({}).expect(422);
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR');
});

test('config：全局场地优先级 areaPriority 保存、回显名称、非法值 422', async () => {
  resetIntents();
  intentService.recordAreaNames([{ areaId: 41, areaName: '1号场' }, { areaId: 42, areaName: '2号场' }]);

  const put = await api.put('/api/intents/config').set(ADMIN)
    .send({ areaPriority: [42, 41] }).expect(200);
  assert.deepEqual(put.body.data.areaPriority, [42, 41]);
  assert.deepEqual(put.body.data.areaPriorityNames, ['2号场', '1号场']);
  assert.equal(put.body.data.enabled, true); // 不影响总开关

  const got = await api.get('/api/intents/config').expect(200);
  assert.deepEqual(got.body.data.areaPriority, [42, 41]);

  await api.put('/api/intents/config').set(ADMIN).send({ areaPriority: 'x' }).expect(422);
  await api.put('/api/intents/config').set(ADMIN).send({ areaPriority: [-1] }).expect(422);
});

test('GET /areas 返回引擎记录的场地列表', async () => {
  resetIntents();
  const empty = await api.get('/api/intents/areas').expect(200);
  assert.deepEqual(empty.body.data, []);

  intentService.recordAreaNames([{ areaId: 42, areaName: '2号场' }, { areaId: 41, areaName: '1号场' }]);
  const res = await api.get('/api/intents/areas').expect(200);
  assert.deepEqual(res.body.data, [
    { areaId: 41, areaName: '1号场' },
    { areaId: 42, areaName: '2号场' }
  ]);
});

// === 意图 CRUD ===

test('意图 CRUD：单次/每周双模式、更新切换模式、404', async () => {
  resetIntents();
  const date = today();

  // 单次模式
  const single = await api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '17:00', windowEnd: '20:00', durationHours: 2, preferredAreaIds: [41, 42] }).expect(201);
  assert.match(single.body.data.id, /^int-/);
  assert.equal(single.body.data.mode, 'auto_lock'); // 缺省
  assert.equal(single.body.data.date, date);
  assert.equal(single.body.data.weekdays, null);
  assert.equal(single.body.data.durationHours, 2);
  assert.equal(single.body.data.courtsNeeded, 1);
  assert.deepEqual(single.body.data.preferredAreaIds, [41, 42]);
  assert.deepEqual(single.body.data.preferredAreaNames, []); // 尚未拉取过，允许为空
  assert.equal(single.body.data.enabled, true);
  assert.equal(single.body.data.expired, false);
  assert.equal(single.body.data.status, 'monitoring');

  // 每周模式
  const weekly = await api.post('/api/intents').set(ADMIN)
    .send({ weekdays: [6, 0], windowStart: '19:00', windowEnd: '21:00', durationHours: 2, mode: 'notify' }).expect(201);
  assert.equal(weekly.body.data.date, null);
  assert.deepEqual(weekly.body.data.weekdays, [6, 0]);
  assert.equal(weekly.body.data.mode, 'notify');

  const list = await api.get('/api/intents').expect(200);
  assert.equal(list.body.data.length, 2);

  // 更新：切换为每周模式（date 被清空）
  const updated = await api.put(`/api/intents/${single.body.data.id}`).set(ADMIN)
    .send({ weekdays: [1], windowEnd: '22:00', preferredAreaIds: [] }).expect(200);
  assert.equal(updated.body.data.date, null);
  assert.deepEqual(updated.body.data.weekdays, [1]);
  assert.equal(updated.body.data.windowEnd, '22:00');
  assert.deepEqual(updated.body.data.preferredAreaIds, []);

  // 写接口需要令牌
  await api.post('/api/intents').send({ date, windowStart: '08:00', windowEnd: '10:00', durationHours: 1 }).expect(401);
  await api.put(`/api/intents/${single.body.data.id}`).send({ enabled: false }).expect(401);
  await api.delete(`/api/intents/${single.body.data.id}`).expect(401);

  await api.put('/api/intents/int-nonexistent').set(ADMIN).send({ windowEnd: '15:00' }).expect(404);

  const removed = await api.delete(`/api/intents/${weekly.body.data.id}`).set(ADMIN).expect(200);
  assert.equal(removed.body.data, null);
  await api.delete(`/api/intents/${weekly.body.data.id}`).set(ADMIN).expect(404);
});

test('过期单次意图可切换为每周模式（过期日期不参与合并校验）', async () => {
  resetIntents();
  // 窗口外日期无法通过 API 创建，直接写库模拟历史遗留意图
  const expired = intentService.createIntent({
    mode: 'notify', date: kit.datePlus(-1), weekdays: null,
    windowStart: '08:00', windowEnd: '12:00', durationHours: 2
  });
  assert.equal(expired.expired, true);

  const updated = await api.put(`/api/intents/${expired.id}`).set(ADMIN)
    .send({ weekdays: [1, 2] }).expect(200);
  assert.equal(updated.body.data.date, null);
  assert.deepEqual(updated.body.data.weekdays, [1, 2]);
  assert.equal(updated.body.data.expired, false);
});

test('创建校验：date/weekdays 二选一、窗口先后、时长超窗口、字段格式', async () => {
  resetIntents();
  const date = today();
  const mk = (payload) => api.post('/api/intents').set(ADMIN)
    .send({ windowStart: '17:00', windowEnd: '20:00', durationHours: 2, ...payload });

  const both = await mk({ date, weekdays: [6, 0] }).expect(422);
  assert.match(both.body.error.message, /二选一/);

  const neither = await api.post('/api/intents').set(ADMIN)
    .send({ windowStart: '17:00', windowEnd: '20:00', durationHours: 2 }).expect(422);
  assert.match(neither.body.error.message, /单次日期.*每周重复/);

  const badWeekdays = await mk({ weekdays: [7] }).expect(422);
  assert.match(badWeekdays.body.error.message, /0-6/);

  const dupWeekdays = await mk({ weekdays: [1, 1] }).expect(422);
  assert.match(dupWeekdays.body.error.message, /不能重复/);

  const reversed = await mk({ date, windowStart: '20:00', windowEnd: '17:00' }).expect(422);
  assert.match(reversed.body.error.message, /结束时间必须晚于开始时间/);

  const tooLong = await mk({ date, durationHours: 4 }).expect(422);
  assert.match(tooLong.body.error.message, /打球时长不能超过时间窗口/);

  const badTime = await mk({ date, windowStart: '17点' }).expect(422);
  assert.match(badTime.body.error.message, /HH:MM/);

  const badMode = await mk({ date, mode: 'rush' }).expect(422);
  assert.match(badMode.body.error.message, /auto_lock 或 notify/);

  for (const bad of [0, 13, 1.5, 'x']) {
    await mk({ date, durationHours: bad }).expect(422);
  }
  for (const bad of [0, 4]) {
    await mk({ date, courtsNeeded: bad }).expect(422);
  }

  const badDate = await mk({ date: '2026/01/01' }).expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);
});

test('单次日期限制在放票窗口内（今天起 4 天）', async () => {
  resetIntents();
  const mk = (date) => api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '17:00', windowEnd: '20:00', durationHours: 2 });

  // 窗口外：昨天（已过期）与今天+4（尚未放票）都拒绝
  const yesterday = await mk(kit.datePlus(-1)).expect(422);
  assert.match(yesterday.body.error.message, /4 天/);

  const tooFar = await mk(kit.datePlus(4)).expect(422);
  assert.match(tooFar.body.error.message, /场馆只放 4 天的票/);

  // 窗口内：今天与今天+3（窗口最后一天）都接受
  const okToday = await mk(today()).expect(201);
  assert.equal(okToday.body.data.date, today());

  const last = await mk(kit.datePlus(3)).expect(201);
  assert.equal(last.body.data.date, kit.datePlus(3));
});

test('更新校验：合并已有行做跨字段校验（缩窗口不能小于时长）', async () => {
  resetIntents();
  const created = await api.post('/api/intents').set(ADMIN)
    .send({ date: today(), windowStart: '17:00', windowEnd: '21:00', durationHours: 3 }).expect(201);
  const id = created.body.data.id;

  // 缩窗口到 2 小时 < duration 3 → 422
  const narrowed = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowEnd: '19:00' }).expect(422);
  assert.match(narrowed.body.error.message, /打球时长不能超过时间窗口/);

  // 同时缩时长 → 通过
  const ok = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowEnd: '19:00', durationHours: 2 }).expect(200);
  assert.equal(ok.body.data.windowEnd, '19:00');
  assert.equal(ok.body.data.durationHours, 2);

  // 颠倒窗口 → 422
  const reversed = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowStart: '20:00' }).expect(422);
  assert.match(reversed.body.error.message, /结束时间必须晚于开始时间/);
});

// === 推送历史与锁场记录（intentId 过滤） ===

test('GET /notifications 倒序分页 + ?intentId= 过滤', async () => {
  resetIntents();
  const a = intentService.createIntent({ date: today(), weekdays: null, windowStart: '08:00', windowEnd: '12:00', durationHours: 1 });
  const b = intentService.createIntent({ date: today(), weekdays: null, windowStart: '13:00', windowEnd: '15:00', durationHours: 1 });

  for (let i = 0; i < 3; i++) {
    intentService.recordNotification({
      intentId: a.id, uniqNo: `u-a-${i}`, areaName: '1号场', date: today(),
      startTime: `0${i}:00`, endTime: `0${i + 1}:00`, price: 60, success: true
    });
  }
  intentService.recordNotification({
    intentId: b.id, uniqNo: 'u-b-0', areaName: '2号场', date: today(), startTime: '13:00', endTime: '14:00', success: true
  });

  const page1 = await api.get('/api/intents/notifications?pageNo=1&pageSize=2').expect(200);
  assert.equal(page1.body.data.total, 4);
  assert.equal(page1.body.data.pageNo, 1);
  assert.equal(page1.body.data.pageSize, 2);
  assert.equal(page1.body.data.list.length, 2);

  const page2 = await api.get('/api/intents/notifications?pageNo=2&pageSize=2').expect(200);
  assert.equal(page2.body.data.list.length, 2);

  const filtered = await api.get(`/api/intents/notifications?intentId=${b.id}`).expect(200);
  assert.equal(filtered.body.data.total, 1);
  assert.equal(filtered.body.data.list[0].uniqNo, 'u-b-0');
  assert.equal(filtered.body.data.list[0].intentId, b.id);
});

test('GET /locks 倒序分页 + ?intentId= 过滤，只读无需写权限', async () => {
  resetIntents();
  const a = intentService.createIntent({ date: today(), weekdays: null, windowStart: '08:00', windowEnd: '12:00', durationHours: 1 });
  const b = intentService.createIntent({ date: today(), weekdays: null, windowStart: '13:00', windowEnd: '15:00', durationHours: 1 });

  const insertLock = (id, intentId, uniqNo, status = 'locked') => prepare(
    `INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status)
     VALUES (?, ?, ?, ?, '09:00', '10:00', 41, '1号场', 'ORD-1', ?)`)
    .run(id, intentId, uniqNo, today(), status);
  insertLock('bil-1', a.id, 'u-1');
  insertLock('bil-2', a.id, 'u-2', 'failed');
  insertLock('bil-3', b.id, 'u-3');

  const page1 = await api.get('/api/intents/locks?pageNo=1&pageSize=2').expect(200);
  assert.equal(page1.body.data.total, 3);
  assert.equal(page1.body.data.list.length, 2);
  assert.equal(page1.body.data.list[0].status, 'locked');
  assert.equal(page1.body.data.list[0].unpaidExpiredCount, 0);

  const page2 = await api.get('/api/intents/locks?pageNo=2&pageSize=2').expect(200);
  assert.equal(page2.body.data.list.length, 1);

  const filtered = await api.get(`/api/intents/locks?intentId=${b.id}`).expect(200);
  assert.equal(filtered.body.data.total, 1);
  assert.equal(filtered.body.data.list[0].uniqNo, 'u-3');
  assert.equal(filtered.body.data.list[0].intentId, b.id);
});

// === GET /availability ===

test('GET /availability 透传外部数据，401/403 返回 422 中文错误', async () => {
  resetIntents();

  const noToken = await api.get(`/api/intents/availability?date=${today()}`).expect(422);
  assert.match(noToken.body.error.message, /token/);

  kit.configureEnv();

  const badDate = await api.get('/api/intents/availability?date=2026/01/01').expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);

  kit.stubFetch(kit.leaseAndPushFetch(() => kit.leaseResponse([kit.slot('41_A_09:00_10:00', '09:00', '10:00')])));
  const ok = await api.get(`/api/intents/availability?date=${today()}`).expect(200);
  assert.equal(ok.body.data.areaDate, today());
  assert.equal(ok.body.data.areas[0].areaId, 41);
  // 只读透传：不改本地快照
  assert.equal(prepare('SELECT COUNT(*) AS cnt FROM watch_slot_state').get().cnt, 0);

  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse({ code: 401 })));
  const invalid = await api.get(`/api/intents/availability?date=${today()}`).expect(422);
  assert.match(invalid.body.error.message, /小程序 token 已失效，请更新服务器 \.env 并重启/);

  // 403（场次尚未开始售卖）：透传上游文案
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse({ code: 403, message: '场次尚未开始售卖' })));
  const notOnSale = await api.get(`/api/intents/availability?date=${today()}`).expect(422);
  assert.match(notOnSale.body.error.message, /场次尚未开始售卖/);

  // 上游异常 → 502
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse(null, { ok: false, status: 500 })));
  await api.get(`/api/intents/availability?date=${today()}`).expect(502);
});
