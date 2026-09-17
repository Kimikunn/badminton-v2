const test = require('node:test');
const assert = require('node:assert/strict');
process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');
const { setupTestDb, closeTestDb, prepare } = createTestHarness('badminton-intent-service-test-');

const intentService = require('../src/services/intentService');
const { BOOKING_WINDOW_DAYS, today } = require('../src/services/venueShared');
const { datePlus, clearEnv } = require('./helpers/watchTestKit');

function resetIntents() {
  prepare('DELETE FROM booking_intents').run();
  prepare('DELETE FROM booking_intent_locks').run();
  prepare('DELETE FROM watch_notifications').run();
  prepare('DELETE FROM watch_areas').run();
  prepare('DELETE FROM watch_slot_state').run();
  prepare('DELETE FROM unavailable_days').run();
  prepare(`UPDATE watch_config SET enabled = 1, token_invalid_notified = 0, poll_failure_notified = 0, area_priority = NULL WHERE id = 1`).run();
  clearEnv();
}

/** 插入一条不可用日期（unavailable_days.player_id 有外键，先确保玩家存在） */
function insertUnavailableDay(date, { id = `ud-${date}`, playerId = 'p-excl' } = {}) {
  prepare('INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)').run(playerId, playerId);
  prepare('INSERT INTO unavailable_days (id, player_id, date) VALUES (?, ?, ?)').run(id, playerId, date);
}

function makeIntent(overrides = {}) {
  return intentService.createIntent({
    mode: 'notify',
    date: datePlus(1),
    weekdays: null,
    windowStart: '17:00',
    windowEnd: '20:00',
    durationHours: 2,
    courtsNeeded: 1,
    preferredAreaIds: [],
    ...overrides
  });
}

test.before(async () => { await setupTestDb(); });
test.after(() => { clearEnv(); closeTestDb(); });

// === 环境变量配置 ===

test('getEnvConfig：实时读 env，pollIntervalSec 下限 60、缺省 120', () => {
  resetIntents();
  let env = intentService.getEnvConfig();
  assert.equal(env.pollIntervalSec, 120);
  assert.equal(env.gymTokenConfigured, false);
  assert.equal(env.pushConfigured, false);

  process.env.GYM_TOKEN_USER = 'tok';
  process.env.PUSH_TYPE = 'pushplus';
  process.env.PUSH_TOKEN = 'pp';
  process.env.POLL_INTERVAL_SEC = '30';
  env = intentService.getEnvConfig();
  assert.equal(env.pollIntervalSec, 60);
  assert.equal(env.gymTokenConfigured, true);
  assert.equal(env.pushConfigured, true);

  // wxpusher 需要 token + topic 才算已配置
  process.env.PUSH_TYPE = 'wxpusher';
  delete process.env.POLL_INTERVAL_SEC;
  assert.equal(intentService.getEnvConfig().pushConfigured, false);
  process.env.PUSH_TOPIC = '12345';
  assert.equal(intentService.getEnvConfig().pushConfigured, true);

  // 非法类型 → 未配置
  process.env.PUSH_TYPE = 'bark';
  assert.equal(intentService.getEnvConfig().pushConfigured, false);
});

test('getEnvConfig：runtime/gym-token 文件优先于 GYM_TOKEN_USER env', () => {
  resetIntents();
  const fs = require('fs');
  const path = require('path');
  // 在 harness 给的隔离目录里再开独立子目录，结束恢复 harness 值
  const prevDir = process.env.GYM_RUNTIME_DIR;
  process.env.GYM_RUNTIME_DIR = path.join(prevDir, 'token-priority');
  fs.mkdirSync(process.env.GYM_RUNTIME_DIR, { recursive: true });
  const tokenFile = path.join(process.env.GYM_RUNTIME_DIR, 'gym-token');

  process.env.GYM_TOKEN_USER = 'env-token';
  assert.equal(intentService.getEnvConfig().tokenUser, 'env-token');

  // 写入运行时文件 → 优先于 env（token 捕获代理的热更新通道）
  fs.writeFileSync(tokenFile, 'file-token\n');
  assert.equal(intentService.getEnvConfig().tokenUser, 'file-token');

  // 删除文件 → 回退 env
  fs.rmSync(tokenFile);
  assert.equal(intentService.getEnvConfig().tokenUser, 'env-token');

  process.env.GYM_RUNTIME_DIR = prevDir;
});

