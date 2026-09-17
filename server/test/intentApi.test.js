const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { api, setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-intent-api-test-');

const intentService = require('../src/services/intentService');
const watchEngine = require('../src/services/watchEngine');
const { BOOKING_WINDOW_DAYS, today } = require('../src/services/venueShared');
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
  watchEngine.resetEngineState();
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

test('意图 CRUD：单日模型（不再有 weekdays）、同一天可多条、更新日期、404 与写权限', async () => {
  resetIntents();
  const date = today();

  const single = await api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '17:00', windowEnd: '20:00', durationHours: 2, preferredAreaIds: [41, 42] }).expect(201);
  assert.match(single.body.data.id, /^int-/);
  assert.equal(single.body.data.mode, 'auto_lock'); // 缺省
  assert.equal(single.body.data.date, date);
  assert.equal('weekdays' in single.body.data, false); // 单模型：不再输出 weekdays
  assert.equal(single.body.data.status, 'watching');
  assert.equal(single.body.data.durationHours, 2);
  assert.equal(single.body.data.courtsNeeded, 1);
  assert.deepEqual(single.body.data.preferredAreaIds, [41, 42]);
  assert.deepEqual(single.body.data.preferredAreaNames, []); // 尚未拉取过，允许为空
  assert.equal(single.body.data.enabled, true);
  assert.equal(single.body.data.expired, false);
  assert.equal(single.body.data.verifyDeadline, null);
  assert.equal(single.body.data.lastAttempt, null);

  // 同一天可多条（多时段）
  const second = await api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '19:00', windowEnd: '21:00', durationHours: 1, mode: 'notify', enabled: false }).expect(201);
  assert.equal(second.body.data.mode, 'notify');
  assert.equal(second.body.data.status, 'paused');

  const list = await api.get('/api/intents').expect(200);
  assert.equal(list.body.data.length, 2);

  // 更新：改日期与普通字段
  const updated = await api.put(`/api/intents/${single.body.data.id}`).set(ADMIN)
    .send({ date: kit.datePlus(1), windowEnd: '22:00', preferredAreaIds: [] }).expect(200);
  assert.equal(updated.body.data.date, kit.datePlus(1));
  assert.equal(updated.body.data.windowEnd, '22:00');
  assert.deepEqual(updated.body.data.preferredAreaIds, []);

  // 写接口需要令牌
  await api.post('/api/intents').send({ date, windowStart: '08:00', windowEnd: '10:00', durationHours: 1 }).expect(401);
  await api.put(`/api/intents/${single.body.data.id}`).send({ enabled: false }).expect(401);
  await api.delete(`/api/intents/${single.body.data.id}`).expect(401);

  await api.put('/api/intents/int-nonexistent').set(ADMIN).send({ windowEnd: '15:00' }).expect(404);

  const removed = await api.delete(`/api/intents/${second.body.data.id}`).set(ADMIN).expect(200);
  assert.equal(removed.body.data, null);
  await api.delete(`/api/intents/${second.body.data.id}`).set(ADMIN).expect(404);
});

test('过期意图：status=expired、PUT 合并现有日期后 422，显式新日期可救回', async () => {
  resetIntents();
  // 过期日期无法通过 API 创建，直接写库模拟历史遗留意图
  const expired = intentService.createIntent({
    mode: 'notify', date: kit.datePlus(-1),
    windowStart: '08:00', windowEnd: '12:00', durationHours: 2
  });

  const list = await api.get('/api/intents').expect(200);
  const row = list.body.data.find(i => i.id === expired.id);
  assert.equal(row.status, 'expired');
  assert.equal(row.expired, true);

  // 跨字段校验合并现有行：过期日期不满足"不早于今天" → 普通 PUT 422
  const put = await api.put(`/api/intents/${expired.id}`).set(ADMIN).send({ windowEnd: '13:00' }).expect(422);
  assert.match(put.body.error.message, /不能给过去的日期设置监控/);
  assert.equal(intentService.getIntentById(expired.id).window_end, '12:00'); // 未落库

  // 显式改到今天 → 通过
  const rescued = await api.put(`/api/intents/${expired.id}`).set(ADMIN).send({ date: today() }).expect(200);
  assert.equal(rescued.body.data.date, today());
  assert.equal(rescued.body.data.status, 'watching');

  await api.delete(`/api/intents/${expired.id}`).set(ADMIN).expect(200);
});

