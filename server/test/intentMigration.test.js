/**
 * 迁移专项测试：016（venue_watch_* → 订场意图模型）与 018（单日模型 + 结构化错误码）
 *
 * - 含旧表旧数据的库跑迁移：数据正确映射（含 slots JSON 与 NULL 两条路径）、旧表删除
 * - weekly 行展开为窗口内 date 意图（016 的 v1 导入路径与 018 的存量路径都覆盖）
 * - 无匹配日期的 weekly 行删除、字段复制、enabled 继承
 * - 018：error_code 列新增与历史回填、weekdays 列删除、幂等（二次启动不重复展开）
 * - booking_intent_locks 部分唯一索引（uniq_no WHERE status='locked'）存在
 *
 * 风格参照 migrations.test.js：直接用 sql.js 构造库文件，再走 initDatabase()。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-intent-migration-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDatabase, closeDatabase } = require('../src/config/db');
const { BOOKING_WINDOW_DAYS, dateStr, today } = require('../src/services/venueShared');

const PRE_016_MIGRATIONS = [
  '001_add_match_format.sql',
  '002_add_relationship_indexes.sql',
  '003_create_game_rule_events.sql',
  '004_split_booking_time.sql',
  '005_venue_pricing.sql',
  '006_fix_booking_records_id.sql',
  '007_add_champion_player_id.sql',
  '008_add_unavailable_days.sql',
  '009_venue_watch.sql',
  '010_venue_watch_weekly.sql',
  '011_venue_watch_exclude_unavailable.sql',
  '012_venue_watch_slots.sql',
  '013_venue_lock_orders.sql',
  '014_venue_lock_max_per_slot.sql',
  '015_venue_watch_area_priority.sql'
];

const POST_017_MIGRATIONS = [
  ...PRE_016_MIGRATIONS,
  '016_intent_refactor.sql',
  '017_drop_unpaid_expired.sql'
];

/** 放票窗口内的日期串（today ~ today+3），与迁移展开规则一致 */
function windowDates() {
  const [y, m, d] = today().split('-').map(Number);
  const dates = [];
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    dates.push(dateStr(new Date(y, m - 1, d + i)));
  }
  return dates;
}

