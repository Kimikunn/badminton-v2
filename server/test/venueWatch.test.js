const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { api, setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-venue-watch-test-');

const venueWatchService = require('../src/services/venueWatchService');
const venueWatchPoller = require('../src/services/venueWatchPoller');
const venueWatchNotifier = require('../src/services/venueWatchNotifier');
const venueWatchDigest = require('../src/services/venueWatchDigest');

/** 与 digest 模块一致的日期标签（M/D、周X），用于拼预期文案 */
function mdLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekdayLabel(date) {
  const d = new Date(`${date}T00:00:00`);
  return `周${'日一二三四五六'[d.getDay()]}`;
}

const ADMIN = { 'x-admin-token': 'test-admin-token' };
const PUSH_CALLS = [];
const ENV_KEYS = ['GYM_TOKEN_USER', 'PUSH_TYPE', 'PUSH_TOKEN', 'PUSH_TOPIC', 'PUSH_URL', 'POLL_INTERVAL_SEC'];

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return dateStr(new Date());
}

function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

/** 放票窗口内（今天起 4 天）的未来日期：需要真实轮询 slot 的用例统一用它 */
function pollDateStr() {
  return dateStr(daysFromToday(2));
}

// --- global.fetch stub ---
let fetchHandler = null;
const realFetch = global.fetch;

function stubFetch(handler) {
  fetchHandler = handler;
}

function mockJsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function leaseResponse(slots, { areaId = 41, areaName = '1号场' } = {}) {
  return mockJsonResponse({
    code: 0,
    data: { areaDate: todayStr(), areas: [{ areaId, areaName, items: slots }] }
  });
}

function multiAreaLeaseResponse(areas) {
  return mockJsonResponse({ code: 0, data: { areaDate: todayStr(), areas } });
}

function slot(uniqNo, startTime, endTime, { available = true, price = 60, status, showStatus } = {}) {
  return {
    uniqNo,
    startTime,
    endTime,
    price,
    status: status ?? (available ? 'NORMAL' : 'NORMAL'),
    showStatus: showStatus ?? (available ? 'AVAILABLE' : 'LOCKED')
  };
}

/** 清理 DB 与 env（用例间隔离 GYM_TOKEN_USER / PUSH_* 等变量） */
function resetVenueWatch() {
  prepare('DELETE FROM venue_watch_targets').run();
  prepare('DELETE FROM venue_watch_slot_state').run();
  prepare('DELETE FROM venue_watch_notifications').run();
  prepare('DELETE FROM venue_watch_areas').run();
  prepare('DELETE FROM unavailable_days').run();
  prepare(`UPDATE venue_watch_config SET token_user = NULL, webhook_type = NULL,
    webhook_url = NULL, webhook_token = NULL, webhook_topic = NULL, poll_interval_sec = NULL,
    enabled = 1, token_invalid_notified = 0 WHERE id = 1`).run();
  for (const key of ENV_KEYS) delete process.env[key];
  PUSH_CALLS.length = 0;
  stubFetch(null);
}

/** 插入一条不可用日期（unavailable_days.player_id 有外键，先确保玩家存在） */
function insertUnavailableDay(date, { id = `ud-${date}`, playerId = 'p-excl' } = {}) {
  prepare('INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)').run(playerId, playerId);
  prepare('INSERT INTO unavailable_days (id, player_id, date) VALUES (?, ?, ?)').run(id, playerId, date);
}

/** 通过环境变量配置 poller 所需的小程序 token + 推送通道（v2） */
function configurePoller({ type = 'pushplus', token = 'wxtoken-secret-9999', pushToken = 'pp-token-abcd1234', url = null } = {}) {
  process.env.GYM_TOKEN_USER = token;
  process.env.PUSH_TYPE = type;
  if (type === 'pushplus') {
    process.env.PUSH_TOKEN = pushToken;
  } else {
    process.env.PUSH_URL = url || 'https://example.test/webhook';
  }
}

/** 标准 fetch 路由：listAreaLease 与推送端点分发 */
function leaseAndPushFetch(leaseHandler) {
  const leaseCalls = [];
  const handler = async (url, opts = {}) => {
    if (String(url).includes('listAreaLease')) {
      leaseCalls.push({ url: String(url), headers: opts.headers });
      return leaseHandler(url, opts);
    }
    // 推送端点：记录 body，默认 pushplus 成功
    PUSH_CALLS.push({ url: String(url), body: JSON.parse(opts.body) });
    return mockJsonResponse({ code: 200, msg: 'ok' });
  };
  handler.leaseCalls = leaseCalls;
  return handler;
}

test.before(async () => {
  global.fetch = async (url, opts) => {
    if (!fetchHandler) throw new Error(`unexpected fetch: ${url}`);
    return fetchHandler(url, opts);
  };
  await setupTestDb();
});

test.after(() => {
  global.fetch = realFetch;
  for (const key of ENV_KEYS) delete process.env[key];
  closeTestDb();
});

// === migration 010：新结构落库确认 ===

test('migration 010：targets 有 weekdays/area_ids 列，config 凭证列已清空', async () => {
  resetVenueWatch();
  const columns = prepare('PRAGMA table_info(venue_watch_targets)').all().map(c => c.name);
  assert.ok(columns.includes('weekdays'));
  assert.ok(columns.includes('area_ids'));

  const areaCols = prepare('PRAGMA table_info(venue_watch_areas)').all().map(c => c.name);
  assert.deepEqual(areaCols, ['area_id', 'area_name', 'updated_at']);

  const config = prepare('SELECT * FROM venue_watch_config WHERE id = 1').get();
  assert.equal(config.token_user, null);
  assert.equal(config.webhook_url, null);
  assert.equal(config.webhook_token, null);
  assert.equal(config.webhook_topic, null);
});

// === 配置：env 布尔输出，绝不回凭证 ===

