/**
 * watchEngine — 单一监控引擎：取数计划（常规节奏 + 新放票日 burst）、快照 diff、
 * 意图匹配、告警去重。fetch 全部经 watchTestKit stub，不访问外网。
 *
 * 涉及时钟的用例用 t.mock.timers 固定 Date（08:00 = burst 前的常规节奏；
 * 09:00:30 = burst 窗口），与真实运行时刻无关。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-watch-engine-test-');

const intentService = require('../src/services/intentService');
const watchEngine = require('../src/services/watchEngine');
const watchDigest = require('../src/services/watchDigest');
const watchNotifier = require('../src/services/watchNotifier');
const { BOOKING_WINDOW_DAYS, today } = require('../src/services/venueShared');
const kit = require('./helpers/watchTestKit');

/** 与 watchDigest 模块一致的日期标签（M/D、周X），用于拼预期文案 */
function mdLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekdayLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `周${'日一二三四五六'[d.getDay()]}`;
}

function resetEngine() {
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

/** 启用意图（写库），返回 DB 行 */
function makeIntent(overrides = {}) {
  const created = intentService.createIntent({
    mode: 'notify',
    date: kit.datePlus(2),
    weekdays: null,
    windowStart: '08:00',
    windowEnd: '22:00',
    durationHours: 1,
    courtsNeeded: 1,
    preferredAreaIds: [],
    ...overrides
  });
  return intentService.getIntentById(created.id);
}

/** 把时钟固定到今天的某个时刻（mock Date；mockTimeout=true 时 setTimeout 一并接管） */
function mockTime(t, hour, minute = 0, { mockTimeout = false } = {}) {
  const d = new Date();
  d.setHours(hour, minute, 30, 0);
  t.mock.timers.enable({ apis: mockTimeout ? ['Date', 'setTimeout'] : ['Date'], now: d.getTime() });
}

/** 推进 mocked 时钟越过常规轮询间隔（120s + 抖动 ≤15s），让计划内日期重新到期 */
async function advancePastPollInterval(t) {
  t.mock.timers.tick(140 * 1000);
  await new Promise(r => setImmediate(r));
}

function notifiedFlags() {
  return prepare('SELECT token_invalid_notified AS t, poll_failure_notified AS p FROM watch_config WHERE id = 1').get();
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

// === 跳过条件 ===

test('env 缺失时跳过轮询：缺 GYM_TOKEN_USER / 缺推送配置 / 总开关关闭 / 无有效意图', async () => {
  resetEngine();
  makeIntent();

  // 什么都没配 → no_token
  let result = await watchEngine.pollOnce();
  assert.equal(result.skipped, 'no_token');

  // 只配 token，缺推送 → no_webhook
  process.env.GYM_TOKEN_USER = 'wxtoken-secret-9999';
  result = await watchEngine.pollOnce();
  assert.equal(result.skipped, 'no_webhook');

  // 推送类型非法 → no_webhook
  process.env.PUSH_TYPE = 'bark';
  process.env.PUSH_TOKEN = 'pp-token-abcd1234';
  result = await watchEngine.pollOnce();
  assert.equal(result.skipped, 'no_webhook');

  // 全局开关关闭 → disabled
  kit.configureEnv();
  intentService.updateConfig({ enabled: false });
  result = await watchEngine.pollOnce();
  assert.equal(result.skipped, 'disabled');
  assert.equal(kit.PUSH_CALLS.length, 0);
});

test('过期单次意图被 loadActiveIntents 过滤：pollOnce 报 no_intents', async () => {
  resetEngine();
  kit.configureEnv();
  // 过期意图直接写库（窗口外日期无法通过校验创建）
  intentService.createIntent({
    mode: 'notify', date: kit.datePlus(-1), weekdays: null,
    windowStart: '08:00', windowEnd: '12:00', durationHours: 1
  });

  kit.stubFetch(kit.leaseAndPushFetch(() => kit.leaseResponse([kit.slot('41_A_09:00_10:00', '09:00', '10:00')])));
  const result = await watchEngine.pollOnce();
  assert.equal(result.skipped, 'no_intents');
  assert.deepEqual(watchEngine.loadActiveIntents(), []);
  assert.equal(kit.PUSH_CALLS.length, 0);
});

// === 快照 baseline 与 diff ===

test('首 poll 只播种基线不推送；0→1 推送一次不重复；1→0 不推；再释放再推', async () => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  const date = kit.datePlus(2);
  const uniqNo = `41_${date}_09:00_10:00`;
  // 只在目标日期返回 slot，其余日期空数据（uniqNo 是全局键，不能跨日期重复出现）
  const respond = (available) => (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    return d === date ? kit.leaseResponse([kit.slot(uniqNo, '09:00', '10:00', { available })]) : kit.emptyLease(d);
  };

  // 基线：不可订 → 只落快照
  const fetchStub = kit.leaseAndPushFetch(respond(false));
  kit.stubFetch(fetchStub);
  const baseline = await watchEngine.pollOnce();
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.notified, 0);
  assert.equal(kit.PUSH_CALLS.length, 0);
  assert.equal(prepare('SELECT available FROM watch_slot_state WHERE uniq_no = ?').get(uniqNo).available, 0);

  // 请求头断言：token-user 来自 env / x-gym-client-id / content-type
  const headers = fetchStub.leaseCalls[0].headers;
  assert.equal(headers['token-user'], 'wxtoken-secret-9999');
  assert.equal(headers['x-gym-client-id'], '1');
  assert.equal(headers['content-type'], 'application/json');

  // 0→1：推送一次（pushplus payload），逐 slot 落记录
  kit.stubFetch(kit.leaseAndPushFetch(respond(true)));
  const result = await watchEngine.pollOnce();
  assert.equal(result.notified, 1);
  assert.equal(kit.PUSH_CALLS.length, 1);
  const push = kit.PUSH_CALLS[0];
  assert.match(push.url, /pushplus\.plus\/send/);
  assert.equal(push.body.token, 'pp-token-abcd1234');
  assert.equal(push.body.template, 'markdown');
  assert.equal(push.body.title, `${mdLabel(date)} ${weekdayLabel(date)} 1号场 09:00-10:00 可订`);
  assert.match(push.body.content, /¥60/);

  const notif = prepare('SELECT * FROM watch_notifications').all();
  assert.equal(notif.length, 1);
  assert.equal(notif[0].success, 1);
  assert.equal(notif[0].intent_id, prepare('SELECT id FROM booking_intents').get().id);

  // 保持可订 → 不重复推
  await watchEngine.pollOnce();
  assert.equal(kit.PUSH_CALLS.length, 1);

  // 1→0：只更新快照不推送
  kit.stubFetch(kit.leaseAndPushFetch(respond(false)));
  const booked = await watchEngine.pollOnce();
  assert.equal(booked.notified, 0);
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.equal(prepare('SELECT available FROM watch_slot_state WHERE uniq_no = ?').get(uniqNo).available, 0);

  // 支付超时释放（0→1）→ 再次推送
  kit.stubFetch(kit.leaseAndPushFetch(respond(true)));
  const released = await watchEngine.pollOnce();
  assert.equal(released.notified, 1);
  assert.equal(kit.PUSH_CALLS.length, 2);
});