function weekdayOf(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

/** 窗口覆盖的星期集合 / 未被覆盖的星期（用于构造"无匹配"用例） */
function weekdayCoverage() {
  const covered = new Set(windowDates().map(weekdayOf));
  return { covered, uncovered: [0, 1, 2, 3, 4, 5, 6].filter(d => !covered.has(d)) };
}

/**
 * 窗口内"必命中"的星期。fixture 用它构造，避免当前日是周二时 `[6,0]` 退化为空集合、
 * 导致断言两边都是 [] 而静默空转（用例仍然绿但零覆盖）。
 */
function firstCoveredWeekday() {
  return [...weekdayCoverage().covered][0];
}

/** 窗口内必命中的前 n 个星期（n≤4，保证展开出多条、走新 id 路径） */
function firstCoveredWeekdays(n = 2) {
  return [...weekdayCoverage().covered].slice(0, n);
}

/** 窗口内"必不命中"的星期（用于"无匹配"用例） */
function firstUncoveredWeekday() {
  return weekdayCoverage().uncovered[0];
}

/** 打开当前 DB 文件只读查询 */
async function readDb(fn) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function rows(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  return res[0].values.map(v => Object.fromEntries(res[0].columns.map((c, i) => [c, v[i]])));
}

function writeDb(db) {
  fs.writeFileSync(process.env.DB_PATH, Buffer.from(db.export()));
  db.close();
}

/** 构造一个"016 之前"的旧库：旧表（post-015 结构）+ 测试数据 + 001-015 已应用标记 */
async function writeLegacyDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE venue_watch_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      token_user TEXT, webhook_type TEXT, webhook_url TEXT, webhook_token TEXT, webhook_topic TEXT,
      poll_interval_sec INTEGER, enabled INTEGER DEFAULT 1,
      token_invalid_notified INTEGER DEFAULT 0,
      area_priority TEXT,
      poll_failure_notified INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE venue_watch_targets (
      id TEXT PRIMARY KEY,
      date TEXT, weekdays TEXT,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      area_id INTEGER, area_name TEXT,
      area_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      exclude_unavailable INTEGER NOT NULL DEFAULT 1,
      slots TEXT,
      auto_lock INTEGER NOT NULL DEFAULT 0,
      max_locks_per_slot INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE venue_lock_orders (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,
      uniq_no TEXT NOT NULL,
      date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      area_id INTEGER, area_name TEXT, order_id TEXT,
      status TEXT NOT NULL, error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE venue_watch_areas (area_id INTEGER PRIMARY KEY, area_name TEXT, updated_at TEXT);
    CREATE TABLE venue_watch_slot_state (uniq_no TEXT PRIMARY KEY, date TEXT, available INTEGER DEFAULT 0, updated_at TEXT);
    CREATE TABLE venue_watch_notifications (
      id TEXT PRIMARY KEY, uniq_no TEXT, area_name TEXT, date TEXT,
      start_time TEXT, end_time TEXT, price REAL, success INTEGER DEFAULT 0, error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  for (const name of PRE_016_MIGRATIONS) {
    db.run('INSERT INTO _migrations (name) VALUES (?)', [name]);
  }
  db.run(`INSERT INTO venue_watch_config (id, enabled, token_invalid_notified, poll_failure_notified, area_priority)
    VALUES (1, 0, 1, 0, '[42,41]')`);
  // 目标 A：auto_lock + 离散 slots（19-20、20-21）→ window 19:00-21:00、duration 2；max_locks 5 钳制到 3
  db.run(`INSERT INTO venue_watch_targets
    (id, date, weekdays, start_time, end_time, area_ids, enabled, exclude_unavailable, slots, auto_lock, max_locks_per_slot, created_at, updated_at)
    VALUES ('vwt-a', '2026-08-30', NULL, '08:00', '22:00', '[42,43]', 1, 0,
      '[{"startTime":"19:00","endTime":"20:00"},{"startTime":"20:00","endTime":"21:00"}]', 1, 5, '2026-08-01 01:00:00', '2026-08-02 01:00:00')`);
  // 目标 B：notify + 每周模式 + slots NULL → window = start/end、duration = 区间小时数；v1 导入即展开为日期意图
  // 用“窗口内必命中”的星期，保证展开结果非空（否则当前日为周二时用例会空转）
  db.run(`INSERT INTO venue_watch_targets
    (id, date, weekdays, start_time, end_time, area_ids, enabled, slots, auto_lock, max_locks_per_slot, created_at, updated_at)
    VALUES ('vwt-b', NULL, '[${firstCoveredWeekdays().join(',')}]', '08:00', '11:00', '[]', 0, NULL, 0, 1, '2026-08-01 02:00:00', '2026-08-02 02:00:00')`);
  db.run(`INSERT INTO venue_lock_orders (id, target_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error, created_at)
    VALUES
    ('vlo-1', 'vwt-a', '41_20260830_19:00_20:00', '2026-08-30', '19:00', '20:00', 41, '1号场', 'ORD-1', 'locked', NULL, '2026-08-03 01:00:00'),
    ('vlo-2', 'vwt-a', '41_20260830_20:00_21:00', '2026-08-30', '20:00', '21:00', 41, '1号场', NULL, 'failed', '该时段已被预订', '2026-08-03 01:01:00')`);
  db.run(`INSERT INTO venue_watch_areas (area_id, area_name, updated_at) VALUES (41, '1号场', '2026-08-03 01:00:00'), (42, '2号场', '2026-08-03 01:00:00')`);
  db.run(`INSERT INTO venue_watch_slot_state (uniq_no, date, available, updated_at) VALUES ('41_20260830_19:00_20:00', '2026-08-30', 1, '2026-08-03 01:00:00')`);
  db.run(`INSERT INTO venue_watch_notifications (id, uniq_no, area_name, date, start_time, end_time, price, success, error, created_at)
    VALUES ('vwn-1', '41_20260830_19:00_20:00', '1号场', '2026-08-30', '19:00', '20:00', 60, 1, NULL, '2026-08-03 01:00:00')`);

  writeDb(db);
}

/**
 * 构造一个"017 之后、018 之前"的库：booking_intents 仍带 weekdays 列、
 * booking_intent_locks 无 error_code；001-017 已应用，只等 018。
 */
async function writePost017Db() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE booking_intents (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'auto_lock',
      date TEXT,
      weekdays TEXT,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      duration_hours INTEGER NOT NULL DEFAULT 1,
      courts_needed INTEGER NOT NULL DEFAULT 1,
      preferred_area_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE booking_intent_locks (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL,
      uniq_no TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      area_id INTEGER,
      area_name TEXT,
      order_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE watch_notifications (
      id TEXT PRIMARY KEY, intent_id TEXT, uniq_no TEXT, area_name TEXT, date TEXT,
      start_time TEXT, end_time TEXT, price REAL, success INTEGER DEFAULT 0, error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  for (const name of POST_017_MIGRATIONS) {
    db.run('INSERT INTO _migrations (name) VALUES (?)', [name]);
  }

  const { covered, uncovered } = weekdayCoverage();
  // 保证“窗口内必命中”的 fixture 用 covered 构造；用模块级 helper 使断言同一来源
  const coveredDow = [...covered][0];
  const uncoveredDow = uncovered[0];
  // weekly-1：每天 → 窗口内 4 条（覆盖字段复制与 enabled 继承）
  db.run(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES ('int-weekly-all', 'auto_lock', NULL, '[0,1,2,3,4,5,6]', '19:00', '21:00', 2, 2, '[42,41]', 1, '2026-08-01 01:00:00', '2026-08-02 01:00:00')`);
  // weekly-2：单个“窗口内命中”的星期 → 恰好 1 条；停用状态要继承
  db.run(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES ('int-weekly-one', 'notify', NULL, '[${coveredDow}]', '08:00', '11:00', 3, 1, '[]', 0, '2026-08-01 02:00:00', '2026-08-02 02:00:00')`);
  // weekly-3：窗口内无匹配的星期（窗口覆盖 4 个星期，必剩 3 个）→ 展开为“下一个发生日”（不删配置）
  db.run(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES ('int-weekly-none', 'auto_lock', NULL, '[${uncoveredDow}]', '17:00', '18:00', 1, 1, '[]', 1, '2026-08-01 03:00:00', '2026-08-02 03:00:00')`);
  // weekly-4：weekdays 非法/为空 → 无法展开，只能删行
  db.run(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES ('int-weekly-bad', 'auto_lock', NULL, '[]', '17:00', '18:00', 1, 1, '[]', 1, '2026-08-01 05:00:00', '2026-08-02 05:00:00')`);
  // 已是单日模型的行：原样保留
  db.run(`INSERT INTO booking_intents (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES ('int-single', 'auto_lock', '${today()}', NULL, '19:00', '20:00', 1, 1, '[41]', 1, '2026-08-01 04:00:00', '2026-08-02 04:00:00')`);

  // 历史失败记录：能可靠判定的回填，其余留 NULL；locked 行不动
  db.run(`INSERT INTO booking_intent_locks (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error, created_at)
    VALUES
    ('bil-rc',  'int-single', 'u-rc',  '${today()}', '19:00', '20:00', 41, '1号场', NULL, 'failed', '自动锁场触发风控，需在小程序内完成验证码后重试', '2026-08-03 01:00:00'),
    ('bil-unp', 'int-single', 'u-unp', '${today()}', '19:00', '20:00', 41, '1号场', NULL, 'failed', '下单前校验未通过：存在未支付订单，请先支付', '2026-08-03 01:01:00'),
    ('bil-lim', 'int-single', 'u-lim', '${today()}', '19:00', '20:00', 41, '1号场', NULL, 'failed', '下单前校验未通过：该时段限订 1 笔', '2026-08-03 01:02:00'),
    ('bil-oth', 'int-single', 'u-oth', '${today()}', '19:00', '20:00', 41, '1号场', NULL, 'failed', '该时段已被预订', '2026-08-03 01:03:00'),
    ('bil-ok',  'int-single', 'u-ok',  '${today()}', '19:00', '20:00', 41, '1号场', 'ORD-9', 'locked', NULL, '2026-08-03 01:04:00')`);
  db.run(`INSERT INTO watch_notifications (id, intent_id, uniq_no, area_name, date, start_time, end_time, price, success, error, created_at)
    VALUES ('ntf-1', 'int-single', 'u-ok', '1号场', '${today()}', '19:00', '20:00', 60, 1, NULL, '2026-08-03 01:05:00')`);

  writeDb(db);
}

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// === 016：v1 旧库导入 ===

test('016：旧库数据正确映射到新表（weekly 目标按窗口展开为日期意图），旧表删除', async () => {
  await writeLegacyDb();
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    intents: rows(db, 'SELECT * FROM booking_intents ORDER BY id'),
    locks: rows(db, 'SELECT * FROM booking_intent_locks ORDER BY id'),
    config: rows(db, 'SELECT * FROM watch_config WHERE id = 1'),
    areas: rows(db, 'SELECT * FROM watch_areas ORDER BY area_id'),
    slotState: rows(db, 'SELECT * FROM watch_slot_state'),
    notifications: rows(db, 'SELECT * FROM watch_notifications'),
    tables: rows(db, `SELECT name FROM sqlite_master WHERE type = 'table'`).map(r => r.name),
    intentColumns: rows(db, 'PRAGMA table_info(booking_intents)').map(r => r.name),
    indexSql: rows(db, `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_booking_intent_locks_uniq_no_locked'`)[0]?.sql || null
  }));

  // 目标 A（单日）：slots 非空路径 —— window = min/max(slot)，duration = count(slots)，courts 钳制到 3
  const a = state.intents.find(r => r.id === 'vwt-a');
  assert.ok(a, '单日目标应沿用原 id');
  assert.equal(a.mode, 'auto_lock');
  assert.equal(a.date, '2026-08-30');
  assert.equal(a.window_start, '19:00');
  assert.equal(a.window_end, '21:00');
  assert.equal(a.duration_hours, 2);
  assert.equal(a.courts_needed, 3);
  assert.equal(a.preferred_area_ids, '[42,43]');
  assert.equal(a.enabled, 1);
  assert.equal(a.created_at, '2026-08-01 01:00:00');

  // 目标 B（weekly，窗口内命中）：schema 已是单日模型 → 导入时按放票窗口展开，字段复制 + enabled 继承
  const bRows = state.intents.filter(r => r.id !== 'vwt-a');
  const expectedB = windowDates().filter(d => firstCoveredWeekdays().includes(weekdayOf(d)));
  assert.equal(expectedB.length, 2, 'fixture 必须展开出 2 条（多条才走新 id 路径，避免 016 的单条沿用原 id 分支）');
  assert.deepEqual(bRows.map(r => r.date).sort(), expectedB.sort());
  for (const r of bRows) {
    assert.match(r.id, /^int-/);
    assert.equal(r.mode, 'notify');
    assert.equal(r.window_start, '08:00');
    assert.equal(r.window_end, '11:00');
    assert.equal(r.duration_hours, 3);
    assert.equal(r.courts_needed, 1);
    assert.equal(r.enabled, 0); // enabled 继承
    assert.equal(r.created_at, '2026-08-01 02:00:00');
  }
  // weekdays 列不存在（018 已执行）
  assert.ok(!state.intentColumns.includes('weekdays'));

  // venue_lock_orders → booking_intent_locks：target_id → intent_id；可可靠判定的历史文案一并回填 error_code
  assert.equal(state.locks.length, 2);
  assert.equal(state.locks[0].intent_id, 'vwt-a');
  assert.equal(state.locks[0].status, 'locked');
  assert.equal(state.locks[0].order_id, 'ORD-1');
  assert.equal(state.locks[1].status, 'failed');
  assert.equal(state.locks[1].error, '该时段已被预订');
  assert.equal(state.locks[1].error_code, 'SOLDOUT');

  // config：保留开关与告警标记/场地优先级；areas / slot_state / notifications 原样保留
  assert.equal(state.config[0].enabled, 0);
  assert.equal(state.config[0].token_invalid_notified, 1);
  assert.equal(state.config[0].area_priority, '[42,41]');
  assert.deepEqual(state.areas.map(r => r.area_name), ['1号场', '2号场']);
  assert.equal(state.slotState[0].available, 1);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].intent_id, null);

  // 旧表全部删除
  for (const t of ['venue_watch_targets', 'venue_lock_orders', 'venue_watch_config',
    'venue_watch_areas', 'venue_watch_slot_state', 'venue_watch_notifications']) {
    assert.ok(!state.tables.includes(t), `旧表 ${t} 应已删除`);
  }

  // 部分唯一索引存在且带 WHERE 子句
  assert.ok(state.indexSql, '部分唯一索引应存在');
  assert.match(state.indexSql, /WHERE\s+status\s*=\s*'locked'/i);
});