test('GET /config 只返回布尔与开关，PUT 只接受 enabled', async () => {
  resetVenueWatch();

  const initial = await api.get('/api/venue-watch/config').expect(200);
  assert.equal(initial.body.success, true);
  assert.deepEqual(initial.body.data, {
    enabled: true,
    pushConfigured: false,
    gymTokenConfigured: false,
    pollIntervalSec: 120
  });

  configurePoller();
  process.env.POLL_INTERVAL_SEC = '300';
  const configured = await api.get('/api/venue-watch/config').expect(200);
  assert.equal(configured.body.data.pushConfigured, true);
  assert.equal(configured.body.data.gymTokenConfigured, true);
  assert.equal(configured.body.data.pollIntervalSec, 300);
  assert.doesNotMatch(JSON.stringify(configured.body), /wxtoken-secret-9999|pp-token-abcd1234/);

  // PUT 只认 enabled；附带凭证字段被忽略且不落库
  const put = await api.put('/api/venue-watch/config').set(ADMIN)
    .send({ enabled: false, tokenUser: 'should-be-ignored', webhookToken: 'also-ignored' }).expect(200);
  assert.equal(put.body.data.enabled, false);
  assert.equal(put.body.data.gymTokenConfigured, true); // 来自 env，不受 PUT 影响
  const row = prepare('SELECT token_user, webhook_token FROM venue_watch_config WHERE id = 1').get();
  assert.equal(row.token_user, null);
  assert.equal(row.webhook_token, null);
  assert.doesNotMatch(JSON.stringify(put.body), /should-be-ignored|also-ignored/);

  const badEnabled = await api.put('/api/venue-watch/config').set(ADMIN).send({ enabled: 'yes' }).expect(422);
  assert.match(badEnabled.body.error.message, /总开关/);

  const missing = await api.put('/api/venue-watch/config').set(ADMIN).send({}).expect(422);
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR');
});

// === 监控目标 CRUD（双模式） ===

test('targets CRUD：单日/每周双模式、二选一校验、areaIds 输出', async () => {
  resetVenueWatch();
  const date = todayStr();

  // date 与 weekdays 互斥
  const both = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, weekdays: [6, 0], startTime: '08:00', endTime: '12:00' }).expect(422);
  assert.match(both.body.error.message, /二选一/);

  const neither = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ startTime: '08:00', endTime: '12:00' }).expect(422);
  assert.match(neither.body.error.message, /监控日期.*每周重复/);

  const badWeekdays = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ weekdays: [7], startTime: '08:00', endTime: '12:00' }).expect(422);
  assert.match(badWeekdays.body.error.message, /0-6/);

  const badTime = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '10:00', endTime: '09:00' }).expect(422);
  assert.match(badTime.body.error.message, /结束时间必须晚于开始时间/);

  // 单日模式
  const single = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '08:00', endTime: '12:00', areaIds: [41, 42] }).expect(201);
  assert.match(single.body.data.id, /^vwt-/);
  assert.equal(single.body.data.date, date);
  assert.equal(single.body.data.weekdays, null);
  assert.deepEqual(single.body.data.areaIds, [41, 42]);
  assert.deepEqual(single.body.data.areaNames, []); // 尚未拉取过 availability，允许为空
  assert.equal(single.body.data.enabled, true);
  assert.equal(single.body.data.expired, false);

  // 每周模式
  const weekly = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ weekdays: [6, 0], startTime: '19:00', endTime: '21:00' }).expect(201);
  assert.equal(weekly.body.data.date, null);
  assert.deepEqual(weekly.body.data.weekdays, [6, 0]);
  assert.deepEqual(weekly.body.data.areaIds, []);
  assert.equal(weekly.body.data.expired, false);

  const list = await api.get('/api/venue-watch/targets').expect(200);
  assert.equal(list.body.data.length, 2);

  // 更新：切换为每周模式（date 被清空）
  const updated = await api.put(`/api/venue-watch/targets/${single.body.data.id}`).set(ADMIN)
    .send({ weekdays: [1], endTime: '14:00', areaIds: [] }).expect(200);
  assert.equal(updated.body.data.date, null);
  assert.deepEqual(updated.body.data.weekdays, [1]);
  assert.equal(updated.body.data.endTime, '14:00');
  assert.deepEqual(updated.body.data.areaIds, []);

  await api.put('/api/venue-watch/targets/vwt-nonexistent').set(ADMIN).send({ endTime: '15:00' }).expect(404);

  const removed = await api.delete(`/api/venue-watch/targets/${weekly.body.data.id}`).set(ADMIN).expect(200);
  assert.equal(removed.body.data, null);
  await api.delete(`/api/venue-watch/targets/${weekly.body.data.id}`).set(ADMIN).expect(404);
});

test('过期单日目标：expired=true 且 poller 跳过', async () => {
  resetVenueWatch();
  configurePoller();
  const yesterday = dateStr(daysFromToday(-1));

  // 窗口外日期已无法通过 API 创建（放票窗口校验见独立用例），直接写库模拟历史遗留目标
  venueWatchService.createTarget({ date: yesterday, weekdays: null, startTime: '08:00', endTime: '12:00', areaIds: [] });

  const list = await api.get('/api/venue-watch/targets').expect(200);
  assert.equal(list.body.data[0].expired, true);
  assert.equal(list.body.data[0].enabled, true); // 过期不改 enabled

  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')])));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'no_targets');
  assert.deepEqual(result.dates, []);
  assert.equal(PUSH_CALLS.length, 0);
});

test('单日目标日期限制在放票窗口内（今天起 4 天）', async () => {
  resetVenueWatch();
  const mk = (date) => api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '08:00', endTime: '10:00' });

  // 窗口外：昨天（已过期）与今天+4（尚未放票）都拒绝
  const yesterday = await mk(dateStr(daysFromToday(-1))).expect(422);
  assert.match(yesterday.body.error.message, /4 天/);

  const tooFar = await mk(dateStr(daysFromToday(4))).expect(422);
  assert.match(tooFar.body.error.message, /场馆只放 4 天的票/);

  // 窗口内：今天与今天+3（窗口最后一天）都接受
  const today = await mk(todayStr()).expect(201);
  assert.equal(today.body.data.date, todayStr());

  const lastDay = dateStr(daysFromToday(3));
  const last = await mk(lastDay).expect(201);
  assert.equal(last.body.data.date, lastDay);
});