test('意图匹配过滤：窗口外与 preferredAreaIds 外的 slot 不推送', async () => {
  resetEngine();
  kit.configureEnv();
  // 只盯 2号场（areaId=42）08:00-10:00
  makeIntent({ windowStart: '08:00', windowEnd: '10:00', preferredAreaIds: [42] });
  const date = kit.datePlus(2);

  const areas = (available) => [
    { areaId: 41, areaName: '1号场', slots: [kit.slot(`41_${date}_09:00_10:00`, '09:00', '10:00', { available })] },
    { areaId: 42, areaName: '2号场', slots: [
      kit.slot(`42_${date}_09:00_10:00`, '09:00', '10:00', { available, areaId: 42, areaName: '2号场' }),
      kit.slot(`42_${date}_11:00_12:00`, '11:00', '12:00', { available, areaId: 42, areaName: '2号场' })
    ] }
  ];
  const respond = (available) => (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    return d === date ? kit.multiAreaLease(areas(available), { date: d }) : kit.emptyLease(d);
  };
  kit.stubFetch(kit.leaseAndPushFetch(respond(false)));
  await watchEngine.pollOnce(); // 基线

  kit.stubFetch(kit.leaseAndPushFetch(respond(true)));
  const result = await watchEngine.pollOnce();

  // 只有 42 的 09:00-10:00 命中：时间窗外的 11:00 与场地集合外的 41 都不推
  assert.equal(result.notified, 1);
  const notif = prepare('SELECT uniq_no FROM watch_notifications').all();
  assert.deepEqual(notif.map(n => n.uniq_no), [`42_${date}_09:00_10:00`]);
});