test('016 幂等：抹掉迁移标记再跑一次无副作用', async () => {
  await writeLegacyDb();
  await initDatabase();
  closeDatabase();
  const before = await readDb((db) => ({
    intents: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locks: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks')[0].cnt
  }));

  // 抹掉 016 的应用标记，模拟迁移记录丢失
  {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
    db.run(`DELETE FROM _migrations WHERE name = '016_intent_refactor.sql'`);
    writeDb(db);
  }

  await initDatabase(); // 016 重跑：旧表已删 → 直接跳过
  closeDatabase();

  const state = await readDb((db) => ({
    intents: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locks: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks')[0].cnt,
    applied: rows(db, `SELECT COUNT(*) AS cnt FROM _migrations WHERE name = '016_intent_refactor.sql'`)[0].cnt
  }));
  assert.equal(state.intents, before.intents);
  assert.equal(state.locks, before.locks);
  assert.equal(state.applied, 1);
});

test('016/018：全新库空跑无副作用（新表齐、weekdays 列不存在、error_code 列存在）', async () => {
  fs.rmSync(process.env.DB_PATH, { force: true });
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    tables: rows(db, `SELECT name FROM sqlite_master WHERE type = 'table'`).map(r => r.name),
    intentColumns: rows(db, 'PRAGMA table_info(booking_intents)').map(r => r.name),
    lockColumns: rows(db, 'PRAGMA table_info(booking_intent_locks)').map(r => r.name),
    config: rows(db, 'SELECT * FROM watch_config WHERE id = 1')
  }));
  for (const t of ['booking_intents', 'booking_intent_locks', 'watch_config', 'watch_areas', 'watch_slot_state', 'watch_notifications']) {
    assert.ok(state.tables.includes(t), `新表 ${t} 应存在`);
  }
  for (const t of ['venue_watch_targets', 'venue_lock_orders', 'venue_watch_config',
    'venue_watch_areas', 'venue_watch_slot_state', 'venue_watch_notifications']) {
    assert.ok(!state.tables.includes(t), `旧表 ${t} 不应存在`);
  }
  assert.ok(!state.intentColumns.includes('weekdays'), '新库 booking_intents 不应有 weekdays 列');
  assert.ok(state.lockColumns.includes('error_code'), '新库 booking_intent_locks 应有 error_code 列');
  assert.ok(state.lockColumns.includes('expire_at'), '新库 booking_intent_locks 应有 expire_at 列');
  assert.equal(state.config.length, 1); // 默认配置行
  assert.equal(state.config[0].enabled, 1);
});

