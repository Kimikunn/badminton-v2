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
    windowStart: '17:00',
    windowEnd: '20:00',
    durationHours: 2,
    courtsNeeded: 1,
    preferredAreaIds: [],
    ...overrides
  });
}

// === 状态派生（纯函数，逐状态 + 优先级边界） ===

test.before(async () => { await setupTestDb(); });
test.after(() => { clearEnv(); closeTestDb(); });

/** 手工构造 booking_intents 行 */
function intentRow(overrides = {}) {
  return {
    id: 'int-test',
    mode: 'auto_lock',
    date: today(),
    window_start: '17:00',
    window_end: '20:00',
    duration_hours: 1,
    courts_needed: 1,
    preferred_area_ids: '[]',
    enabled: 1,
    ...overrides
  };
}

/** 手工构造 ctx（now 用本地时间串构造，保证 getHours() 可预期） */
function statusCtx(overrides = {}) {
  const todayStr = overrides.today || today();
  return {
    today: todayStr,
    now: new Date(`${todayStr}T${overrides.at || '08:00'}:00`),
    windowEnd: datePlus(BOOKING_WINDOW_DAYS - 1),
    riskRetryKeys: new Set(),
    isFulfilled: false,
    ...overrides
  };
}

test('deriveIntentStatus：7 种状态逐条判定', () => {
  const base = statusCtx();
  // 1 过期
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(-1) }), base), 'expired');
  // 2 风控验证中
  assert.equal(intentService.deriveIntentStatus(intentRow({ id: 'int-rc' }), statusCtx({
    riskRetryKeys: new Set([`int-rc|${today()}`])
  })), 'awaiting_verify');
  // 3 已锁到（整段满足）
  assert.equal(intentService.deriveIntentStatus(intentRow(), statusCtx({ isFulfilled: true })), 'fulfilled');
  // 4 待放票：窗口最后一天且 09:00 前
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(3) }), base), 'pending_release');
  // 5 等待放票：窗口之外
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(BOOKING_WINDOW_DAYS) }), base), 'waiting');
  // 6 监控中：窗口内（今天与窗口最后一天都算）
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: today() }), base), 'watching');
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(3) }), statusCtx({ at: '09:00' })), 'watching');
  // 7 已暂停：窗口内但停用
  assert.equal(intentService.deriveIntentStatus(intentRow({ enabled: 0 }), base), 'paused');
});

test('deriveIntentStatus：优先级边界（顺序即契约）', () => {
  // 过期压过风控重试（重试键存在也不改变）
  assert.equal(intentService.deriveIntentStatus(intentRow({ id: 'int-x', date: datePlus(-1) }), statusCtx({
    riskRetryKeys: new Set([`int-x|${datePlus(-1)}`])
  })), 'expired');

  // 风控重试压过 fulfilled / watching / paused
  const retryKeys = new Set(['int-x|' + today()]);
  assert.equal(intentService.deriveIntentStatus(intentRow({ id: 'int-x' }), statusCtx({ riskRetryKeys: retryKeys, isFulfilled: true })), 'awaiting_verify');
  assert.equal(intentService.deriveIntentStatus(intentRow({ id: 'int-x', enabled: 0 }), statusCtx({ riskRetryKeys: retryKeys })), 'awaiting_verify');

  // fulfilled 压过 paused 与 waiting（锁到即停后 enabled=0 仍显示已锁到）
  assert.equal(intentService.deriveIntentStatus(intentRow({ enabled: 0 }), statusCtx({ isFulfilled: true })), 'fulfilled');
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(5) }), statusCtx({ isFulfilled: true })), 'fulfilled');

  // 开关关闭的监控一律落 paused，不做"等待放票"——未武装的监控没有即将发生的动作
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(3), enabled: 0 }), statusCtx()), 'paused');

  // 08:59 是待放票、09:00 起按 enabled 落到监控中 / 已暂停
  const lastDay = intentRow({ date: datePlus(3) });
  assert.equal(intentService.deriveIntentStatus(lastDay, statusCtx({ at: '08:59' })), 'pending_release');
  assert.equal(intentService.deriveIntentStatus(lastDay, statusCtx({ at: '09:00' })), 'watching');
  assert.equal(intentService.deriveIntentStatus({ ...lastDay, enabled: 0 }, statusCtx({ at: '09:00' })), 'paused');

  // waiting 只在窗口之外：窗口最后一天 +1 天起
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(4) }), statusCtx({ at: '08:00' })), 'waiting');
  assert.equal(intentService.deriveIntentStatus(intentRow({ date: datePlus(4) }), statusCtx({ at: '09:00' })), 'waiting');
});

