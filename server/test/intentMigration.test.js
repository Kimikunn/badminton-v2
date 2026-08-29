/**
 * 迁移 016（venue_watch_* / venue_lock_orders → 订场意图模型）专项测试
 *
 * - 含旧表旧数据的库跑迁移：数据正确映射（含 slots JSON 与 NULL 两条路径）、旧表删除
 * - 幂等：抹掉 _migrations 记录再跑无副作用；全新库空跑不报错
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
  // 目标 B：notify + 每周模式 + slots NULL → window = start/end、duration = 区间小时数
  db.run(`INSERT INTO venue_watch_targets
    (id, date, weekdays, start_time, end_time, area_ids, enabled, slots, auto_lock, max_locks_per_slot, created_at, updated_at)
    VALUES ('vwt-b', NULL, '[6,0]', '08:00', '11:00', '[]', 0, NULL, 0, 1, '2026-08-01 02:00:00', '2026-08-02 02:00:00')`);
  db.run(`INSERT INTO venue_lock_orders (id, target_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error, created_at)
    VALUES
    ('vlo-1', 'vwt-a', '41_20260830_19:00_20:00', '2026-08-30', '19:00', '20:00', 41, '1号场', 'ORD-1', 'locked', NULL, '2026-08-03 01:00:00'),
    ('vlo-2', 'vwt-a', '41_20260830_20:00_21:00', '2026-08-30', '20:00', '21:00', 41, '1号场', NULL, 'failed', '该时段已被预订', '2026-08-03 01:01:00')`);
  db.run(`INSERT INTO venue_watch_areas (area_id, area_name, updated_at) VALUES (41, '1号场', '2026-08-03 01:00:00'), (42, '2号场', '2026-08-03 01:00:00')`);
  db.run(`INSERT INTO venue_watch_slot_state (uniq_no, date, available, updated_at) VALUES ('41_20260830_19:00_20:00', '2026-08-30', 1, '2026-08-03 01:00:00')`);
  db.run(`INSERT INTO venue_watch_notifications (id, uniq_no, area_name, date, start_time, end_time, price, success, error, created_at)
    VALUES ('vwn-1', '41_20260830_19:00_20:00', '1号场', '2026-08-30', '19:00', '20:00', 60, 1, NULL, '2026-08-03 01:00:00')`);

  fs.writeFileSync(process.env.DB_PATH, Buffer.from(db.export()));
  db.close();
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

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('016：旧库数据正确映射到新表，旧表删除，部分唯一索引存在', async () => {
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
    indexSql: rows(db, `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_booking_intent_locks_uniq_no_locked'`)[0]?.sql || null
  }));

  // targets → booking_intents
  assert.equal(state.intents.length, 2);
  const [a, b] = state.intents;
  // A：slots 非空路径 —— window = min/max(slot)，duration = count(slots)，courts 钳制到 3
  assert.equal(a.mode, 'auto_lock');
  assert.equal(a.date, '2026-08-30');
  assert.equal(a.weekdays, null);
  assert.equal(a.window_start, '19:00');
  assert.equal(a.window_end, '21:00');
  assert.equal(a.duration_hours, 2);
  assert.equal(a.courts_needed, 3);
  assert.equal(a.preferred_area_ids, '[42,43]');
  assert.equal(a.enabled, 1);
  assert.equal(a.created_at, '2026-08-01 01:00:00');
  // B：slots NULL 路径 —— window = start/end，duration = 区间小时数；每周模式原样保留
  assert.equal(b.mode, 'notify');
  assert.equal(b.date, null);
  assert.equal(b.weekdays, '[6,0]');
  assert.equal(b.window_start, '08:00');
  assert.equal(b.window_end, '11:00');
  assert.equal(b.duration_hours, 3);
  assert.equal(b.courts_needed, 1);
  assert.equal(b.enabled, 0);

  // venue_lock_orders → booking_intent_locks：target_id → intent_id，新增 unpaid_expired_count=0
  assert.equal(state.locks.length, 2);
  assert.equal(state.locks[0].intent_id, 'vwt-a');
  assert.equal(state.locks[0].status, 'locked');
  assert.equal(state.locks[0].order_id, 'ORD-1');
  assert.equal(state.locks[0].unpaid_expired_count, 0);
  assert.equal(state.locks[1].status, 'failed');
  assert.equal(state.locks[1].error, '该时段已被预订');

  // config：保留开关与告警标记/场地优先级；v1 凭证列随旧表删除
  assert.equal(state.config[0].enabled, 0);
  assert.equal(state.config[0].token_invalid_notified, 1);
  assert.equal(state.config[0].area_priority, '[42,41]');

  // areas / slot_state 原样拷贝；notifications 旧数据 intent_id 置 NULL
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

  // 抹掉 016 的应用标记，模拟迁移记录丢失
  {
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
    db.run(`DELETE FROM _migrations WHERE name = '016_intent_refactor.sql'`);
    fs.writeFileSync(process.env.DB_PATH, Buffer.from(db.export()));
    db.close();
  }

  await initDatabase(); // 016 重跑：旧表已删 → 直接跳过
  closeDatabase();

  const state = await readDb((db) => ({
    intents: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intents')[0].cnt,
    locks: rows(db, 'SELECT COUNT(*) AS cnt FROM booking_intent_locks')[0].cnt,
    applied: rows(db, `SELECT COUNT(*) AS cnt FROM _migrations WHERE name = '016_intent_refactor.sql'`)[0].cnt
  }));
  assert.equal(state.intents, 2);
  assert.equal(state.locks, 2);
  assert.equal(state.applied, 1);
});

test('016：全新库空跑无副作用（新表齐、旧表不存在）', async () => {
  fs.rmSync(process.env.DB_PATH, { force: true });
  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => ({
    tables: rows(db, `SELECT name FROM sqlite_master WHERE type = 'table'`).map(r => r.name),
    config: rows(db, 'SELECT * FROM watch_config WHERE id = 1')
  }));
  for (const t of ['booking_intents', 'booking_intent_locks', 'watch_config', 'watch_areas', 'watch_slot_state', 'watch_notifications']) {
    assert.ok(state.tables.includes(t), `新表 ${t} 应存在`);
  }
  for (const t of ['venue_watch_targets', 'venue_lock_orders', 'venue_watch_config',
    'venue_watch_areas', 'venue_watch_slot_state', 'venue_watch_notifications']) {
    assert.ok(!state.tables.includes(t), `旧表 ${t} 不应存在`);
  }
  assert.equal(state.config.length, 1); // 默认配置行
  assert.equal(state.config[0].enabled, 1);
});