// === 019：支付截止时间列 ===

test('019：booking_intent_locks 新增 expire_at 列且幂等（二次启动 / 抹掉标记重跑都不重复加列）', async () => {
  await writePost017Db();
  await initDatabase();
  closeDatabase();

  const columnCount = (columns) => columns.filter(c => c === 'expire_at').length;
  let columns = await readDb(db => rows(db, 'PRAGMA table_info(booking_intent_locks)').map(r => r.name));
  assert.ok(columns.includes('expire_at'), '019 后应有 expire_at 列');
  assert.equal(columnCount(columns), 1);

  // 正常二次启动：迁移标记已存在，直接跳过
  await initDatabase();
  closeDatabase();
  columns = await readDb(db => rows(db, 'PRAGMA table_info(booking_intent_locks)').map(r => r.name));
  assert.equal(columnCount(columns), 1);

  // 抹掉 019 标记再跑：hasColumn 幂等，不重复加列也不报错
  {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
    db.run(`DELETE FROM _migrations WHERE name = '019_lock_expire_at.sql'`);
    writeDb(db);
  }
  await initDatabase();
  closeDatabase();

  const state = await readDb(db => ({
    columns: rows(db, 'PRAGMA table_info(booking_intent_locks)').map(r => r.name),
    applied: rows(db, `SELECT COUNT(*) AS cnt FROM _migrations WHERE name = '019_lock_expire_at.sql'`)[0].cnt
  }));
  assert.equal(columnCount(state.columns), 1);
  assert.equal(state.applied, 1);
});