test('创建校验：同一天同一时间段不可重复建监控（编辑排除自身，重叠窗口允许）', async () => {
  resetIntents();
  const date = today();
  const base = { date, windowStart: '20:00', windowEnd: '21:00', durationHours: 1 };

  const first = await api.post('/api/intents').set(ADMIN).send(base).expect(201);

  // 完全相同窗口（含不同时长/模式）→ 422
  const dup = await api.post('/api/intents').set(ADMIN).send(base).expect(422);
  assert.equal(dup.body.error.message, '该时段已有监控');
  const dupOtherMode = await api.post('/api/intents').set(ADMIN)
    .send({ ...base, mode: 'notify' }).expect(422);
  assert.equal(dupOtherMode.body.error.message, '该时段已有监控');

  // 同一小时但窗口不同 / 部分重叠 → 允许
  await api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '19:00', windowEnd: '21:00', durationHours: 2 }).expect(201);
  await api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '20:00', windowEnd: '22:00', durationHours: 2 }).expect(201);

  // 编辑自身（窗口不改）→ 200；改到与另一条完全相同的窗口 → 422
  const self = await api.put(`/api/intents/${first.body.data.id}`).set(ADMIN)
    .send({ durationHours: 1 }).expect(200);
  assert.equal(self.body.data.windowStart, '20:00');
  const clash = await api.put(`/api/intents/${first.body.data.id}`).set(ADMIN)
    .send({ windowStart: '19:00', windowEnd: '21:00' }).expect(422);
  assert.equal(clash.body.error.message, '该时段已有监控');

  // 另一天的同一窗口不受影响
  await api.post('/api/intents').set(ADMIN)
    .send({ ...base, date: kit.datePlus(1) }).expect(201);
});

test('创建校验：日期必填/格式/不早于今天、weekdays 拒绝、窗口先后、时长超窗口', async () => {
  resetIntents();
  const date = today();
  const mk = (payload) => api.post('/api/intents').set(ADMIN)
    .send({ windowStart: '17:00', windowEnd: '20:00', durationHours: 2, ...payload });

  const missing = await api.post('/api/intents').set(ADMIN)
    .send({ windowStart: '17:00', windowEnd: '20:00', durationHours: 2 }).expect(422);
  assert.match(missing.body.error.message, /请选择日期/);

  const nullDate = await mk({ date: null }).expect(422);
  assert.match(nullDate.body.error.message, /请选择日期/);

  const badDate = await mk({ date: '2026/01/01' }).expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);

  const past = await mk({ date: kit.datePlus(-1) }).expect(422);
  assert.match(past.body.error.message, /不能给过去的日期设置监控/);

  // 单模型：任何形态的 weekdays 都不再接受
  for (const weekdays of [[1], [6, 0], [], null, 'weekly']) {
    const res = await mk({ date, weekdays }).expect(422);
    assert.match(res.body.error.message, /不再支持每周重复，请按日期设置/);
  }

  const reversed = await mk({ date, windowStart: '20:00', windowEnd: '17:00' }).expect(422);
  assert.match(reversed.body.error.message, /结束时间必须晚于开始时间/);

  // 时长上限 2 小时（暂不支持连打 2 小时以上）
  const tooLong = await mk({ date, durationHours: 3 }).expect(422);
  assert.match(tooLong.body.error.message, /暂不支持连打 2 小时以上/);

  // 窗口小于时长（合法时长 2 小时 + 1.5 小时窗口）
  const tooLongForWindow = await mk({ date, windowStart: '17:00', windowEnd: '18:30', durationHours: 2 }).expect(422);
  assert.match(tooLongForWindow.body.error.message, /打球时长不能超过时间窗口/);

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
});