// === 排除不可用日期（excludeUnavailable） ===

test('excludeUnavailable：创建缺省 true、校验 boolean、可更新', async () => {
  resetVenueWatch();
  const date = pollDateStr();

  // 不传 → 默认 true
  const created = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '08:00', endTime: '10:00' }).expect(201);
  assert.equal(created.body.data.excludeUnavailable, true);

  // 显式 false
  const off = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '10:00', endTime: '12:00', excludeUnavailable: false }).expect(201);
  assert.equal(off.body.data.excludeUnavailable, false);

  // 非 boolean → 422
  const bad = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date, startTime: '12:00', endTime: '13:00', excludeUnavailable: 'yes' }).expect(422);
  assert.match(bad.body.error.message, /排除不可用日期/);

  // PUT 更新
  const updated = await api.put(`/api/venue-watch/targets/${created.body.data.id}`).set(ADMIN)
    .send({ excludeUnavailable: false }).expect(200);
  assert.equal(updated.body.data.excludeUnavailable, false);
});

test('排除不可用日期：每周目标开启后不可用日期不参与轮询，关闭则不排除', async () => {
  resetVenueWatch();
  configurePoller();

  const d1 = daysFromToday(1);
  const d2 = daysFromToday(2);
  insertUnavailableDay(dateStr(d2)); // d2 标记为不可用

  const target = venueWatchService.createTarget({
    date: null,
    weekdays: [d1.getDay(), d2.getDay()],
    startTime: '08:00',
    endTime: '22:00',
    areaIds: [],
    excludeUnavailable: true
  });
  assert.equal(target.excludeUnavailable, true);

  const fetchStub = leaseAndPushFetch(() => leaseResponse([]));
  stubFetch(fetchStub);
  const result = await venueWatchPoller.pollOnce();
  assert.deepEqual(result.dates, [dateStr(d1)]); // d2 被排除，不拉取
  assert.ok(fetchStub.leaseCalls.every(c => !c.url.includes(`date=${dateStr(d2)}`)));

  // 关闭排除 → 两天都参与
  venueWatchService.updateTarget(target.id, { excludeUnavailable: false });
  const result2 = await venueWatchPoller.pollOnce();
  assert.deepEqual(result2.dates, [dateStr(d1), dateStr(d2)].sort());
});

test('排除不可用日期：单日目标日期被排除时展开为空、不轮询不报错', async () => {
  resetVenueWatch();
  configurePoller();

  const date = pollDateStr();
  insertUnavailableDay(date);
  venueWatchService.createTarget({
    date, weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [], excludeUnavailable: true
  });

  stubFetch(leaseAndPushFetch(() => leaseResponse([])));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'no_targets');
  assert.deepEqual(result.dates, []);
  assert.equal(PUSH_CALLS.length, 0);
});

// === env 缺失跳过 ===

test('env 缺失时跳过轮询：缺 GYM_TOKEN_USER / 缺推送配置', async () => {
  resetVenueWatch();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  // 什么都没配 → no_token
  let result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'no_token');

  // 只配 token，缺推送 → no_webhook
  process.env.GYM_TOKEN_USER = 'wxtoken-secret-9999';
  result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'no_webhook');

  // 推送类型非法 → no_webhook
  process.env.PUSH_TYPE = 'bark';
  process.env.PUSH_TOKEN = 'pp-token-abcd1234';
  result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'no_webhook');

  // 全局开关关闭 → disabled
  configurePoller();
  await api.put('/api/venue-watch/config').set(ADMIN).send({ enabled: false }).expect(200);
  result = await venueWatchPoller.pollOnce();
  assert.equal(result.skipped, 'disabled');
  assert.equal(PUSH_CALLS.length, 0);
});

// === 轮询 diff 逻辑 ===

test('首 poll 只播种基线不推送', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  const fetchStub = leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')]));
  stubFetch(fetchStub);

  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.baseline, true);
  assert.equal(result.notified, 0);
  assert.equal(PUSH_CALLS.length, 0);

  const state = prepare('SELECT * FROM venue_watch_slot_state WHERE uniq_no = ?').get('41_A_09:00_10:00');
  assert.equal(state.available, 1);

  // 请求头断言：token-user 来自 env / x-gym-client-id / content-type
  const headers = fetchStub.leaseCalls[0].headers;
  assert.equal(headers['token-user'], 'wxtoken-secret-9999');
  assert.equal(headers['x-gym-client-id'], '1');
  assert.equal(headers['content-type'], 'application/json');

  // 拉取时顺带记录场地名，供目标输出 areaNames
  const target = await api.get('/api/venue-watch/targets').expect(200);
  assert.equal(target.body.data.length, 1);
});