// === 018：单日模型 + 结构化错误码 ===

test('018：weekly 行展开为窗口内 date 意图（字段复制/enabled 继承），无匹配行删除', async () => {
  await writePost017Db();
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    intents: rows(db, 'SELECT * FROM booking_intents ORDER BY id'),
    columns: rows(db, 'PRAGMA table_info(booking_intents)').map(r => r.name),
    lockCodes: rows(db, 'SELECT id, status, error, error_code FROM booking_intent_locks ORDER BY id'),
    lockColumns: rows(db, 'PRAGMA table_info(booking_intent_locks)').map(r => r.name),
    notifications: rows(db, 'SELECT * FROM watch_notifications')
  }));

  // weekdays 列消失，weekly 行全部消失
  assert.ok(!state.columns.includes('weekdays'));
  assert.ok(!state.intents.some(r => r.id.startsWith('int-weekly')));

  // weekly-all（每天）→ 窗口内 4 条，字段逐个复制、enabled 继承、created_at 保留
  const all = state.intents.filter(r => r.date && r.mode === 'auto_lock' && r.window_start === '19:00' && r.id !== 'int-single');
  assert.deepEqual(all.map(r => r.date).sort(), windowDates().sort());
  for (const r of all) {
    assert.match(r.id, /^int-/);
    assert.equal(r.window_start, '19:00');
    assert.equal(r.window_end, '21:00');
    assert.equal(r.duration_hours, 2);
    assert.equal(r.courts_needed, 2);
    assert.equal(r.preferred_area_ids, '[42,41]');
    assert.equal(r.enabled, 1);
    assert.equal(r.created_at, '2026-08-01 01:00:00');
    assert.equal(r.updated_at, '2026-08-02 01:00:00');
  }

  // weekly-one（窗口内命中的单星期）→ 恰好 1 条，enabled=0 继承
  const one = state.intents.filter(r => r.mode === 'notify');
  const expectedOne = windowDates().filter(d => weekdayOf(d) === firstCoveredWeekday());
  assert.ok(expectedOne.length > 0, 'fixture 必须保证窗口内命中，否则用例会空转');
  assert.deepEqual(one.map(r => r.date).sort(), expectedOne.sort());
  for (const r of one) {
    assert.equal(r.window_start, '08:00');
    assert.equal(r.duration_hours, 3);
    assert.equal(r.enabled, 0);
  }

  // weekly-none（窗口内无匹配星期）→ 展开为“下一个发生日”（配置不丢，D2 下可提前挂监控）
  const carried = state.intents.filter(r => r.window_start === '17:00' && r.window_end === '18:00');
  assert.equal(carried.length, 1);
  assert.ok(!windowDates().includes(carried[0].date), '承接行应落在放票窗口之外');
  assert.equal(weekdayOf(carried[0].date), firstUncoveredWeekday());
  assert.equal(carried[0].enabled, 1);

  // weekly-bad（weekdays 非法/为空）→ 无法展开，删行
  assert.equal(state.intents.length, 1 + windowDates().length + expectedOne.length + 1);

  // 已是单日模型的行原样保留
  const single = state.intents.find(r => r.id === 'int-single');
  assert.equal(single.date, today());
  assert.equal(single.window_start, '19:00');
  assert.equal(single.preferred_area_ids, '[41]');

  // error_code 列新增 + 历史回填（只认能可靠判定的文案，其余 NULL）
  assert.ok(state.lockColumns.includes('error_code'));
  const codeById = Object.fromEntries(state.lockCodes.map(r => [r.id, r.error_code]));
  assert.equal(codeById['bil-rc'], 'RISK_CONTROL');
  assert.equal(codeById['bil-unp'], 'UNPAID');
  assert.equal(codeById['bil-lim'], 'LIMIT');
  assert.equal(codeById['bil-oth'], 'SOLDOUT'); // '该时段已被预订' 可可靠判定，迁移一并回填
  assert.equal(codeById['bil-ok'], null);
  // 锁场记录本身不被改动
  assert.equal(state.lockCodes.find(r => r.id === 'bil-ok').status, 'locked');
  assert.equal(state.lockCodes.find(r => r.id === 'bil-lim').error, '下单前校验未通过：该时段限订 1 笔');

  // 通知记录保留（历史仍可按 date 查询）
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].date, today());
});