// === 配置读写 ===

test('updateConfig：只接受 enabled/areaPriority，areaPriorityNames 从 watch_areas 解析', () => {
  resetIntents();
  intentService.recordAreaNames([{ areaId: 41, areaName: '1号场' }, { areaId: 42, areaName: '2号场' }]);

  const updated = intentService.updateConfig({ enabled: false, areaPriority: [42, 41] });
  assert.equal(updated.enabled, false);
  assert.deepEqual(updated.areaPriority, [42, 41]);
  assert.deepEqual(updated.areaPriorityNames, ['2号场', '1号场']);

  const flags = intentService.getFlags();
  assert.equal(flags.enabled, false);
  assert.equal(flags.tokenInvalidNotified, false);
  assert.deepEqual(intentService.getAreaPriority(), [42, 41]);

  // 告警去重标记
  intentService.setTokenInvalidNotified(true);
  intentService.setPollFailureNotified(true);
  const flags2 = intentService.getFlags();
  assert.equal(flags2.tokenInvalidNotified, true);
  assert.equal(flags2.pollFailureNotified, true);
});

test('listAreas：按 areaId 升序输出，recordAreaNames 幂等更新', () => {
  resetIntents();
  assert.deepEqual(intentService.listAreas(), []);

  intentService.recordAreaNames([{ areaId: 42, areaName: '2号场' }, { areaId: 41, areaName: '旧名' }]);
  intentService.recordAreaNames([{ areaId: 41, areaName: '1号场' }]);
  assert.deepEqual(intentService.listAreas(), [
    { areaId: 41, areaName: '1号场' },
    { areaId: 42, areaName: '2号场' }
  ]);
});

// === 意图 CRUD（服务层） ===

test('createIntent：缺省 mode=auto_lock、courtsNeeded=1、enabled=true，单次/每周分列存储', () => {
  resetIntents();
  const single = intentService.createIntent({
    date: datePlus(1), weekdays: null, windowStart: '17:00', windowEnd: '20:00', durationHours: 2
  });
  assert.match(single.id, /^int-/);
  assert.equal(single.mode, 'auto_lock');
  assert.equal(single.courtsNeeded, 1);
  assert.equal(single.enabled, true);
  assert.equal(single.date, datePlus(1));
  assert.equal(single.weekdays, null);

  const weekly = intentService.createIntent({
    date: null, weekdays: [6, 0], windowStart: '19:00', windowEnd: '21:00', durationHours: 1,
    courtsNeeded: 2, preferredAreaIds: [41], enabled: false, mode: 'notify'
  });
  assert.equal(weekly.date, null);
  assert.deepEqual(weekly.weekdays, [6, 0]);
  assert.equal(weekly.enabled, false);

  const row = intentService.getIntentById(weekly.id);
  assert.equal(row.date, null);
  assert.equal(row.weekdays, '[6,0]');
});

test('updateIntent：date/weekdays 传其一即切换模式，另一列清空', () => {
  resetIntents();
  const created = makeIntent();

  const toWeekly = intentService.updateIntent(created.id, { weekdays: [1, 2] });
  assert.equal(toWeekly.date, null);
  assert.deepEqual(toWeekly.weekdays, [1, 2]);

  const backToSingle = intentService.updateIntent(created.id, { date: datePlus(2) });
  assert.equal(backToSingle.date, datePlus(2));
  assert.equal(backToSingle.weekdays, null);

  // 普通字段补丁不影响模式列
  const patched = intentService.updateIntent(created.id, { windowEnd: '22:00', courtsNeeded: 3 });
  assert.equal(patched.windowEnd, '22:00');
  assert.equal(patched.courtsNeeded, 3);
  assert.equal(patched.date, datePlus(2));

  intentService.deleteIntent(created.id);
  assert.equal(intentService.getIntentById(created.id), null);
});

// === 日期展开与可订窗口 ===

test('isDateBookable：今天 ~ 今天+3 可订，昨天与今天+4 不可订', () => {
  assert.equal(intentService.isDateBookable(today()), true);
  assert.equal(intentService.isDateBookable(datePlus(BOOKING_WINDOW_DAYS - 1)), true);
  assert.equal(intentService.isDateBookable(datePlus(BOOKING_WINDOW_DAYS)), false);
  assert.equal(intentService.isDateBookable(datePlus(-1)), false);
});

