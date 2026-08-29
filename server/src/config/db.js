/**
 * Database configuration — sql.js SQLite wrapper
 *
 * Provides a singleton database instance with helper functions.
 * Database file lives at server/database/badminton.db
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'database', 'badminton.db');

let db = null;
let saveTimer = null;
let transactionDepth = 0;

/**
 * Initialize and open the database. Creates file if not exists.
 * Applies migrations after opening.
 */
async function initDatabase() {
  const SQL = await initSqlJs();

  // Ensure database directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log(`[DB] Opened existing database: ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log(`[DB] Created new database: ${DB_PATH}`);
  }

  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  runSchema();

  // Apply migrations
  await runMigrations();

  // Save
  saveDatabase();

  return db;
}

/**
 * Execute CREATE TABLE IF NOT EXISTS statements
 */
function runSchema() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
  db.run(schema);
  console.log('[DB] Schema applied');
}

/**
 * Run pending migrations from server/db/migrations/
 */
async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  // Create migrations tracking table
  db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = db.exec(`SELECT name FROM _migrations WHERE name = ?`, [file]);
    if (applied.length > 0 && applied[0].values.length > 0) {
      continue; // Already applied
    }

    console.log(`[DB] Running migration: ${file}`);
    runMigrationFile(migrationsDir, file);
    db.run(`INSERT INTO _migrations (name) VALUES (?)`, [file]);
  }

  saveDatabase();
}

function runMigrationFile(migrationsDir, file) {
  if (file === '001_add_match_format.sql') {
    migrateAddMatchFormat();
    return;
  }
  if (file === '007_add_champion_player_id.sql') {
    migrateAddChampionPlayerId();
    return;
  }
  if (file === '011_venue_watch_exclude_unavailable.sql') {
    migrateVenueWatchExcludeUnavailable();
    return;
  }
  if (file === '012_venue_watch_slots.sql') {
    migrateVenueWatchSlots();
    return;
  }
  if (file === '013_venue_lock_orders.sql') {
    migrateVenueLockOrders();
    return;
  }
  if (file === '014_venue_lock_max_per_slot.sql') {
    migrateVenueLockMaxPerSlot();
    return;
  }
  if (file === '015_venue_watch_area_priority.sql') {
    migrateVenueWatchAreaPriority();
    return;
  }
  if (file === '016_intent_refactor.sql') {
    migrateIntentRefactor();
    return;
  }

  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  db.run(sql);
}

function hasColumn(tableName, columnName) {
  const result = db.exec(`PRAGMA table_info(${tableName})`);
  const rows = result[0]?.values || [];
  return rows.some(row => row[1] === columnName);
}

function migrateAddMatchFormat() {
  if (!hasColumn('matches', 'match_format')) {
    db.run(`ALTER TABLE matches ADD COLUMN match_format TEXT DEFAULT 'bo3'`);
  }

  db.run(`UPDATE matches
    SET match_format = CASE
      WHEN best_of = 1 THEN 'bo1'
      WHEN best_of = 7 THEN 'pa7'
      ELSE 'bo3'
    END
    WHERE match_format IS NULL OR match_format = ''
      OR (best_of = 1 AND match_format <> 'bo1')
      OR (best_of = 7 AND match_format <> 'pa7')
      OR (best_of NOT IN (1, 7) AND match_format <> 'bo3')`);
}

function migrateAddChampionPlayerId() {
  if (!hasColumn('seasons', 'champion_player_id')) {
    db.run('ALTER TABLE seasons ADD COLUMN champion_player_id TEXT REFERENCES players(id)');
  }
}

function migrateVenueWatchExcludeUnavailable() {
  if (!hasColumn('venue_watch_targets', 'exclude_unavailable')) {
    db.run('ALTER TABLE venue_watch_targets ADD COLUMN exclude_unavailable INTEGER NOT NULL DEFAULT 1');
  }
}

function migrateVenueWatchSlots() {
  if (!hasColumn('venue_watch_targets', 'slots')) {
    db.run('ALTER TABLE venue_watch_targets ADD COLUMN slots TEXT');
  }
}

function migrateVenueLockOrders() {
  if (!hasColumn('venue_watch_targets', 'auto_lock')) {
    db.run('ALTER TABLE venue_watch_targets ADD COLUMN auto_lock INTEGER NOT NULL DEFAULT 0');
  }
  db.run(`CREATE TABLE IF NOT EXISTS venue_lock_orders (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
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
  )`);
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_lock_orders_uniq_no ON venue_lock_orders(uniq_no)');
}

