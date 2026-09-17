/**
 * Database configuration — sql.js SQLite wrapper
 *
 * Provides a singleton database instance with helper functions.
 * Database file lives at server/database/badminton.db
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { prefixedId } = require('../utils/id');
// venueShared 是无依赖的纯 helper（日期串 / 放票窗口常量），迁移展开 weekly 行时需要
const { BOOKING_WINDOW_DAYS, dateStr, today } = require('../services/venueShared');

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
  if (file === '017_drop_unpaid_expired.sql') {
    migrateDropUnpaidExpired();
    return;
  }
  if (file === '018_single_date_intents.sql') {
    migrateSingleDateIntents();
    return;
  }
  if (file === '019_lock_expire_at.sql') {
    migrateLockExpireAt();
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

/** 放票窗口内的日期串（todayStr 起 BOOKING_WINDOW_DAYS 天） */
function windowDates(todayStr) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const dates = [];
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    dates.push(dateStr(new Date(y, m - 1, d + i)));
  }
  return dates;
}

/**
 * weekdays（JSON 0-6 数组）→ 放票窗口内匹配的具体日期（迁移展开用）。
 * 解析失败 / 空数组 / 窗口内无匹配 → []（调用方按"无匹配"处置）。
 */
function weeklyDatesInWindow(weekdaysJson, todayStr) {
  let weekdays = null;
  try { weekdays = weekdaysJson ? JSON.parse(weekdaysJson) : null; } catch (_) { weekdays = null; }
  if (!Array.isArray(weekdays) || weekdays.length === 0) return [];
  const set = new Set(weekdays);
  return windowDates(todayStr).filter(d => set.has(new Date(`${d}T00:00:00`).getDay()));
}

/**
 * 每周意图在窗口内无匹配时，取“下一个发生日”（今天起 7 天内首个匹配星期）。
 * 这样迁移不丢配置：单日模型允许任意未来日期（D2 提前设置），该日进放票窗口后自动生效。
 * 非法/空 weekdays 返回 null（调用方删行）。
 */
function nextOccurrenceDate(weekdaysJson, todayStr) {
  let weekdays = null;
  try { weekdays = weekdaysJson ? JSON.parse(weekdaysJson) : null; } catch (_) { weekdays = null; }
  if (!Array.isArray(weekdays) || weekdays.length === 0) return null;
  const set = new Set(weekdays);
  const [y, m, d] = todayStr.split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const date = new Date(y, m - 1, d + i);
    if (set.has(date.getDay())) return dateStr(date);
  }
  return null;
}