test('expandIntentDates：单次过期展开为空、未过期展开为自身', () => {
  resetIntents();
  const expired = makeIntent({ date: datePlus(-1) });
  assert.equal(intentService.isIntentExpired(intentService.getIntentById(expired.id)), true);
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(expired.id)), []);

  const future = makeIntent({ date: datePlus(2) });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(future.id)), [datePlus(2)]);
});

test('expandIntentDates：每周模式展开 4 天窗口内匹配的星期，窗口外不展开', () => {
  resetIntents();
  // d1/d2 在 4 天放票窗口内；dOut(+4) 在窗口外，用于断言不展开
  const { daysFromToday } = require('./helpers/watchTestKit');
  const d1 = daysFromToday(1);
  const d2 = daysFromToday(3);
  const dOut = daysFromToday(BOOKING_WINDOW_DAYS);
  const weekly = makeIntent({ date: null, weekdays: [d1.getDay(), d2.getDay(), dOut.getDay()] });

  const dates = intentService.expandIntentDates(intentService.getIntentById(weekly.id));
  const expected = [datePlus(1), datePlus(3)].filter((_, i) => [d1, d2][i]);
  assert.deepEqual(dates.sort(), expected.sort());
  assert.ok(!dates.includes(datePlus(BOOKING_WINDOW_DAYS)));

  // 每周模式永不过期
  assert.equal(intentService.isIntentExpired(intentService.getIntentById(weekly.id)), false);
});

test('expandIntentDates：unavailable_days 标记的日期一律排除', () => {
  resetIntents();
  const date = datePlus(1);
  insertUnavailableDay(date);

  const single = makeIntent({ date });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(single.id)), []);

  const { daysFromToday } = require('./helpers/watchTestKit');
  const weekly = makeIntent({ date: null, weekdays: [daysFromToday(1).getDay(), daysFromToday(2).getDay()] });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(weekly.id)), [datePlus(2)]);
});

// === 意图过期标记 ===

test('formatIntent：单次日期过期标记（无实时状态字段——锁场状态以锁场记录为准）', () => {
  resetIntents();
  const active = makeIntent({ date: today() });
  const formattedActive = intentService.formatIntent(intentService.getIntentById(active.id));
  assert.equal(formattedActive.expired, false);
  assert.equal('status' in formattedActive, false);

  const expired = makeIntent({ date: datePlus(-1) });
  const formatted = intentService.formatIntent(intentService.getIntentById(expired.id));
  assert.equal(formatted.expired, true);
});

// === 推送记录 ===

test('recordNotification/listNotifications：intentId 过滤 + 倒序分页', () => {
  resetIntents();
  const a = makeIntent({ date: today() });
  const b = makeIntent({ date: today(), windowStart: '20:00', windowEnd: '22:00' });

  for (let i = 0; i < 3; i++) {
    intentService.recordNotification({
      intentId: a.id, uniqNo: `u-a-${i}`, areaName: '1号场', date: today(),
      startTime: `0${i}:00`, endTime: `0${i + 1}:00`, price: 60, success: true
    });
  }
  intentService.recordNotification({
    intentId: b.id, uniqNo: 'u-b-0', areaName: '2号场', date: today(),
    startTime: '20:00', endTime: '21:00', success: false, error: '推送失败：x'
  });

  const all = intentService.listNotifications({ pageNo: 1, pageSize: 3 });
  assert.equal(all.total, 4);
  assert.equal(all.list.length, 3);

  const filtered = intentService.listNotifications({ intentId: b.id });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.list[0].uniqNo, 'u-b-0');
  assert.equal(filtered.list[0].success, false);
  assert.equal(filtered.list[0].error, '推送失败：x');

  // 旧数据兼容：intent_id 允许 NULL
  intentService.recordNotification({ uniqNo: 'u-legacy', date: today(), startTime: '08:00', endTime: '09:00', success: true });
  const legacy = intentService.listNotifications({}).list.find(n => n.uniqNo === 'u-legacy');
  assert.equal(legacy.intentId, null);
});