test('matchesIntent 单测：日期集合 / 窗口完整覆盖 / 场地过滤', () => {
  resetEngine();
  const row = makeIntent({ windowStart: '08:00', windowEnd: '10:00', preferredAreaIds: [42] });
  const intent = { row, dates: new Set(['2026-01-01']), areaIds: new Set([42]) };
  const base = { date: '2026-01-01', startTime: '09:00', endTime: '10:00', areaId: 42 };

  assert.equal(watchEngine.matchesIntent(base, intent), true);
  assert.equal(watchEngine.matchesIntent({ ...base, date: '2026-01-02' }, intent), false);
  assert.equal(watchEngine.matchesIntent({ ...base, startTime: '07:00' }, intent), false);
  assert.equal(watchEngine.matchesIntent({ ...base, endTime: '10:30' }, intent), false);
  assert.equal(watchEngine.matchesIntent({ ...base, areaId: 41 }, intent), false);
  // areaIds 为空 = 任意场地
  assert.equal(watchEngine.matchesIntent({ ...base, areaId: 99 }, { ...intent, areaIds: new Set() }), true);
});

test('推送失败写 notifications.success=0 且不抛出', async () => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  const date = kit.datePlus(2);
  const uniqNo = `41_${date}_09:00_10:00`;

  const respond = (available) => (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    return d === date ? kit.leaseResponse([kit.slot(uniqNo, '09:00', '10:00', { available })]) : kit.emptyLease(d);
  };
  kit.stubFetch(kit.leaseAndPushFetch(respond(false)));
  await watchEngine.pollOnce(); // 基线

  kit.stubFetch(async (url, opts = {}) => {
    if (String(url).includes('listAreaLease')) return respond(true)(url);
    kit.PUSH_CALLS.push({ url: String(url), body: JSON.parse(opts.body) });
    return kit.mockJsonResponse({ code: 500, msg: 'token 无效' }); // pushplus 业务失败
  });

  const result = await watchEngine.pollOnce();
  assert.equal(result.notified, 1);
  const notif = prepare('SELECT * FROM watch_notifications').all();
  assert.equal(notif.length, 1);
  assert.equal(notif[0].success, 0);
  assert.match(notif[0].error, /token 无效/);
});

// === 告警（走 tick，带计划节奏） ===

test('401 告警一次不重复，成功轮询后清零标记', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  mockTime(t, 8, 0, { mockTimeout: true });

  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse({ code: 401, msg: 'unauthorized' })));
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /告警/);
  assert.match(kit.PUSH_CALLS[0].body.content, /小程序 token 已失效.*请更新服务器 \.env 并重启/);
  assert.equal(notifiedFlags().t, 1);

  // 再次 401 → 不重复告警
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);

  // 恢复正常 → 标记清零，正常 diff 工作（首 poll 播种）
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.leaseResponse([])));
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(notifiedFlags().t, 0);
});

test('网关级 HTTP 401（body 无 code）同样识别为 token 失效，不误报拉取失败', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  mockTime(t, 8, 0, { mockTimeout: true });

  // 阿里云网关形态：HTTP 401，body 不是业务码结构
  kit.stubFetch(kit.leaseAndPushFetch(() =>
    kit.mockJsonResponse({ message: 'Invalid AccessToken' }, { ok: false, status: 401 })));
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.content, /token 已失效/);
  assert.equal(notifiedFlags().t, 1);

  // 再来两轮网关 401：不重复告警，也绝不触发"拉取失败"告警
  await advancePastPollInterval(t);
  await watchEngine.tick();
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.equal(notifiedFlags().p, 0);
});