/** booking_intents 单行插入（迁移共用；调用方保证单日模型字段完整） */
function insertDateIntent({ id, mode, date, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled, createdAt, updatedAt }) {
  prepare(`INSERT INTO booking_intents
    (id, mode, date, window_start, window_end, duration_hours, courts_needed, preferred_area_ids, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, mode, date, windowStart, windowEnd, durationHours, courtsNeeded, preferredAreaIds, enabled, createdAt, updatedAt
  );
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
    // schema.sql 已是单日模型（无 weekdays 列）：v1 的 weekly 目标在导入时即按放票窗口
    // 展开为 date 意图（与 018 同规则），窗口内无匹配则整条丢弃并记名单。
    const droppedTargets = [];
    const todayStr = today();
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
      const dates = t.weekdays ? weeklyDatesInWindow(t.weekdays, todayStr) : [t.date];
      if (!dates.length || !dates[0]) {
        droppedTargets.push(t.id);
        continue;
      }
      for (const date of dates) {
        insertDateIntent({
          // 单日目标沿用原 id（锁场记录仍可关联）；weekly 展开的多个日期各自新 id
          id: dates.length === 1 ? t.id : prefixedId('int'),
          mode: t.auto_lock ? 'auto_lock' : 'notify',
          date,
          windowStart,
          windowEnd,
          durationHours,
          courtsNeeded: Math.min(3, Math.max(1, t.max_locks_per_slot || 1)),
          preferredAreaIds: t.area_ids || '[]',
          enabled: t.enabled,
          createdAt: t.created_at,
          updatedAt: t.updated_at
        });
      }
    }
    if (droppedTargets.length) {
      console.log(`[DB] migration 016: ${droppedTargets.length} 条每周意图在放票窗口（${todayStr} 起 ${BOOKING_WINDOW_DAYS} 天）内无匹配日期，已删除: ${droppedTargets.join(', ')}`);
    }

    // venue_lock_orders → booking_intent_locks
    if (hasTable('venue_lock_orders')) {
      for (const l of prepare('SELECT * FROM venue_lock_orders').all()) {
        prepare(`INSERT INTO booking_intent_locks
          (id, intent_id, uniq_no, date, start_time, end_time, area_id, area_name, order_id, status, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
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
 * 017: 移除支付跟踪，booking_intent_locks 删 unpaid_expired_count
 * （见 migrations/017_drop_unpaid_expired.sql）。hasColumn 幂等。
 */
function migrateDropUnpaidExpired() {
  if (hasColumn('booking_intent_locks', 'unpaid_expired_count')) {
    db.run('ALTER TABLE booking_intent_locks DROP COLUMN unpaid_expired_count');
  }
}

/**
 * 018: 单日模型 + 锁场失败结构化错误码（见 migrations/018_single_date_intents.sql）。
 *
 * 1) booking_intent_locks 加 error_code 列（hasColumn 幂等），并按历史中文 error 文本
 *    回填能可靠判定的记录（风控 / 未支付 / 限订），其余留 NULL（不猜）。
 * 2) 若 booking_intents 仍有 weekdays 列：weekly 行按当前放票窗口展开为 date 意图
 *    （字段复制 + enabled 继承），原行删除；窗口内无匹配的行整体删除并在日志记名单。
 * 3) 删 booking_intents.weekdays 列（列已不存在 = 已迁移 / 新库，自然跳过）。
 *
 * 整体事务保证原子性；仅在 weekdays 列存在时展开，保证重复启动不重复展开。
 */
function migrateSingleDateIntents() {
  transaction(() => {
    if (!hasColumn('booking_intent_locks', 'error_code')) {
      db.run('ALTER TABLE booking_intent_locks ADD COLUMN error_code TEXT');
    }
    // 回填：只认能可靠判定的文案（error_code IS NULL 保证幂等）
    db.run(`UPDATE booking_intent_locks SET error_code = 'RISK_CONTROL' WHERE error_code IS NULL AND error LIKE '%风控%'`);
    db.run(`UPDATE booking_intent_locks SET error_code = 'UNPAID' WHERE error_code IS NULL AND error LIKE '%未支付%'`);
    db.run(`UPDATE booking_intent_locks SET error_code = 'LIMIT' WHERE error_code IS NULL AND error LIKE '%限订%'`);
    db.run(`UPDATE booking_intent_locks SET error_code = 'SOLDOUT' WHERE error_code IS NULL AND (error LIKE '%已被预订%' OR error LIKE '%已预订%')`);

    if (!hasColumn('booking_intents', 'weekdays')) return; // 已迁移 / 新库：无 weekly 行可展开

    const todayStr = today();
    const dropped = [];
    const carried = [];
    for (const row of prepare('SELECT * FROM booking_intents WHERE weekdays IS NOT NULL').all()) {
      let dates = weeklyDatesInWindow(row.weekdays, todayStr);
      // 窗口内无匹配：不删配置，展开为“下一个发生日”（D2：任意未来日期可提前设置）
      if (!dates.length) {
        const next = nextOccurrenceDate(row.weekdays, todayStr);
        if (next) {
          dates = [next];
          carried.push(`${row.id}→${next}`);
        }
      }
      if (!dates.length) { // 非法/空 weekdays：无法展开，删行记名单
        dropped.push(row.id);
        prepare('DELETE FROM booking_intents WHERE id = ?').run(row.id);
        continue;
      }
      for (const date of dates) {
        insertDateIntent({
          id: prefixedId('int'),
          mode: row.mode,
          date,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          durationHours: row.duration_hours,
          courtsNeeded: row.courts_needed,
          preferredAreaIds: row.preferred_area_ids,
          enabled: row.enabled,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        });
      }
      prepare('DELETE FROM booking_intents WHERE id = ?').run(row.id);
    }
    if (carried.length) {
      console.log(`[DB] migration 018: ${carried.length} 条每周意图在放票窗口（${todayStr} 起 ${BOOKING_WINDOW_DAYS} 天）内无匹配，已展开为下一个发生日: ${carried.join(', ')}`);
    }
    if (dropped.length) {
      console.log(`[DB] migration 018: ${dropped.length} 条每周意图 weekdays 非法或为空，无法展开，已删除: ${dropped.join(', ')}`);
    }

    db.run('ALTER TABLE booking_intents DROP COLUMN weekdays');
  });
}

/**
 * 019: booking_intent_locks 加 expire_at（未支付订单自动释放时刻，UTC）。
 * 只加列不回填：历史行 expire_at 为 NULL（推送文案退回“约 5 分钟”口径）。
 */
function migrateLockExpireAt() {
  if (!hasColumn('booking_intent_locks', 'expire_at')) {
    db.run('ALTER TABLE booking_intent_locks ADD COLUMN expire_at TEXT');
  }
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