test('formatIntent：status 与 verifyDeadline / lastAttempt / expired 兼容位', () => {
  resetIntents();
  const active = makeIntent({ date: today() });
  const row = intentService.getIntentById(active.id);

  const watching = intentService.formatIntent(row);
  assert.equal(watching.status, 'watching');
  assert.equal(watching.verifyDeadline, null);
  assert.equal(watching.lastAttempt, null);
  assert.equal(watching.expired, false);
  assert.equal('weekdays' in watching, false);

  // 引擎注入风控事实 → awaiting_verify + 截止时间
  const key = `${active.id}|${today()}`;
  const retrying = intentService.formatIntent(row, {
    riskRetryKeys: new Set([key]),
    verifyDeadline: '2026-09-17T01:04:00.000Z',
    lastAttempt: { status: 'failed', errorCode: 'RISK_CONTROL', error: '触发风控', createdAt: '2026-09-17 01:00:00', attempts: 2 }
  });
  assert.equal(retrying.status, 'awaiting_verify');
  assert.equal(retrying.verifyDeadline, '2026-09-17T01:04:00.000Z');
  assert.equal(retrying.lastAttempt.errorCode, 'RISK_CONTROL');
  assert.equal(retrying.lastAttempt.attempts, 2);

  // 非 awaiting_verify 时 verifyDeadline 归零（只透传 lastAttempt）
  const fulfilled = intentService.formatIntent(row, { isFulfilled: true, verifyDeadline: '2026-09-17T01:04:00.000Z' });
  assert.equal(fulfilled.status, 'fulfilled');
  assert.equal(fulfilled.verifyDeadline, null);

  // 过期：expired 兼容位与 status 同步
  const expired = makeIntent({ date: datePlus(-1) });
  const formatted = intentService.formatIntent(intentService.getIntentById(expired.id));
  assert.equal(formatted.status, 'expired');
  assert.equal(formatted.expired, true);
});

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

// === 意图 CRUD（服务层，单模型） ===

test('createIntent：缺省 mode=auto_lock、courtsNeeded=1、enabled=true，date 必填单列存储', () => {
  resetIntents();
  const created = intentService.createIntent({
    date: datePlus(1), windowStart: '17:00', windowEnd: '20:00', durationHours: 2
  });
  assert.match(created.id, /^int-/);
  assert.equal(created.mode, 'auto_lock');
  assert.equal(created.courtsNeeded, 1);
  assert.equal(created.enabled, true);
  assert.equal(created.date, datePlus(1));

  const second = intentService.createIntent({
    date: datePlus(1), windowStart: '19:00', windowEnd: '21:00', durationHours: 1,
    courtsNeeded: 2, preferredAreaIds: [41], enabled: false, mode: 'notify'
  });
  assert.equal(second.date, datePlus(1));
  assert.equal(second.enabled, false);
  assert.equal(second.mode, 'notify');

  // 一天可多条：同一日期两行并存，weekdays 列已不存在（彻底单模型）
  const rows = prepare('SELECT * FROM booking_intents WHERE date = ?').all(datePlus(1));
  assert.equal(rows.length, 2);
  const columns = prepare('PRAGMA table_info(booking_intents)').all().map(c => c.name);
  assert.ok(!columns.includes('weekdays'), 'weekdays 列应已删除');
});

test('updateIntent：date 与普通字段补丁；deleteIntent 删除', () => {
  resetIntents();
  const created = makeIntent();

  const moved = intentService.updateIntent(created.id, { date: datePlus(2) });
  assert.equal(moved.date, datePlus(2));

  const patched = intentService.updateIntent(created.id, { windowEnd: '22:00', courtsNeeded: 3 });
  assert.equal(patched.windowEnd, '22:00');
  assert.equal(patched.courtsNeeded, 3);
  assert.equal(patched.date, datePlus(2));

  intentService.deleteIntent(created.id);
  assert.equal(intentService.getIntentById(created.id), null);
});

test('findByWindow：同日同窗口命中；改窗口/换日/排除自身则不命中', () => {
  resetIntents();
  const date = today();
  const a = intentService.createIntent({
    date, windowStart: '20:00', windowEnd: '21:00', durationHours: 1
  });
  intentService.createIntent({ date, windowStart: '19:00', windowEnd: '21:00', durationHours: 2 });

  // 命中
  assert.equal(intentService.findByWindow({ date, windowStart: '20:00', windowEnd: '21:00' }).id, a.id);
  // 排除自身（编辑场景）
  assert.equal(intentService.findByWindow({
    date, windowStart: '20:00', windowEnd: '21:00', excludeId: a.id
  }), null);
  // 窗口不同 / 日期不同 → 不命中（部分重叠也算不重复）
  assert.equal(intentService.findByWindow({ date, windowStart: '20:00', windowEnd: '22:00' }), null);
  assert.equal(intentService.findByWindow({ date: datePlus(1), windowStart: '20:00', windowEnd: '21:00' }), null);
  // 参数不全 → null（不误报）
  assert.equal(intentService.findByWindow({ date }), null);
});