test('创建校验：时长/片场上限与组合约束（每天最多 2 个片次）', async () => {
  resetIntents();
  const date = today();
  const mk = (payload) => api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '17:00', windowEnd: '20:00', durationHours: 1, ...payload });

  const threeHours = await mk({ durationHours: 3 }).expect(422);
  assert.match(threeHours.body.error.message, /暂不支持连打 2 小时以上/);

  const threeCourts = await mk({ courtsNeeded: 3 }).expect(422);
  assert.match(threeCourts.body.error.message, /同一天最多 2 片次/);

  const combo = await mk({ durationHours: 2, courtsNeeded: 2 }).expect(422);
  assert.match(combo.body.error.message, /每天最多 2 个片次（场地×小时），当前组合需要 4 个/);

  // 合法组合：2 小时 × 1 片 / 1 小时 × 2 片
  const twoHours = await mk({ durationHours: 2, windowStart: '18:00', windowEnd: '20:00' }).expect(201);
  assert.equal(twoHours.body.data.durationHours, 2);
  assert.equal(twoHours.body.data.courtsNeeded, 1);
  const twoCourts = await mk({ durationHours: 1, courtsNeeded: 2, windowStart: '20:00', windowEnd: '21:00' }).expect(201);
  assert.equal(twoCourts.body.data.courtsNeeded, 2);

  // update 走合并校验：已有 2 小时意图追加“同时 2 片” → 组合超限 422
  const upd = await api.put(`/api/intents/${twoHours.body.data.id}`).set(ADMIN)
    .send({ courtsNeeded: 2 }).expect(422);
  assert.match(upd.body.error.message, /每天最多 2 个片次/);
  // 撤回为 1 片合法
  const ok = await api.put(`/api/intents/${twoHours.body.data.id}`).set(ADMIN)
    .send({ courtsNeeded: 1 }).expect(200);
  assert.equal(ok.body.data.courtsNeeded, 1);
});

test('提前设置：窗口外任意未来日期可创建（waiting），过去日期 422', async () => {
  resetIntents();
  const mk = (date) => api.post('/api/intents').set(ADMIN)
    .send({ date, windowStart: '17:00', windowEnd: '20:00', durationHours: 2 });

  await mk(kit.datePlus(-1)).expect(422);

  const todayOk = await mk(today()).expect(201);
  assert.equal(todayOk.body.data.status, 'watching');

  // 窗口最后一天：09:00 前「待放票」，09:00 起「监控中」（精确分界由 intentService 用例锁定）
  const last = await mk(kit.datePlus(BOOKING_WINDOW_DAYS - 1)).expect(201);
  assert.ok(['pending_release', 'watching'].includes(last.body.data.status));

  // 窗口之外：提前设置，显示「等待放票」
  const farDate = kit.datePlus(BOOKING_WINDOW_DAYS + 10);
  const far = await mk(farDate).expect(201);
  assert.equal(far.body.data.status, 'waiting');
  // 窗口外照样展开：进窗口后自动生效
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(far.body.data.id)), [farDate]);
});

test('GET /intents：status 逐条正确（expired/fulfilled/paused/watching/waiting）+ lastAttempt + from/to 过滤', async () => {
  resetIntents();
  const todayIntent = await api.post('/api/intents').set(ADMIN)
    .send({ date: today(), windowStart: '19:00', windowEnd: '20:00', durationHours: 1, mode: 'auto_lock' }).expect(201);
  const disabled = await api.post('/api/intents').set(ADMIN)
    .send({ date: today(), windowStart: '20:00', windowEnd: '21:00', durationHours: 1, enabled: false }).expect(201);
  const far = await api.post('/api/intents').set(ADMIN)
    .send({ date: kit.datePlus(BOOKING_WINDOW_DAYS + 2), windowStart: '20:00', windowEnd: '21:00', durationHours: 1 }).expect(201);
  const expired = intentService.createIntent({
    mode: 'notify', date: kit.datePlus(-1), windowStart: '08:00', windowEnd: '12:00', durationHours: 1
  });

  // 已锁到：locked 记录凑齐整段
  prepare(`INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, status, error_code)
    VALUES ('bil-api-1', ?, 'u-api-1', ?, '19:00', '20:00', 'locked', NULL)`).run(todayIntent.body.data.id, today());

  const list = await api.get('/api/intents').expect(200);
  const byId = new Map(list.body.data.map(i => [i.id, i]));
  assert.equal(byId.get(todayIntent.body.data.id).status, 'fulfilled');
  assert.equal(byId.get(todayIntent.body.data.id).lastAttempt.status, 'locked');
  assert.equal(byId.get(todayIntent.body.data.id).lastAttempt.attempts, 0);
  assert.equal(byId.get(todayIntent.body.data.id).verifyDeadline, null);
  assert.equal(byId.get(disabled.body.data.id).status, 'paused');
  assert.equal(byId.get(far.body.data.id).status, 'waiting');
  assert.equal(byId.get(expired.id).status, 'expired');
  assert.ok(!list.body.data.some(i => 'weekdays' in i));

  // from/to 过滤
  const range = await api.get(`/api/intents?from=${today()}&to=${today()}`).expect(200);
  assert.deepEqual(range.body.data.map(i => i.id).sort(), [todayIntent.body.data.id, disabled.body.data.id].sort());
  const none = await api.get(`/api/intents?from=${kit.datePlus(30)}`).expect(200);
  assert.deepEqual(none.body.data, []);

  // 非法查询参数 422
  const bad = await api.get('/api/intents?from=2026/01/01').expect(422);
  assert.match(bad.body.error.message, /YYYY-MM-DD/);
});