test('全失败轮次不清零 token 告警标记（401 → 网络失败 → 401 只告警一次）', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  mockTime(t, 8, 0, { mockTimeout: true });

  // 第 1 轮 401：告警一次
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse({ code: 401, msg: 'unauthorized' })));
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.equal(notifiedFlags().t, 1);

  // 第 2 轮网络全失败：不得清零 token 标记（没拉到数据 ≠ 已恢复）
  kit.stubFetch(kit.leaseAndPushFetch(async () => { throw new Error('network down'); }));
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(notifiedFlags().t, 1);

  // 第 3 轮 401：标记还在，不重复告警
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.mockJsonResponse({ code: 401, msg: 'unauthorized' })));
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
});

test('连续两轮全部日期拉取失败 → 告警一次不重复，恢复后清零', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent();
  mockTime(t, 8, 0, { mockTimeout: true });

  // 第 1 轮全失败：不到阈值，不告警（推送端点保持可用，仅 listAreaLease 抛错）
  kit.stubFetch(kit.leaseAndPushFetch(async () => { throw new Error('network down'); }));
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 0);

  // 第 2 轮全失败：达到阈值，告警一次
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /告警/);
  assert.match(kit.PUSH_CALLS[0].body.content, /拉取失败/);
  assert.equal(notifiedFlags().p, 1);

  // 第 3 轮仍失败：不重复告警
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);

  // 恢复正常：标记清零
  kit.stubFetch(kit.leaseAndPushFetch(() => kit.leaseResponse([])));
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(notifiedFlags().p, 0);
});

test('有 auto_lock 意图但签名私钥未配置 → 每进程告警一次，锁场静默跳过', async (t) => {
  resetEngine();
  kit.configureEnv({ withKey: false });
  makeIntent({ mode: 'auto_lock' });
  mockTime(t, 8, 0, { mockTimeout: true });

  kit.stubFetch(kit.leaseAndPushFetch(() => kit.leaseResponse([])));
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /告警/);
  assert.match(kit.PUSH_CALLS[0].body.content, /自动锁场未生效/);
  assert.match(kit.PUSH_CALLS[0].body.content, /GYM_SIGN_PRIVATE_KEY/);

  // 不重复提醒
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 1);

  // 全是 notify 意图时不提醒（resetEngineState 模拟进程重启后重新评估）
  prepare('DELETE FROM booking_intents').run();
  makeIntent({ mode: 'notify', windowStart: '12:00' });
  watchEngine.resetEngineState();
  kit.PUSH_CALLS.length = 0;
  await advancePastPollInterval(t);
  await watchEngine.tick();
  assert.equal(kit.PUSH_CALLS.length, 0);
});

// === burst：新放票日（今天+3）09:00 起 ===

test('09:00 前新放票日按常规节奏拉取（不 burst）', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent({ date: kit.datePlus(BOOKING_WINDOW_DAYS - 1) }); // 覆盖新放票日
  mockTime(t, 8, 0, { mockTimeout: true });

  const fetchStub = kit.leaseAndPushFetch(() => kit.emptyLease());
  kit.stubFetch(fetchStub);
  await watchEngine.tick();

  // 4 天各拉取一次，新放票日不重复拉（无 1s 连发）
  const byDate = new Map();
  for (const c of fetchStub.leaseCalls) {
    const d = new URL(c.url).searchParams.get('date');
    byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  assert.equal(byDate.size, BOOKING_WINDOW_DAYS);
  assert.ok([...byDate.values()].every(n => n === 1));
  // 基线播种，不推送
  assert.equal(kit.PUSH_CALLS.length, 0);
});