test('listIntents：全量按创建时间排序，from/to 按日期区间过滤', () => {
  resetIntents();
  makeIntent({ date: today(), windowStart: '08:00' });
  makeIntent({ date: datePlus(2), windowStart: '09:00' });
  makeIntent({ date: datePlus(5), windowStart: '10:00' });

  assert.equal(intentService.listIntents().length, 3);
  assert.deepEqual(intentService.listIntents({ from: today(), to: datePlus(2) }).map(i => i.date), [today(), datePlus(2)]);
  assert.deepEqual(intentService.listIntents({ from: datePlus(2) }).map(i => i.date), [datePlus(2), datePlus(5)]);
  assert.deepEqual(intentService.listIntents({ to: today() }).map(i => i.date), [today()]);
  assert.deepEqual(intentService.listIntents({ from: datePlus(9) }).map(i => i.date), []);

  // statusCtxFor 注入：每行拿到引擎事实（这里用风控重试集演示）
  const id = intentService.listIntents().find(i => i.date === today()).id;
  const list = intentService.listIntents({ from: today(), to: today() }, (row) => ({
    riskRetryKeys: new Set([`${row.id}|${row.date}`])
  }));
  assert.equal(list[0].id, id);
  assert.equal(list[0].status, 'awaiting_verify');
});

// === 日期展开与清扫 ===

test('expandIntentDates：过期展开为空、未过期展开为自身日期', () => {
  resetIntents();
  const expired = makeIntent({ date: datePlus(-1) });
  assert.equal(intentService.isIntentExpired(intentService.getIntentById(expired.id)), true);
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(expired.id)), []);

  const future = makeIntent({ date: datePlus(2) });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(future.id)), [datePlus(2)]);

  // 窗口外（提前设置）也展开：进窗口后自然生效
  const far = makeIntent({ date: datePlus(BOOKING_WINDOW_DAYS + 3) });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(far.id)), [datePlus(BOOKING_WINDOW_DAYS + 3)]);
});

test('expandIntentDates：unavailable_days 标记的日期排除', () => {
  resetIntents();
  const date = datePlus(1);
  insertUnavailableDay(date);
  const intent = makeIntent({ date });
  assert.deepEqual(intentService.expandIntentDates(intentService.getIntentById(intent.id)), []);
});

test('sweepExpiredIntents：只把过期且启用的意图置为停用，锁场记录不动', () => {
  resetIntents();
  const expired = makeIntent({ date: datePlus(-1) });
  const expiredOff = makeIntent({ date: datePlus(-2), enabled: false });
  const todayIntent = makeIntent({ date: today() });
  const future = makeIntent({ date: datePlus(BOOKING_WINDOW_DAYS + 1) });
  prepare(`INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, status)
    VALUES ('bil-sweep', ?, 'u-sweep', ?, '17:00', '18:00', 'locked')`).run(expired.id, datePlus(-1));

  assert.equal(intentService.sweepExpiredIntents(), 1); // 只动过期且 enabled=1 的那条
  assert.equal(intentService.getIntentById(expired.id).enabled, 0);
  assert.equal(intentService.getIntentById(expiredOff.id).enabled, 0);
  assert.equal(intentService.getIntentById(todayIntent.id).enabled, 1);
  assert.equal(intentService.getIntentById(future.id).enabled, 1);

  // 幂等：再扫无改动；锁场记录保留
  assert.equal(intentService.sweepExpiredIntents(), 0);
  assert.equal(prepare(`SELECT status FROM booking_intent_locks WHERE id = 'bil-sweep'`).get().status, 'locked');
});

// === 推送记录 ===

test('recordNotification/listNotifications：intentId 与 date 过滤 + 倒序分页', () => {
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
    intentId: b.id, uniqNo: 'u-b-0', areaName: '2号场', date: datePlus(1), startTime: '20:00', endTime: '21:00',
    success: false, error: '推送失败：x'
  });

  const all = intentService.listNotifications({ pageNo: 1, pageSize: 3 });
  assert.equal(all.total, 4);
  assert.equal(all.list.length, 3);

  const filtered = intentService.listNotifications({ intentId: b.id });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.list[0].uniqNo, 'u-b-0');
  assert.equal(filtered.list[0].success, false);
  assert.equal(filtered.list[0].error, '推送失败：x');

  // 按日期过滤（历史仍可按天查询）
  const byDate = intentService.listNotifications({ date: datePlus(1) });
  assert.equal(byDate.total, 1);
  assert.equal(byDate.list[0].date, datePlus(1));
  assert.equal(intentService.listNotifications({ date: datePlus(9) }).total, 0);

  // intentId + date 并用
  assert.equal(intentService.listNotifications({ intentId: a.id, date: today() }).total, 3);

  // 旧数据兼容：intent_id 允许 NULL
  intentService.recordNotification({ uniqNo: 'u-legacy', date: today(), startTime: '08:00', endTime: '09:00', success: true });
  const legacy = intentService.listNotifications({}).list.find(n => n.uniqNo === 'u-legacy');
  assert.equal(legacy.intentId, null);
});