test('018 幂等：二次启动 / 抹掉标记重跑都不重复展开', async () => {
  await writePost017Db();
  await initDatabase();
  closeDatabase();
  const after = await readDb((db) => ({
    intents: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locks: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks')[0].cnt
  }));

  // 正常二次启动
  await initDatabase();
  closeDatabase();

  // 抹掉 018 标记再跑：weekdays 列已删 → 只做幂等的 error_code 回填
  {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
    db.run(`DELETE FROM _migrations WHERE name = '018_single_date_intents.sql'`);
    writeDb(db);
  }
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    intents: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locks: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks')[0].cnt,
    applied: rows(db, `SELECT COUNT(*) AS cnt FROM _migrations WHERE name = '018_single_date_intents.sql'`)[0].cnt,
    codes: rows(db, 'SELECT error_code FROM booking_intent_locks ORDER BY id').map(r => r.error_code)
  }));
  assert.equal(state.intents, after.intents);
  assert.equal(state.locks, after.locks);
  assert.equal(state.applied, 1);
  assert.deepEqual(state.codes, ['LIMIT', null, 'SOLDOUT', 'RISK_CONTROL', 'UNPAID']); // 按 id 排序；回填未重复改写
});

test('018：真实迁移演练 —— 存量 weekly 库迁移后无 weekly 行、锁场记录与通知仍可按日期查询', async () => {
  await writePost017Db();
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    columns: rows(db, 'PRAGMA table_info(booking_intents)').map(r => r.name),
    intentsCount: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locksByDate: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks WHERE date = ?', [today()])[0].cnt,
    notificationsByDate: rows(db, 'SELECT COUNT(*) AS cnt FROM watch_notifications WHERE date = ?', [today()])[0].cnt,
    locksIntentIds: rows(db, 'SELECT DISTINCT intent_id FROM booking_intent_locks ORDER BY intent_id').map(r => r.intent_id)
  }));
  assert.ok(!state.columns.includes('weekdays'), '迁移后不应再有 weekdays 列（weekly 语义整体移除）');
  assert.equal(state.intentsCount, 1 + windowDates().length + 1 + 1); // 单日 1 + 每天型 4 + 命中单星期 1 + 承接下一发生日 1
  assert.equal(state.locksByDate, 5);
  assert.equal(state.notificationsByDate, 1);
  // 单日意图的 id 未变，锁场记录仍能按 intent_id 关联
  assert.deepEqual(state.locksIntentIds, ['int-single']);
});