test('burst：09:00 起 1s 连拉，出数即止并触发锁场管道', async (t) => {
  resetEngine();
  kit.configureEnv({ withKey: true });
  const release = kit.datePlus(BOOKING_WINDOW_DAYS - 1);
  makeIntent({ mode: 'auto_lock', date: release, windowStart: '19:00', windowEnd: '21:00', durationHours: 2 });
  mockTime(t, 9, 0); // 只 mock Date，burst 的 1s sleep 走真实时钟（出数快，只等 2 次）

  let releaseCalls = 0;
  const fetchStub = kit.lockFlowFetch({
    leaseHandler: (url) => {
      const d = new URL(String(url)).searchParams.get('date');
      if (d !== release) return kit.emptyLease(d);
      releaseCalls += 1;
      if (releaseCalls < 3) return kit.emptyLease(d); // 9:00 整数据还没放出来
      return kit.leaseResponse([
        kit.slot(`41_${release}_19:00_20:00`, '19:00', '20:00'),
        kit.slot(`41_${release}_20:00_21:00`, '20:00', '21:00')
      ], { date: d });
    }
  });
  kit.stubFetch(fetchStub);

  await watchEngine.tick();

  // 出数即止：第 3 次拉到后不再连拉
  assert.equal(releaseCalls, 3);
  // 出数即触发（不播种基线）：自动锁场直接下单，连续两小时锁齐
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create', 'check', 'create']);
  const locked = prepare(`SELECT * FROM booking_intent_locks WHERE status = 'locked' ORDER BY start_time`).all();
  assert.deepEqual(locked.map(r => `${r.start_time}-${r.end_time}`), ['19:00-20:00', '20:00-21:00']);
  assert.ok(locked.every(r => r.date === release));
  assert.equal(kit.PUSH_CALLS.length, 1);
  assert.match(kit.PUSH_CALLS[0].body.title, /【已锁场】/);
}, { timeout: 30000 });

test('burst：连续失败达上限 → 告警一次，并入常规节奏', async (t) => {
  resetEngine();
  kit.configureEnv();
  const release = kit.datePlus(BOOKING_WINDOW_DAYS - 1);
  makeIntent({ date: release });
  mockTime(t, 9, 0, { mockTimeout: true });

  let releaseCalls = 0;
  kit.stubFetch(kit.leaseAndPushFetch((url) => {
    const d = new URL(String(url)).searchParams.get('date');
    if (d === release) releaseCalls += 1;
    return kit.emptyLease(d);
  }));

  // burst 的 sleep(1s) 走 mocked setTimeout：驱动时钟直到 tick 完成
  let done = false;
  const p = watchEngine.tick().finally(() => { done = true; });
  for (let i = 0; i < 60 && !done; i++) {
    await new Promise(r => setImmediate(r));
    t.mock.timers.tick(1500);
  }
  await p;

  assert.equal(releaseCalls, watchEngine.BURST_MAX_ATTEMPTS);
  const alert = kit.PUSH_CALLS.find(c => /9 点抢场失败/.test(c.body.content));
  assert.ok(alert, '应有 burst 失败告警');
  assert.match(alert.body.title, /告警/);
});

test('burst：无意图覆盖新放票日则不 burst', async (t) => {
  resetEngine();
  kit.configureEnv();
  makeIntent({ date: kit.datePlus(1) }); // 只覆盖明天
  mockTime(t, 9, 0, { mockTimeout: true });

  const fetchStub = kit.leaseAndPushFetch(() => kit.emptyLease());
  kit.stubFetch(fetchStub);
  await watchEngine.tick();

  const release = kit.datePlus(BOOKING_WINDOW_DAYS - 1);
  const releaseCalls = fetchStub.leaseCalls.filter(c => c.url.includes(`date=${release}`));
  assert.equal(releaseCalls.length, 1); // 只按常规节奏拉一次
});

// === 引擎级回流：锁到即停 + 回流记账（不跟踪支付） ===