test('GET /intents：风控重试窗口内 status=awaiting_verify 且带 verifyDeadline，窗口结束回落', async () => {
  resetIntents();
  kit.configureEnv({ withKey: true });
  watchEngine.rcRetryConfig.intervalMs = 30;
  watchEngine.rcRetryConfig.windowMs = 400;
  const date = kit.datePlus(1);
  const created = await api.post('/api/intents').set(ADMIN)
    .send({ date, mode: 'auto_lock', windowStart: '19:00', windowEnd: '20:00', durationHours: 1 }).expect(201);
  const uniqNo = `41_${date}_19:00_20:00`;
  const lease = (available) => (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    return d === date ? kit.leaseResponse([kit.slot(uniqNo, '19:00', '20:00', { available })]) : kit.emptyLease(d);
  };

  kit.stubFetch(kit.lockFlowFetch({ leaseHandler: lease(false), createBody: { code: 429, msg: 'captcha required' } }));
  await watchEngine.pollOnce(); // 播种基线（不可订）
  kit.stubFetch(kit.lockFlowFetch({ leaseHandler: lease(true), createBody: { code: 429, msg: 'captcha required' } }));
  await watchEngine.pollOnce(); // 0→1 → 429 风控 → 重试窗口启动
  await new Promise(r => setTimeout(r, 80));

  const during = await api.get('/api/intents').expect(200);
  const retrying = during.body.data.find(i => i.id === created.body.data.id);
  assert.equal(retrying.status, 'awaiting_verify');
  assert.ok(retrying.verifyDeadline, '需验证状态应带重试截止时间');
  assert.ok(new Date(retrying.verifyDeadline).getTime() > Date.now());
  assert.equal(retrying.lastAttempt.errorCode, 'RISK_CONTROL');

  // 窗口结束 → 状态自然回落 watching（进程内状态清空，重启边界同）
  await new Promise(r => setTimeout(r, 700));
  const after = await api.get('/api/intents').expect(200);
  const reverted = after.body.data.find(i => i.id === created.body.data.id);
  assert.equal(reverted.status, 'watching');
  assert.equal(reverted.verifyDeadline, null);
});

test('更新校验：合并已有行做跨字段校验（缩窗口不能小于时长）', async () => {
  resetIntents();
  const created = await api.post('/api/intents').set(ADMIN)
    .send({ date: today(), windowStart: '17:00', windowEnd: '20:00', durationHours: 2 }).expect(201);
  const id = created.body.data.id;

  // 缩窗口到 1 小时 < duration 2 → 422
  const narrowed = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowEnd: '18:00' }).expect(422);
  assert.match(narrowed.body.error.message, /打球时长不能超过时间窗口/);

  // 同时缩时长 → 通过
  const ok = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowEnd: '18:00', durationHours: 1 }).expect(200);
  assert.equal(ok.body.data.windowEnd, '18:00');
  assert.equal(ok.body.data.durationHours, 1);

  // 颠倒窗口 → 422
  const reversed = await api.put(`/api/intents/${id}`).set(ADMIN)
    .send({ windowStart: '20:00' }).expect(422);
  assert.match(reversed.body.error.message, /结束时间必须晚于开始时间/);
});

// === 推送历史与锁场记录（intentId / date 过滤） ===

