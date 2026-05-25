const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-integrity-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { initDatabase, closeDatabase, prepare } = require('../src/config/db');

test.before(async () => {
  await initDatabase();
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('database rejects duplicate round numbers within the same season', () => {
  prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('S-IDX', 'Index Season', 7, 3, 'ongoing', '[]', 'standard');
  prepare('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)')
    .run('R-IDX-1', 'S-IDX', 1, 'pending');

  assert.throws(() => {
    prepare('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)')
      .run('R-IDX-2', 'S-IDX', 1, 'pending');
  }, /UNIQUE constraint failed/);
});

test('database rejects duplicate game numbers within the same match', () => {
  prepare(`INSERT INTO matches (id, type, team_a, team_b, best_of, match_format, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('M-IDX', 'doubles', '[]', '[]', 3, 'bo3', 'pending');
  prepare('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)')
    .run('M-IDX-G1', 'M-IDX', 1, 'pending');

  assert.throws(() => {
    prepare('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)')
      .run('M-IDX-G1-DUP', 'M-IDX', 1, 'pending');
  }, /UNIQUE constraint failed/);
});


test('database rejects games whose parent match does not exist', () => {
  assert.throws(() => {
    prepare('INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)')
      .run('G-ORPHAN', 'M-NOT-EXIST', 1, 'pending');
  }, /FOREIGN KEY constraint failed/);
});