test('锁到即停：整段锁齐意图自动停用；格子回流仅记账 expired，不重锁不推送；手动重开后可再抢', async () => {
  resetEngine();
  kit.configureEnv({ withKey: true });
  const date = kit.datePlus(2);
  const intent = makeIntent({ mode: 'auto_lock', date, windowStart: '19:00', windowEnd: '20:00', durationHours: 1 });
  // 引擎在有启用中的意图时才轮询；锁到即停后靠这个仅提醒意图保持轮询
  makeIntent({ mode: 'notify', date, windowStart: '09:00', windowEnd: '10:00', durationHours: 1 });
  const uniqNo = `41_${date}_19:00_20:00`;
  // 只在目标日期返回 slot（uniqNo 是全局键，不能跨日期重复出现）
  const mk = (available) => (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    return d === date ? kit.leaseResponse([kit.slot(uniqNo, '19:00', '20:00', { available })]) : kit.emptyLease(d);
  };

  // 基线：不可订
  kit.stubFetch(kit.lockFlowFetch({ leaseHandler: mk(false) }));
  await watchEngine.pollOnce();

  // 0→1：自动锁场成功 → 意图自动停用，推送注明已暂停
  const fetchStub = kit.lockFlowFetch({ leaseHandler: mk(true) });
  kit.stubFetch(fetchStub);
  await watchEngine.pollOnce();
  assert.deepEqual(fetchStub.orderCalls.map(c => c.kind), ['check', 'create']);
  const row = () => prepare('SELECT * FROM booking_intent_locks WHERE uniq_no = ?').get(uniqNo);
  assert.equal(row().status, 'locked');
  assert.equal(intentService.getIntentById(intent.id).enabled, 0);
  const lockPush = kit.PUSH_CALLS.find(c => /已锁场/.test(c.body.title));
  assert.match(lockPush.body.content, /5 分钟/);
  assert.match(lockPush.body.content, /已自动暂停/);

  // 1→0（订单释放中）→ 0→1（回流）：意图已停用 → 仅记账 expired，不重锁不推送
  kit.stubFetch(kit.lockFlowFetch({ leaseHandler: mk(false) }));
  await watchEngine.pollOnce();
  const returnFetch = kit.lockFlowFetch({ leaseHandler: mk(true) });
  kit.stubFetch(returnFetch);
  kit.PUSH_CALLS.length = 0;
  await watchEngine.pollOnce();
  assert.equal(returnFetch.orderCalls.length, 0);
  assert.equal(row().status, 'expired');
  assert.equal(kit.PUSH_CALLS.length, 0);

  // 用户没支付、手动重开意图：重开请求评估，下一轮引擎对当前在架可订直接重抢
  intentService.updateIntent(intent.id, { enabled: true });
  watchEngine.requestEvaluation(intent.id); // 与 controller 在 enabled 0→1 时的行为一致
  const relockFetch = kit.lockFlowFetch({ leaseHandler: mk(true), createBody: { code: 200, data: { areaOrderId: 'ORD-AGAIN' } } });
  kit.stubFetch(relockFetch);
  await watchEngine.pollOnce();
  assert.deepEqual(relockFetch.orderCalls.map(c => c.kind), ['check', 'create']);
  const rows = prepare('SELECT * FROM booking_intent_locks WHERE uniq_no = ? ORDER BY created_at, id').all(uniqNo);
  assert.deepEqual(rows.map(r => r.status).sort(), ['expired', 'locked']);
  // 重开后再次锁到 → 又自动停用
  assert.equal(intentService.getIntentById(intent.id).enabled, 0);
});

// === watchDigest：标题排版 ===

test('courtShort：去掉括号及内容', () => {
  assert.equal(watchDigest.courtShort('一号场(3F)'), '一号场');
  assert.equal(watchDigest.courtShort('二号场（4F）'), '二号场');
  assert.equal(watchDigest.courtShort('三号场'), '三号场');
  assert.equal(watchDigest.courtShort(''), '');
});