function migrateVenueLockMaxPerSlot() {
  if (!hasColumn('venue_watch_targets', 'max_locks_per_slot')) {
    db.run('ALTER TABLE venue_watch_targets ADD COLUMN max_locks_per_slot INTEGER NOT NULL DEFAULT 1');
  }
}

function migrateVenueWatchAreaPriority() {
  if (!hasColumn('venue_watch_config', 'area_priority')) {
    db.run('ALTER TABLE venue_watch_config ADD COLUMN area_priority TEXT');
  }
  if (!hasColumn('venue_watch_config', 'poll_failure_notified')) {
    db.run('ALTER TABLE venue_watch_config ADD COLUMN poll_failure_notified INTEGER NOT NULL DEFAULT 0');
  }
}

function hasTable(tableName) {
  const result = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return result.length > 0 && result[0].values.length > 0;
}

function hhmmToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * 016: venue_watch_* / venue_lock_orders → 订场意图模型新表（见 migrations/016_intent_refactor.sql）。
 * 新库（schema.sql 已建新表、旧表不存在）与已迁移库直接跳过；整体事务保证原子性。
 */
function migrateIntentRefactor() {
  if (!hasTable('venue_watch_targets')) return;

  transaction(() => {
    // venue_watch_targets → booking_intents
    // 注意：db.js 的 prepare() 包装每次 run() 后即 free，语句对象不可跨行复用，循环内逐行 prepare。
    for (const t of prepare('SELECT * FROM venue_watch_targets').all()) {
      let windowStart = t.start_time;
      let windowEnd = t.end_time;
      let durationHours = Math.max(1, Math.round((hhmmToMinutes(t.end_time) - hhmmToMinutes(t.start_time)) / 60));
      let slots = null;
      try { slots = t.slots ? JSON.parse(t.slots) : null; } catch (_) { slots = null; }
      if (Array.isArray(slots) && slots.length > 0) {
        windowStart = slots.map(s => s.startTime).sort()[0];
        windowEnd = slots.map(s => s.endTime).sort().slice(-1)[0];
        durationHours = slots.length;
      }
      prepare(`INSERT INTO booking_intents
        (id, mode, date, weekdays, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        t.id,
        t.auto_lock ? 'auto_lock' : 'notify',
        t.date,
        t.weekdays,
        windowStart,
        windowEnd,
        durationHours,
        Math.min(3, Math.max(1, t.max_locks_per_slot || 1)),
        t.area_ids || '[]',
        t.enabled,
        t.created_at,
        t.updated_at
      );
    }

    // venue_lock_orders → booking_intent_locks
    if (hasTable('venue_lock_orders')) {
      for (const l of prepare('SELECT * FROM venue_lock_orders').all()) {
        prepare(`INSERT INTO booking_intent_locks
          (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error, unpaid_expired_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
          l.id, l.target_id, l.uniq_no, l.date, l.start_time, l.end_time,
          l.area_id, l.area_name, l.order_id, l.status, l.error, l.created_at
        );
      }
    }

    // venue_watch_config → watch_config（schema.sql 可能已插入默认行，存在则更新）
    const cfg = prepare('SELECT * FROM venue_watch_config WHERE id = 1').get();
    if (cfg) {
      if (prepare('SELECT id FROM watch_config WHERE id = 1').get()) {
        prepare(`UPDATE watch_config
          SET enabled = ?, token_invalid_notified = ?, poll_failure_notified = ?, area_priority = ?, updated_at = ?
          WHERE id = 1`).run(
          cfg.enabled, cfg.token_invalid_notified, cfg.poll_failure_notified, cfg.area_priority, cfg.updated_at
        );
      } else {
        prepare(`INSERT INTO watch_config
          (id, enabled, token_invalid_notified, poll_failure_notified, area_priority, updated_at)
          VALUES (1, ?, ?, ?, ?, ?)`).run(
          cfg.enabled, cfg.token_invalid_notified, cfg.poll_failure_notified, cfg.area_priority, cfg.updated_at
        );
      }
    }

    // venue_watch_areas / venue_watch_slot_state → 原样拷贝
    if (hasTable('venue_watch_areas')) {
      for (const a of prepare('SELECT * FROM venue_watch_areas').all()) {
        prepare('INSERT OR REPLACE INTO watch_areas (area_id, area_name, updated_at) VALUES (?, ?, ?)').run(
          a.area_id, a.area_name, a.updated_at
        );
      }
    }
    if (hasTable('venue_watch_slot_state')) {
      for (const s of prepare('SELECT * FROM venue_watch_slot_state').all()) {
        prepare('INSERT OR REPLACE INTO watch_slot_state (uniq_no, date, available, updated_at) VALUES (?, ?, ?, ?)').run(
          s.uniq_no, s.date, s.available, s.updated_at
        );
      }
    }

    // venue_watch_notifications → watch_notifications（旧数据 intent_id 置 NULL）
    if (hasTable('venue_watch_notifications')) {
      for (const n of prepare('SELECT * FROM venue_watch_notifications').all()) {
        prepare(`INSERT INTO watch_notifications
          (id, intent_id, uniq_no, area_name, date, start_time, end_time, price, success, error, created_at)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          n.id, n.uniq_no, n.area_name, n.date, n.start_time, n.end_time,
          n.price, n.success, n.error, n.created_at
        );
      }
    }

    // 旧表及 v1 废弃列随表删除
    db.run('DROP TABLE IF EXISTS venue_watch_targets');
    db.run('DROP TABLE IF EXISTS venue_lock_orders');
    db.run('DROP TABLE IF EXISTS venue_watch_config');
    db.run('DROP TABLE IF EXISTS venue_watch_areas');
    db.run('DROP TABLE IF EXISTS venue_watch_slot_state');
    db.run('DROP TABLE IF EXISTS venue_watch_notifications');
  });
}

/**
 * Prepare a statement (sql.js wrapper, auto-saves on write)
 */
function prepare(sql) {
  const stmt = db.prepare(sql);

  return {
    run(...params) {
      try {
        stmt.run(params);
        // 事务内的写入由 transaction() COMMIT 时统一 saveDatabase()，
        // 非事务写入才用 debounce 写盘，避免事务中重复触发 save。
        if (transactionDepth === 0) scheduleSave();
        return { changes: db.getRowsModified() };
      } finally {
        stmt.free();
      }
    },
    get(...params) {
      try {
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const obj = {};
          cols.forEach((c, i) => { obj[c] = vals[i]; });
          return obj;
        }
        return null;
      } finally {
        stmt.free();
      }
    },
    all(...params) {
      try {
        stmt.bind(params);
        const rows = [];
        const cols = stmt.getColumnNames();
        while (stmt.step()) {
          const vals = stmt.get();
          const obj = {};
          cols.forEach((c, i) => { obj[c] = vals[i]; });
          rows.push(obj);
        }
        return rows;
      } finally {
        stmt.free();
      }
    }
  };
}

/**
 * Execute raw SQL (for DDL statements)
 */
function exec(sql) {
  db.run(sql);
  scheduleSave();
}

/**
 * Run a group of writes atomically.
 */
function transaction(fn) {
  if (!db) throw new Error('Database is not initialized');

  const isOuterTransaction = transactionDepth === 0;
  const savepoint = `tx_${transactionDepth}`;
  db.run(isOuterTransaction ? 'BEGIN IMMEDIATE TRANSACTION' : `SAVEPOINT ${savepoint}`);
  transactionDepth += 1;

  try {
    const result = fn();
    transactionDepth -= 1;
    db.run(isOuterTransaction ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
    // 外层事务提交后立刻写盘，避免 debounce 窗口期数据丢失
    if (isOuterTransaction) saveDatabase();
    return result;
  } catch (err) {
    transactionDepth -= 1;
    db.run(isOuterTransaction ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (!isOuterTransaction) {
      db.run(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw err;
  }
}

/**
 * Schedule a debounced save
 */
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDatabase, 500);
}

/**
 * Persist database to disk
 */
function saveDatabase() {
  if (saveTimer) clearTimeout(saveTimer);
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);

  // 写盘前备份旧文件（如果存在）。备份始终是上一次成功写入的版本。
  if (fs.existsSync(DB_PATH)) {
    const backupPath = `${DB_PATH}.backup`;
    try { fs.copyFileSync(DB_PATH, backupPath); } catch (_) { /* 备份失败不阻塞写入 */ }
  }

  const tempPath = `${DB_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, DB_PATH);

  // sql.js export() resets connection-level pragmas.
  db.run('PRAGMA foreign_keys = ON');
}

/**
 * Close database (saves first)
 */
function closeDatabase() {
  if (saveTimer) clearTimeout(saveTimer);
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('[DB] Database closed');
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  prepare,
  exec,
  transaction,
  saveDatabase
};
