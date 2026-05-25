const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const initSqlJs = require('sql.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-repair-test-'));

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function createLegacyDb(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      total_rounds INTEGER DEFAULT 7,
      best_of INTEGER DEFAULT 3,
      status TEXT DEFAULT 'pending',
      participants TEXT,
      rule_id TEXT DEFAULT 'standard'
    );
    CREATE TABLE rounds (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      round_no INTEGER NOT NULL,
      status TEXT DEFAULT 'pending'
    );
    CREATE TABLE matches (
      id TEXT PRIMARY KEY,
      season_id TEXT,
      round_id TEXT,
      type TEXT DEFAULT 'doubles',
      team_a TEXT,
      team_b TEXT,
      best_of INTEGER DEFAULT 3,
      status TEXT DEFAULT 'pending',
      winner TEXT,
      date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE games (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      game_no INTEGER NOT NULL,
      score_a INTEGER DEFAULT 0,
      score_b INTEGER DEFAULT 0,
      winner TEXT,
      status TEXT DEFAULT 'pending'
    );
  `);
  db.run('INSERT INTO seasons (id, name, best_of, participants) VALUES (?, ?, ?, ?)', ['S-LEGACY', 'Legacy', 3, '[]']);
  db.run('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)', ['R-LEGACY', 'S-LEGACY', 1, 'in_progress']);
  db.run(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ['M-LEGACY', 'S-LEGACY', 'R-LEGACY', 'doubles', '[]', '[]', 3, 'in_progress']);
  db.run(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ['M-LEGACY-PA7', 'S-LEGACY', 'R-LEGACY', 'doubles', '[]', '[]', 7, 'pending']);
  db.run('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)', ['M-LEGACY-G1', 'M-LEGACY', 1, 'completed']);
  db.run('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)', ['G-ORPHAN', 'M-MISSING', 1, 'completed']);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

test('repair script dry-run supports legacy databases without match_format', async () => {
  const dbPath = path.join(tempDir, 'legacy.db');
  await createLegacyDb(dbPath);

  const output = execFileSync(process.execPath, ['scripts/repair-relationships.js', `--db=${dbPath}`], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  const report = JSON.parse(output);

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.addedMatchFormatColumn, true);
  assert.equal(report.deletedOrphanGames, 1);
  assert.equal(report.insertedMissingGames, 2);
  assert.equal(report.filledMatchFormat, 1);

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const columns = db.exec('PRAGMA table_info(matches)')[0].values.map(row => row[1]);
  const gameCount = db.exec('SELECT COUNT(*) FROM games')[0].values[0][0];
  db.close();

  assert.equal(columns.includes('match_format'), false);
  assert.equal(gameCount, 2);
});