test('buildNotifyTitle：单 slot 带时段，多 slot 场地去重截断', () => {
  const date = kit.datePlus(2);
  const prefix = `${mdLabel(date)} ${weekdayLabel(date)}`;

  const single = watchDigest.buildNotifyTitle(date, [
    { areaName: '一号场(3F)', startTime: '19:00', endTime: '20:00' }
  ]);
  assert.equal(single, `${prefix} 一号场 19:00-20:00 可订`);

  const multi = watchDigest.buildNotifyTitle(date, [
    { areaName: '一号场(3F)', startTime: '19:00', endTime: '20:00' },
    { areaName: '二号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '一号场(3F)', startTime: '20:00', endTime: '21:00' }
  ]);
  assert.equal(multi, `${prefix} 一号场/二号场 可订`);

  const many = watchDigest.buildNotifyTitle(date, [
    { areaName: '一号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '二号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '三号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '四号场', startTime: '20:00', endTime: '21:00' },
    { areaName: '五号场', startTime: '20:00', endTime: '21:00' }
  ]);
  assert.equal(many, `${prefix} 一号场/二号场/三号场 等5片 可订`);
});

// === notifier payload 构造（引擎推送依赖，保持回归） ===

test('notifier：pushplus payload 与成功判定 code===200', async () => {
  resetEngine();
  const calls = [];
  kit.stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return kit.mockJsonResponse({ code: 200 });
  });

  const result = await watchNotifier.notify({ type: 'pushplus', token: 'tk', topic: 'grp', title: 't', content: 'c' });
  assert.equal(result.success, true);
  assert.match(calls[0].url, /pushplus\.plus\/send/);
  assert.deepEqual(calls[0].body, { token: 'tk', title: 't', content: 'c', template: 'markdown', topic: 'grp' });

  kit.stubFetch(async () => kit.mockJsonResponse({ code: 500, msg: 'bad token' }));
  const failed = await watchNotifier.notify({ type: 'pushplus', token: 'tk', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /bad token/);
});

test('notifier：wecom payload 与成功判定 errcode===0', async () => {
  resetEngine();
  const calls = [];
  kit.stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return kit.mockJsonResponse({ errcode: 0 });
  });

  const result = await watchNotifier.notify({
    type: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', title: 't', content: '**md**'
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls[0].body, { msgtype: 'markdown', markdown: { content: '**md**' } });

  kit.stubFetch(async () => kit.mockJsonResponse({ errcode: 93000, errmsg: 'invalid webhook' }));
  const failed = await watchNotifier.notify({ type: 'wecom', url: 'u', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /invalid webhook/);
});

test('notifier：serverchan payload 与成功判定 code===0；网络异常不抛出', async () => {
  resetEngine();
  const calls = [];
  kit.stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return kit.mockJsonResponse({ code: 0 });
  });

  const result = await watchNotifier.notify({ type: 'serverchan', url: 'https://sctapi.ftqq.com/KEY.send', title: '标题', content: '正文' });
  assert.equal(result.success, true);
  assert.deepEqual(calls[0].body, { title: '标题', desp: '正文' });

  kit.stubFetch(async () => { throw new Error('network down'); });
  const crashed = await watchNotifier.notify({ type: 'wecom', url: 'u', title: 't', content: 'c' });
  assert.equal(crashed.success, false);
  assert.match(crashed.error, /network down/);
});

test('notifier：wxpusher payload 与成功判定 code===1000，缺配置直接失败', async () => {
  resetEngine();
  const calls = [];
  kit.stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return kit.mockJsonResponse({ code: 1000, msg: 'ok' });
  });

  const result = await watchNotifier.notify({ type: 'wxpusher', token: 'AT_xxx', topic: '12345', title: 't', content: '**md**' });
  assert.equal(result.success, true);
  assert.match(calls[0].url, /wxpusher\.zjiecode\.com\/api\/send\/message/);
  assert.deepEqual(calls[0].body, {
    appToken: 'AT_xxx', content: '**md**', summary: 't', contentType: 3, topicIds: [12345]
  });

  kit.stubFetch(async () => kit.mockJsonResponse({ code: 1001, msg: 'appToken 无效' }));
  const failed = await watchNotifier.notify({ type: 'wxpusher', token: 'AT_xxx', topic: '12345', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /appToken 无效/);

  // 缺配置：不发请求直接失败
  const noToken = await watchNotifier.notify({ type: 'wxpusher', topic: '1', title: 't', content: 'c' });
  assert.equal(noToken.success, false);
  assert.match(noToken.error, /appToken 未配置/);
  const noTopic = await watchNotifier.notify({ type: 'wxpusher', token: 'AT_xxx', title: 't', content: 'c' });
  assert.equal(noTopic.success, false);
  assert.match(noTopic.error, /Topic ID 未配置/);
});