test('GET /notifications 倒序分页 + ?intentId= / ?date= 过滤', async () => {
  resetIntents();
  const a = intentService.createIntent({ date: today(), windowStart: '08:00', windowEnd: '12:00', durationHours: 1 });
  const b = intentService.createIntent({ date: today(), windowStart: '13:00', windowEnd: '15:00', durationHours: 1 });

  for (let i = 0; i < 3; i++) {
    intentService.recordNotification({
      intentId: a.id, uniqNo: `u-a-${i}`, areaName: '1号场', date: today(),
      startTime: `0${i}:00`, endTime: `0${i + 1}:00`, price: 60, success: true
    });
  }
  intentService.recordNotification({
    intentId: b.id, uniqNo: 'u-b-0', areaName: '2号场', date: kit.datePlus(1),
    startTime: '13:00', endTime: '14:00', success: true
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

  // 按天查询（历史按天展示）
  const byDate = await api.get(`/api/intents/notifications?date=${today()}`).expect(200);
  assert.equal(byDate.body.data.total, 3);
  assert.ok(byDate.body.data.list.every(n => n.date === today()));
  assert.equal((await api.get(`/api/intents/notifications?date=${kit.datePlus(9)}`).expect(200)).body.data.total, 0);
  const badDate = await api.get('/api/intents/notifications?date=2026/09/17').expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);
});

test('GET /locks 倒序分页 + ?intentId= / ?date= 过滤，只读无需写权限', async () => {
  resetIntents();
  const a = intentService.createIntent({ date: today(), windowStart: '08:00', windowEnd: '12:00', durationHours: 1 });
  const b = intentService.createIntent({ date: today(), windowStart: '13:00', windowEnd: '15:00', durationHours: 1 });

  const insertLock = (id, intentId, uniqNo, date, status = 'locked', errorCode = null, expireAt = null) => prepare(
    `INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, expire_at, status, error_code)
     VALUES (?, ?, ?, ?, '09:00', '10:00', 41, '1号场', 'ORD-1', ?, ?, ?)`)
    .run(id, intentId, uniqNo, date, expireAt, status, errorCode);
  insertLock('bil-1', a.id, 'u-1', today(), 'locked', null, '2026-09-17 14:28:28');
  insertLock('bil-2', a.id, 'u-2', today(), 'failed', 'RISK_CONTROL');
  insertLock('bil-3', b.id, 'u-3', kit.datePlus(1));

  const page1 = await api.get('/api/intents/locks?pageNo=1&pageSize=2').expect(200);
  assert.equal(page1.body.data.total, 3);
  assert.equal(page1.body.data.list.length, 2);
  assert.equal(page1.body.data.list[0].status, 'locked');

  const page2 = await api.get('/api/intents/locks?pageNo=2&pageSize=2').expect(200);
  assert.equal(page2.body.data.list.length, 1);

  const filtered = await api.get(`/api/intents/locks?intentId=${b.id}`).expect(200);
  assert.equal(filtered.body.data.total, 1);
  assert.equal(filtered.body.data.list[0].uniqNo, 'u-3');
  assert.equal(filtered.body.data.list[0].intentId, b.id);

  // 按天查询（历史按天展示）+ error_code 对外暴露
  const byDate = await api.get(`/api/intents/locks?date=${today()}`).expect(200);
  assert.equal(byDate.body.data.total, 2);
  assert.ok(byDate.body.data.list.every(l => l.date === today()));
  assert.ok(byDate.body.data.list.some(l => l.errorCode === 'RISK_CONTROL'));
  // expire_at（UTC）对外输出为 expireAt（前端 +8h 渲染支付截止）
  assert.ok(byDate.body.data.list.some(l => l.expireAt === '2026-09-17 14:28:28'));
  assert.equal((await api.get(`/api/intents/locks?date=${kit.datePlus(9)}`).expect(200)).body.data.total, 0);
  const badDate = await api.get('/api/intents/locks?date=2026/09/17').expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);
});

// === 更新小程序 token（专用密钥通道） ===

test('POST /token：缺/错密钥 403，正确密钥写入运行时 token 文件并即时生效', async () => {
  resetIntents();
  const fs = require('fs');
  const path = require('path');
  const tokenFile = path.join(process.env.GYM_RUNTIME_DIR, 'gym-token');

  await api.post('/api/intents/token').set(ADMIN).send({ token: 'x'.repeat(32) }).expect(403);
  await api.post('/api/intents/token').set({ ...ADMIN, 'x-token-key': 'wrong' })
    .send({ token: 'x'.repeat(32) }).expect(403);
  // 格式校验：太短 / 含空白
  const key = intentService.getTokenUpdateKey();
  await api.post('/api/intents/token').set({ ...ADMIN, 'x-token-key': key })
    .send({ token: 'short' }).expect(422);

  const token = `tok-${Date.now()}-${'a'.repeat(24)}`;
  const res = await api.post('/api/intents/token').set({ ...ADMIN, 'x-token-key': key })
    .send({ token }).expect(200);
  assert.equal(res.body.data.updated, true);
  assert.match(res.body.data.tokenPreview, /^tok-/);
  assert.equal(fs.readFileSync(tokenFile, 'utf-8'), token);
  // 即时生效：getEnvConfig 优先读文件
  assert.equal(intentService.getEnvConfig().tokenUser, token);

  fs.rmSync(tokenFile); // 清理，避免影响本文件后续用例（目录是 harness 隔离的临时目录）
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