test('12h 内不可订的场次正常落快照不推送，释放（0→1）时照样推送', async () => {
  resetVenueWatch();
  configurePoller();

  // 服务端无 12h 过滤：12h 规则只体现在客户端 UI。距开场 +6h / +13h 的两个 slot 都应被全量跟踪。
  // 分钟截断到整点，日期/时刻全部从 Date 对象拆出，不依赖具体运行时间与时区。
  const floorHour = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d; };
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const soonAt = floorHour(Date.now() + 6 * 3600 * 1000);   // 12h 内
  const laterAt = floorHour(Date.now() + 13 * 3600 * 1000); // 12h 外
  const soonDate = dateStr(soonAt);
  const laterDate = dateStr(laterAt);

  // 每周目标覆盖两个 slot 各自的星期几（可能同一天），窗口放宽到全天
  const weekdays = [...new Set([soonAt.getDay(), laterAt.getDay()])];
  venueWatchService.createTarget({ date: null, weekdays, startTime: '00:00', endTime: '23:59', areaIds: [] });

  const soonNo = `41_${soonDate}_soon`;
  const laterNo = `41_${laterDate}_later`;
  // soonAvailable 控制 12h 内 slot；12h 外 slot 始终不可订作对照
  const respond = (url, soonAvailable) => {
    const d = new URL(url).searchParams.get('date');
    const items = [];
    if (d === soonDate) items.push(slot(soonNo, hm(soonAt), hm(new Date(soonAt.getTime() + 3600 * 1000)), { available: soonAvailable }));
    if (d === laterDate) items.push(slot(laterNo, hm(laterAt), hm(new Date(laterAt.getTime() + 3600 * 1000)), { available: false }));
    return leaseResponse(items);
  };

  // 基线：两个 slot 均不可订 → 都落快照（available=0），baseline 不推送
  stubFetch(leaseAndPushFetch((url) => respond(url, false)));
  const baseline = await venueWatchPoller.pollOnce();
  assert.equal(baseline.baseline, true);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(soonNo).available, 0);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(laterNo).available, 0);
  assert.equal(PUSH_CALLS.length, 0);

  // 12h 内 slot 变可订（支付超时释放）→ 0→1 触发推送；对照 slot 无变化不推
  stubFetch(leaseAndPushFetch((url) => respond(url, true)));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, 1);
  const notif = prepare('SELECT uniq_no FROM venue_watch_notifications').all();
  assert.deepEqual(notif.map(n => n.uniq_no), [soonNo]);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(soonNo).available, 1);
});

test('12h 内的场次全量跟踪：0→1 推送，被订走后支付超时释放（1→0→1）再推一次', async () => {
  resetVenueWatch();
  configurePoller();

  // 距开场 6h（开场前 12h 不可退订窗口内）的 slot，日期/时刻动态构造，时区无关
  const floorHour = (ms) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d; };
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startAt = floorHour(Date.now() + 6 * 3600 * 1000);
  const date = dateStr(startAt);

  venueWatchService.createTarget({ date: null, weekdays: [startAt.getDay()], startTime: '00:00', endTime: '23:59', areaIds: [] });

  const uniqNo = `41_${date}_soon`;
  const mkSlot = (available) => slot(uniqNo, hm(startAt), hm(new Date(startAt.getTime() + 3600 * 1000)), { available });

  // 基线：不可订 → 正常落快照（available=0），baseline 不推送
  stubFetch(leaseAndPushFetch(() => leaseResponse([mkSlot(false)])));
  const baseline = await venueWatchPoller.pollOnce();
  assert.equal(baseline.baseline, true);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(uniqNo).available, 0);
  assert.equal(PUSH_CALLS.length, 0);

  // 变可订（如开赛前被退订）→ 0→1 推送
  stubFetch(leaseAndPushFetch(() => leaseResponse([mkSlot(true)])));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, 1);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(uniqNo).available, 1);

  // 保持可订 → 不重复推
  await venueWatchPoller.pollOnce();
  assert.equal(PUSH_CALLS.length, 1);

  // 被订走（1→0）→ 快照落 0，不推送
  stubFetch(leaseAndPushFetch(() => leaseResponse([mkSlot(false)])));
  const booked = await venueWatchPoller.pollOnce();
  assert.equal(booked.notified, 0);
  assert.equal(prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get(uniqNo).available, 0);

  // 支付超时释放（0→1）→ 再次推送
  stubFetch(leaseAndPushFetch(() => leaseResponse([mkSlot(true)])));
  const released = await venueWatchPoller.pollOnce();
  assert.equal(released.notified, 1);
  assert.equal(PUSH_CALLS.length, 2);
  const notif = prepare('SELECT uniq_no FROM venue_watch_notifications').all();
  assert.deepEqual(notif.map(n => n.uniq_no), [uniqNo, uniqNo]);
});

test('areaNames：poll 记录场地名后目标输出名称', async () => {
  resetVenueWatch();
  configurePoller();
  const created = await api.post('/api/venue-watch/targets').set(ADMIN)
    .send({ date: todayStr(), startTime: '08:00', endTime: '22:00', areaIds: [41, 42] }).expect(201);
  assert.deepEqual(created.body.data.areaNames, []);

  stubFetch(leaseAndPushFetch(() => multiAreaLeaseResponse([
    { areaId: 41, areaName: '1号场', items: [] },
    { areaId: 42, areaName: '2号场', items: [] }
  ])));
  await venueWatchPoller.pollOnce();

  const list = await api.get('/api/venue-watch/targets').expect(200);
  assert.deepEqual(list.body.data[0].areaNames, ['1号场', '2号场']);
});

test('0→1 推送一次（合并 pushplus payload），之后不再重复推', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  const s1 = slot('41_A_09:00_10:00', '09:00', '10:00', { available: false });
  stubFetch(leaseAndPushFetch(() => leaseResponse([s1])));
  await venueWatchPoller.pollOnce(); // 基线：不可订

  // 变为可订 → 推送一次
  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00', { price: 60 })])));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, 1);
  assert.equal(PUSH_CALLS.length, 1);

  const push = PUSH_CALLS[0];
  assert.match(push.url, /pushplus\.plus\/send/);
  assert.equal(push.body.token, 'pp-token-abcd1234');
  assert.equal(push.body.template, 'markdown');
  // 单 slot 标题：M/D 周X 场地 时段 可订
  assert.equal(push.body.title, `${mdLabel(pollDateStr())} ${weekdayLabel(pollDateStr())} 1号场 09:00-10:00 可订`);
  assert.match(push.body.content, /1号场/);
  assert.match(push.body.content, /09:00-10:00/);
  assert.match(push.body.content, /¥60/);

  const notif = prepare('SELECT * FROM venue_watch_notifications').all();
  assert.equal(notif.length, 1);
  assert.equal(notif[0].success, 1);
  assert.equal(notif[0].uniq_no, '41_A_09:00_10:00');

  // 状态保持可订 → 不再推
  await venueWatchPoller.pollOnce();
  assert.equal(PUSH_CALLS.length, 1);
});

