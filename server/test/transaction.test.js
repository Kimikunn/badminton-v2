const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-transaction-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const { initDatabase, closeDatabase, prepare, transaction } = require('../src/config/db');

test.before(async () => {
  await initDatabase();
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('transaction rolls back direct writes after an error', () => {
  assert.throws(() => {
    transaction(() => {
      prepare('INSERT INTO seasons (id, name, participants) VALUES (?, ?, ?)')
        .run('S-TX-DIRECT', 'Rollback Season', '[]');
      throw new Error('force rollback');
    });
  }, /force rollback/);

  const row = prepare('SELECT id FROM seasons WHERE id = ?').get('S-TX-DIRECT');
  assert.equal(row, null);
});

test('round creation rollback leaves no partial round if generated match insert fails', async () => {
  prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'S-TX-ROUND',
      'Round Rollback Season',
      7,
      3,
      'ongoing',
      JSON.stringify(['p1', 'p2', 'p3', 'p4']),
      'standard'
    );

  prepare(`INSERT INTO matches (id, type, team_a, team_b, best_of, match_format, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('R-TX-ROUND-M1', 'doubles', '[]', '[]', 3, 'bo3', 'pending');

  const res = await request(app)
    .post('/api/rounds')
    .send({ id: 'R-TX-ROUND', seasonId: 'S-TX-ROUND', roundNo: 1 })
    .expect(409);

  assert.equal(res.body.success, false);
  assert.equal(prepare('SELECT id FROM rounds WHERE id = ?').get('R-TX-ROUND'), null);
  assert.equal(prepare('SELECT COUNT(*) AS c FROM matches WHERE round_id = ?').get('R-TX-ROUND').c, 0);
});
