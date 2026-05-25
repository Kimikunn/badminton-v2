const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-migration-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDatabase, closeDatabase } = require('../src/config/db');

async function readDb(fn) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('match_format migration is safe when the column already exists but migration is unmarked', async () => {
  await initDatabase();
  closeDatabase();

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(process.env.DB_PATH));
  db.run(`DELETE FROM _migrations WHERE name = ?`, ['001_add_match_format.sql']);
  fs.writeFileSync(process.env.DB_PATH, Buffer.from(db.export()));
  db.close();

  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => {
    const columns = db.exec('PRAGMA table_info(matches)')[0].values.map(row => row[1]);
    const applied = db.exec(`SELECT COUNT(*) FROM _migrations WHERE name = '001_add_match_format.sql'`)[0].values[0][0];
    return { columns, applied };
  });

  assert.ok(state.columns.includes('match_format'));
  assert.equal(state.applied, 1);
});


test('match_format migration normalizes seven-game legacy matches to PA7', async () => {
  closeDatabase();
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE rounds (
      id TEXT PRIMARY KEY,
      season_id TEXT,
      round_no INTEGER,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      season_id TEXT,
      round_id TEXT,
      best_of INTEGER DEFAULT 3,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      match_id TEXT,
      game_no INTEGER,
      status TEXT DEFAULT 'pending'
    );
  `);
  db.run('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)', ['R-LEGACY', 'S-LEGACY', 1, 'pending']);
  db.run('INSERT INTO matches (id, season_id, round_id, best_of, status) VALUES (?, ?, ?, ?, ?)', ['M-LEGACY-PA7', 'S-LEGACY', 'R-LEGACY', 7, 'pending']);
  fs.writeFileSync(process.env.DB_PATH, Buffer.from(db.export()));
  db.close();

  await initDatabase();
  closeDatabase();

  const state = await readDb((db) => {
    return db.exec(`SELECT match_format FROM matches WHERE id = 'M-LEGACY-PA7'`)[0].values[0][0];
  });

  assert.equal(state, 'pa7');
});