test('1→0 只更新快照不推送', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')])));
  await venueWatchPoller.pollOnce(); // 基线：可订
  await venueWatchPoller.pollOnce(); // 仍可订，不推
  assert.equal(PUSH_CALLS.length, 0);

  // 变为不可订 → 不推，快照更新为 0
  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00', { available: false })])));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, 0);
  assert.equal(PUSH_CALLS.length, 0);
  const state = prepare('SELECT available FROM venue_watch_slot_state WHERE uniq_no = ?').get('41_A_09:00_10:00');
  assert.equal(state.available, 0);
});

test('目标匹配过滤：时间窗与 areaIds 集合不命中的 slot 不推送', async () => {
  resetVenueWatch();
  configurePoller();
  // 只盯 2号场（areaId=42）08:00-10:00
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '10:00', areaIds: [42] });

  const areas = [
    { areaId: 41, areaName: '1号场', items: [slot('41_A_09:00_10:00', '09:00', '10:00', { available: false })] },
    { areaId: 42, areaName: '2号场', items: [slot('42_A_09:00_10:00', '09:00', '10:00', { available: false }), slot('42_A_11:00_12:00', '11:00', '12:00', { available: false })] }
  ];
  stubFetch(leaseAndPushFetch(() => multiAreaLeaseResponse(areas)));
  await venueWatchPoller.pollOnce(); // 基线

  const available = areas.map(a => ({
    ...a,
    items: a.items.map(i => ({ ...i, showStatus: 'AVAILABLE' }))
  }));
  stubFetch(leaseAndPushFetch(() => multiAreaLeaseResponse(available)));
  const result = await venueWatchPoller.pollOnce();

  // 只有 42_A_09:00_10:00 命中：时间窗外的 11:00 与场地集合外的 41 都不推
  assert.equal(result.notified, 1);
  const notif = prepare('SELECT uniq_no FROM venue_watch_notifications').all();
  assert.deepEqual(notif.map(n => n.uniq_no), ['42_A_09:00_10:00']);
});

test('areaIds 为空 = 任意场地', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '10:00', areaIds: [] });

  const areas = [
    { areaId: 41, areaName: '1号场', items: [slot('41_A_09:00_10:00', '09:00', '10:00', { available: false })] },
    { areaId: 42, areaName: '2号场', items: [slot('42_A_09:00_10:00', '09:00', '10:00', { available: false })] }
  ];
  stubFetch(leaseAndPushFetch(() => multiAreaLeaseResponse(areas)));
  await venueWatchPoller.pollOnce(); // 基线

  stubFetch(leaseAndPushFetch(() => multiAreaLeaseResponse(areas.map(a => ({
    ...a,
    items: a.items.map(i => ({ ...i, showStatus: 'AVAILABLE' }))
  })))));
  const result = await venueWatchPoller.pollOnce();

  assert.equal(result.notified, 1); // 同目标同日期合并一条
  const notif = prepare('SELECT uniq_no FROM venue_watch_notifications ORDER BY uniq_no').all();
  assert.deepEqual(notif.map(n => n.uniq_no), ['41_A_09:00_10:00', '42_A_09:00_10:00']);
});

test('每周模式：展开放票窗口（今天起 4 天）内匹配的日期参与轮询与推送', async () => {
  resetVenueWatch();
  configurePoller();
  // d1/d2 在 4 天放票窗口内；dOut(+4 天) 在窗口外，用于断言不展开
  const d1 = daysFromToday(2);
  const d2 = daysFromToday(3);
  const dOut = daysFromToday(4);
  venueWatchService.createTarget({
    date: null,
    weekdays: [d1.getDay(), d2.getDay(), dOut.getDay()],
    startTime: '08:00',
    endTime: '22:00',
    areaIds: []
  });

  const expectedDates = [dateStr(d1), dateStr(d2)].sort();

  // uniqNo 含日期（模拟真实接口），避免跨日期主键冲突
  const slotsFor = (url, available) => {
    const d = new URL(url).searchParams.get('date');
    return leaseResponse([slot(`41_${d}_09:00_10:00`, '09:00', '10:00', { available })]);
  };
  const fetchStub = leaseAndPushFetch((url) => slotsFor(url, false));
  stubFetch(fetchStub);
  const baselineResult = await venueWatchPoller.pollOnce();
  assert.equal(baselineResult.baseline, true);
  assert.deepEqual(baselineResult.dates, expectedDates);
  // 放票窗口外（+4 天）的 weekday 不展开
  assert.ok(!baselineResult.dates.includes(dateStr(dOut)));
  // 每个展开日期都拉取了一次
  assert.equal(fetchStub.leaseCalls.length, expectedDates.length);
  for (const date of expectedDates) {
    assert.ok(fetchStub.leaseCalls.some(c => c.url.includes(`date=${date}`)), `缺少 ${date} 的拉取`);
  }

  // 变可订 → 每个日期各推送一条
  stubFetch(leaseAndPushFetch((url) => slotsFor(url, true)));
  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, expectedDates.length);
  assert.equal(PUSH_CALLS.length, expectedDates.length);
});

test('同一 tick 同一目标同一日期的多 slot 合并为一条推送、逐 slot 落记录', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  const unavailable = [
    slot('41_A_09:00_10:00', '09:00', '10:00', { available: false }),
    slot('41_A_10:00_11:00', '10:00', '11:00', { available: false })
  ];
  stubFetch(leaseAndPushFetch(() => leaseResponse(unavailable)));
  await venueWatchPoller.pollOnce(); // 基线

  stubFetch(leaseAndPushFetch(() => leaseResponse([
    slot('41_A_09:00_10:00', '09:00', '10:00'),
    slot('41_A_10:00_11:00', '10:00', '11:00')
  ])));
  const result = await venueWatchPoller.pollOnce();

  assert.equal(result.notified, 1);
  assert.equal(PUSH_CALLS.length, 1);
  // 多 slot 同场地：标题为 M/D 周X + 场地短名
  assert.equal(PUSH_CALLS[0].body.title, `${mdLabel(pollDateStr())} ${weekdayLabel(pollDateStr())} 1号场 可订`);
  assert.match(PUSH_CALLS[0].body.content, /09:00-10:00/);
  assert.match(PUSH_CALLS[0].body.content, /10:00-11:00/);
  assert.equal(prepare('SELECT COUNT(*) AS cnt FROM venue_watch_notifications').get().cnt, 2);
});

