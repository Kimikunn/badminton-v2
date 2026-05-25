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

/**
 * Prepare a statement (sql.js wrapper, auto-saves on write)
 */
function prepare(sql) {
  const stmt = db.prepare(sql);

  return {
    run(...params) {
      try {
        stmt.run(params);
        scheduleSave();
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
    scheduleSave();
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