test('推送失败写 notifications.success=0 且不抛出', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00', { available: false })])));
  await venueWatchPoller.pollOnce(); // 基线

  const fetchStub = async (url, opts = {}) => {
    if (String(url).includes('listAreaLease')) {
      return leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')]);
    }
    return mockJsonResponse({ code: 500, msg: 'token 无效' }); // pushplus 业务失败
  };
  stubFetch(fetchStub);

  const result = await venueWatchPoller.pollOnce();
  assert.equal(result.notified, 1);
  const notif = prepare('SELECT * FROM venue_watch_notifications').all();
  assert.equal(notif.length, 1);
  assert.equal(notif[0].success, 0);
  assert.match(notif[0].error, /token 无效/);
});

// === 401 告警 ===

test('401 告警一次不重复，文案指向 .env，成功轮询后清零标记', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  stubFetch(leaseAndPushFetch(() => mockJsonResponse({ code: 401, msg: 'unauthorized' })));
  await venueWatchPoller.pollOnce();
  assert.equal(PUSH_CALLS.length, 1);
  assert.match(PUSH_CALLS[0].body.title, /告警/);
  assert.match(PUSH_CALLS[0].body.content, /小程序 token 已失效.*请更新服务器 \.env 并重启/);
  assert.equal(prepare('SELECT token_invalid_notified AS f FROM venue_watch_config WHERE id = 1').get().f, 1);

  // 再次 401 → 不重复告警
  await venueWatchPoller.pollOnce();
  assert.equal(PUSH_CALLS.length, 1);

  // 恢复正常 → 标记清零，正常 diff 工作（首 poll 播种）
  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')])));
  await venueWatchPoller.pollOnce();
  assert.equal(prepare('SELECT token_invalid_notified AS f FROM venue_watch_config WHERE id = 1').get().f, 0);
});

// === GET /availability ===

test('GET /availability 透传外部数据，401 返回 422 中文错误', async () => {
  resetVenueWatch();

  const noToken = await api.get(`/api/venue-watch/availability?date=${todayStr()}`).expect(422);
  assert.match(noToken.body.error.message, /token/);

  configurePoller();

  const badDate = await api.get('/api/venue-watch/availability?date=2026/01/01').expect(422);
  assert.match(badDate.body.error.message, /YYYY-MM-DD/);

  stubFetch(leaseAndPushFetch(() => leaseResponse([slot('41_A_09:00_10:00', '09:00', '10:00')])));
  const ok = await api.get(`/api/venue-watch/availability?date=${todayStr()}`).expect(200);
  assert.equal(ok.body.data.areaDate, todayStr());
  assert.equal(ok.body.data.areas[0].areaId, 41);
  // 只读透传：不改本地快照
  assert.equal(prepare('SELECT COUNT(*) AS cnt FROM venue_watch_slot_state').get().cnt, 0);

  stubFetch(leaseAndPushFetch(() => mockJsonResponse({ code: 401 })));
  const invalid = await api.get(`/api/venue-watch/availability?date=${todayStr()}`).expect(422);
  assert.match(invalid.body.error.message, /小程序 token 已失效，请更新服务器 \.env 并重启/);
});

// === POST /poll-now ===

test('POST /poll-now 手动触发返回 dates 与 notified', async () => {
  resetVenueWatch();
  configurePoller();
  venueWatchService.createTarget({ date: pollDateStr(), weekdays: null, startTime: '08:00', endTime: '22:00', areaIds: [] });

  stubFetch(leaseAndPushFetch(() => leaseResponse([])));
  const res = await api.post('/api/venue-watch/poll-now').set(ADMIN).expect(200);
  assert.deepEqual(res.body.data.dates, [pollDateStr()]);
  assert.equal(res.body.data.notified, 0);
});

// === 推送历史分页 ===

test('GET /notifications 倒序分页', async () => {
  resetVenueWatch();
  for (let i = 0; i < 3; i++) {
    venueWatchService.recordNotification({
      uniqNo: `41_A_0${i}:00_0${i + 1}:00`,
      areaName: '1号场',
      date: todayStr(),
      startTime: `0${i}:00`,
      endTime: `0${i + 1}:00`,
      price: 60,
      success: true
    });
  }

  const page1 = await api.get('/api/venue-watch/notifications?pageNo=1&pageSize=2').expect(200);
  assert.equal(page1.body.data.total, 3);
  assert.equal(page1.body.data.pageNo, 1);
  assert.equal(page1.body.data.pageSize, 2);
  assert.equal(page1.body.data.list.length, 2);

  const page2 = await api.get('/api/venue-watch/notifications?pageNo=2&pageSize=2').expect(200);
  assert.equal(page2.body.data.list.length, 1);
});

// === notifier payload 构造 ===

test('notifier：pushplus payload 与成功判定 code===200', async () => {
  const calls = [];
  stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return mockJsonResponse({ code: 200 });
  });

  const result = await venueWatchNotifier.notify({
    type: 'pushplus', token: 'tk', topic: 'grp', title: 't', content: 'c'
  });
  assert.equal(result.success, true);
  assert.match(calls[0].url, /pushplus\.plus\/send/);
  assert.deepEqual(calls[0].body, { token: 'tk', title: 't', content: 'c', template: 'markdown', topic: 'grp' });

  stubFetch(async () => mockJsonResponse({ code: 500, msg: 'bad token' }));
  const failed = await venueWatchNotifier.notify({ type: 'pushplus', token: 'tk', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /bad token/);
});

test('notifier：wecom payload 与成功判定 errcode===0', async () => {
  const calls = [];
  stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return mockJsonResponse({ errcode: 0 });
  });

  const result = await venueWatchNotifier.notify({
    type: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', title: 't', content: '**md**'
  });
  assert.equal(result.success, true);
  assert.equal(calls[0].url, 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k');
  assert.deepEqual(calls[0].body, { msgtype: 'markdown', markdown: { content: '**md**' } });

  stubFetch(async () => mockJsonResponse({ errcode: 93000, errmsg: 'invalid webhook' }));
  const failed = await venueWatchNotifier.notify({ type: 'wecom', url: 'u', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /invalid webhook/);
});

test('notifier：serverchan payload 与成功判定 code===0', async () => {
  const calls = [];
  stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return mockJsonResponse({ code: 0 });
  });

  const result = await venueWatchNotifier.notify({
    type: 'serverchan', url: 'https://sctapi.ftqq.com/KEY.send', title: '标题', content: '正文'
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls[0].body, { title: '标题', desp: '正文' });

  stubFetch(async () => mockJsonResponse({ code: 40001, message: 'bad key' }));
  const failed = await venueWatchNotifier.notify({ type: 'serverchan', url: 'u', title: 't', content: 'c' });
  assert.equal(failed.success, false);

  stubFetch(async () => { throw new Error('network down'); });
  const crashed = await venueWatchNotifier.notify({ type: 'wecom', url: 'u', title: 't', content: 'c' });
  assert.equal(crashed.success, false);
  assert.match(crashed.error, /network down/);
});

test('notifier：wxpusher payload 与成功判定 code===1000', async () => {
  const calls = [];
  stubFetch(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return mockJsonResponse({ code: 1000, msg: 'ok' });
  });

  const result = await venueWatchNotifier.notify({
    type: 'wxpusher', token: 'AT_xxx', topic: '12345', title: 't', content: '**md**'
  });
  assert.equal(result.success, true);
  assert.match(calls[0].url, /wxpusher\.zjiecode\.com\/api\/send\/message/);
  assert.deepEqual(calls[0].body, {
    appToken: 'AT_xxx', content: '**md**', summary: 't', contentType: 3, topicIds: [12345]
  });

  stubFetch(async () => mockJsonResponse({ code: 1001, msg: 'appToken 无效' }));
  const failed = await venueWatchNotifier.notify({ type: 'wxpusher', token: 'AT_xxx', topic: '12345', title: 't', content: 'c' });
  assert.equal(failed.success, false);
  assert.match(failed.error, /appToken 无效/);

  // 缺配置：不发请求直接失败
  const noToken = await venueWatchNotifier.notify({ type: 'wxpusher', topic: '1', title: 't', content: 'c' });
  assert.equal(noToken.success, false);
  assert.match(noToken.error, /appToken 未配置/);
  const noTopic = await venueWatchNotifier.notify({ type: 'wxpusher', token: 'AT_xxx', title: 't', content: 'c' });
  assert.equal(noTopic.success, false);
  assert.match(noTopic.error, /Topic ID 未配置/);
});


// === digest：场地名精简与提醒标题 ===

test('courtShort：去掉括号及内容', () => {
  assert.equal(venueWatchDigest.courtShort('一号场(3F)'), '一号场');
  assert.equal(venueWatchDigest.courtShort('二号场（4F）'), '二号场');
  assert.equal(venueWatchDigest.courtShort('三号场'), '三号场');
  assert.equal(venueWatchDigest.courtShort(''), '');
});

test('buildNotifyTitle：单 slot 带时段，多 slot 场地去重截断', () => {
  const date = pollDateStr();
  const prefix = `${mdLabel(date)} ${weekdayLabel(date)}`;

  // 单 slot：M/D 周X 场地 时段 可订
  const single = venueWatchDigest.buildNotifyTitle(date, [
    { areaName: '一号场(3F)', startTime: '19:00', endTime: '20:00' }
  ]);
  assert.equal(single, `${prefix} 一号场 19:00-20:00 可订`);

  // 多 slot 两片场地：短名去重后 "/" 连接
  const multi = venueWatchDigest.buildNotifyTitle(date, [
    { areaName: '一号场(3F)', startTime: '19:00', endTime: '20:00' },
    { areaName: '二号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '一号场(3F)', startTime: '20:00', endTime: '21:00' }
  ]);
  assert.equal(multi, `${prefix} 一号场/二号场 可订`);

  // 超过 3 片：前 3 个 + 等N片
  const many = venueWatchDigest.buildNotifyTitle(date, [
    { areaName: '一号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '二号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '三号场', startTime: '19:00', endTime: '20:00' },
    { areaName: '四号场', startTime: '20:00', endTime: '21:00' },
    { areaName: '五号场', startTime: '20:00', endTime: '21:00' }
  ]);
  assert.equal(many, `${prefix} 一号场/二号场/三号场 等5片 可订`);
});

// === digest：buildDigest 排版 ===

const COURT_NAMES = ['一号场', '二号场', '三号场', '四号场', '五号场', '六号场', '七号场',
  '八号场', '九号场', '十号场', '十一号场', '十二号场', '十三号场', '十四号场'];

/** 构造某天 14 片场地的响应；availableFilter(areaIndex, timeKey) 决定该格子是否可订 */
function fullDayAreas(timeKey, availableFilter) {
  const [startTime, endTime] = timeKey.split('-');
  return COURT_NAMES.map((name, i) => ({
    areaId: 41 + i,
    areaName: `${name}(3F)`,
    items: [{
      uniqNo: `${41 + i}_${timeKey}`,
      startTime,
      endTime,
      price: 60,
      status: 'NORMAL',
      showStatus: availableFilter(i) ? 'AVAILABLE' : 'LOCKED'
    }]
  }));
}

/** 按日期分发 4 天 digest 数据：dayFixtures[i] 为今天起第 i 天的 areas（null = 无可订） */
function digestFetch(dayFixtures) {
  return async (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    const idx = Math.round((new Date(`${d}T00:00:00`) - new Date(`${todayStr()}T00:00:00`)) / 86400000);
    const areas = dayFixtures[idx] || [];
    return mockJsonResponse({ code: 0, data: { areaDate: d, areas } });
  };
}

test('buildDigest：全部可订 / 部分可订（等N片截断）/ 少量场地 / 暂无可订', async () => {
  resetVenueWatch();
  stubFetch(digestFetch([
    fullDayAreas('09:00-10:00', () => true),                     // 今天：14 片全可订
    fullDayAreas('11:00-12:00', (i) => i < 12),                  // +1：12 片可订 → 等12片
    fullDayAreas('19:00-20:00', (i) => i < 2),                   // +2：2 片可订 → 全列
    fullDayAreas('08:00-09:00', () => false)                     // +3：无可订
  ]));

  const digest = await venueWatchDigest.buildDigest({ tokenUser: 'x' });
  assert.ok(!digest.error);

  const days = [0, 1, 2, 3].map(i => dateStr(daysFromToday(i)));
  const header = (d) => `**${mdLabel(d)} ${weekdayLabel(d)}**`;

  const sections = digest.content.split('\n\n');
  assert.equal(sections.length, 4);
  assert.equal(sections[0], `${header(days[0])}\n09:00-10:00 全部14片可订`);
  assert.equal(sections[1], `${header(days[1])}\n11:00-12:00 一号场/二号场/三号场 等12片`);
  assert.equal(sections[2], `${header(days[2])}\n19:00-20:00 一号场/二号场`);
  assert.equal(sections[3], `${header(days[3])}\n暂无可订`);

  // 标题：有可订的日期汇总（不含"暂无可订"的 +3 天）
  const expectedTitle = `场次汇总： ${[0, 1, 2].map(i => `${weekdayLabel(days[i])}${mdLabel(days[i])}`).join('、')} 有可订`;
  assert.equal(digest.title, expectedTitle);
});

test('buildDigest：近 4 天全部无可订时的标题与正文', async () => {
  resetVenueWatch();
  stubFetch(digestFetch([null, null, null, null]));

  const digest = await venueWatchDigest.buildDigest({ tokenUser: 'x' });
  assert.equal(digest.title, '近4天暂无可订场次');
  assert.equal(digest.content.split('\n\n').length, 4);
  assert.equal((digest.content.match(/暂无可订/g) || []).length, 4);
});

test('buildDigest：401 与上游异常返回 error 标记', async () => {
  resetVenueWatch();
  stubFetch(async () => mockJsonResponse({ code: 401, msg: 'unauthorized' }));
  const invalid = await venueWatchDigest.buildDigest({ tokenUser: 'x' });
  assert.equal(invalid.error, 'token_invalid');

  stubFetch(async () => { throw new Error('network down'); });
  const upstream = await venueWatchDigest.buildDigest({ tokenUser: 'x' });
  assert.equal(upstream.error, 'upstream');
});

// === digest API ===

test('GET /digest：缺 token 422，成功返回排版，上游 401 返回 422', async () => {
  resetVenueWatch();

  const noToken = await api.get('/api/venue-watch/digest').expect(422);
  assert.match(noToken.body.error.message, /token/);

  configurePoller();
  stubFetch(digestFetch([fullDayAreas('09:00-10:00', () => true)]));
  const ok = await api.get('/api/venue-watch/digest').expect(200);
  assert.equal(ok.body.success, true);
  assert.match(ok.body.data.title, /^场次汇总： /);
  assert.match(ok.body.data.content, /全部14片可订/);

  stubFetch(async () => mockJsonResponse({ code: 401 }));
  const invalid = await api.get('/api/venue-watch/digest').expect(422);
  assert.match(invalid.body.error.message, /小程序 token 已失效/);
});

test('POST /digest/send：成功推送返回 success=true，推送失败返回 success=false 不抛出', async () => {
  resetVenueWatch();

  // 未配置推送通道 → 422
  process.env.GYM_TOKEN_USER = 'wxtoken-secret-9999';
  stubFetch(digestFetch([fullDayAreas('09:00-10:00', () => true)]));
  const noPush = await api.post('/api/venue-watch/digest/send').set(ADMIN).expect(422);
  assert.match(noPush.body.error.message, /推送通道/);

  // 成功：pushplus 收到 digest 标题与正文
  configurePoller();
  stubFetch(leaseAndPushFetch(async (url) => {
    const d = new URL(String(url)).searchParams.get('date');
    const today = todayStr();
    return mockJsonResponse({
      code: 0,
      data: { areaDate: d, areas: d === today ? fullDayAreas('09:00-10:00', () => true) : [] }
    });
  }));
  const sent = await api.post('/api/venue-watch/digest/send').set(ADMIN).expect(200);
  assert.equal(sent.body.data.success, true);
  assert.match(sent.body.data.title, /有可订/);
  assert.equal(sent.body.data.error, undefined);
  assert.equal(PUSH_CALLS.length, 1);
  assert.equal(PUSH_CALLS[0].body.title, sent.body.data.title);
  assert.match(PUSH_CALLS[0].body.content, /全部14片可订/);

  // 推送通道业务失败 → success=false + error，不抛出
  PUSH_CALLS.length = 0;
  stubFetch(async (url, opts = {}) => {
    if (String(url).includes('listAreaLease')) {
      const d = new URL(String(url)).searchParams.get('date');
      return mockJsonResponse({ code: 0, data: { areaDate: d, areas: d === todayStr() ? fullDayAreas('09:00-10:00', () => true) : [] } });
    }
    return mockJsonResponse({ code: 500, msg: 'token 无效' });
  });
  const failed = await api.post('/api/venue-watch/digest/send').set(ADMIN).expect(200);
  assert.equal(failed.body.data.success, false);
  assert.match(failed.body.data.error, /token 无效/);
});
