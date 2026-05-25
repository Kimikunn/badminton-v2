const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-audit-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const { auditDatabase } = require('../scripts/audit-data-integrity');
const { initDatabase, closeDatabase, prepare, saveDatabase } = require('../src/config/db');

test.before(async () => {
  await initDatabase();
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('audit reports no errors for a clean schema-only database', async () => {
  saveDatabase();
  const report = await auditDatabase(process.env.DB_PATH);

  assert.equal(report.summary.errors, 0);
  assert.equal(report.counts.matches, 0);
  assert.deepEqual(report.issues, []);
});

test('audit detects PA7 matches completed before all games are played', async () => {
  prepare(`INSERT INTO matches (id, type, team_a, team_b, best_of, match_format, status, winner)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'M-AUDIT-PA7',
      'doubles',
      JSON.stringify(['p1', 'p2']),
      JSON.stringify(['p3', 'p4']),
      7,
      'pa7',
      'completed',
      'a'
    );
  for (let i = 1; i <= 4; i++) {
    prepare('INSERT INTO games (id, match_id, game_no, score_a, score_b, winner, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`M-AUDIT-PA7-G${i}`, 'M-AUDIT-PA7', i, 21, 10, 'a', 'completed');
  }
  saveDatabase();

  const report = await auditDatabase(process.env.DB_PATH);
  const codes = report.issues.map(issue => issue.code);

  assert.ok(report.summary.errors >= 1);
  assert.ok(codes.includes('STARTED_MATCH_MISSING_GAMES'));
  assert.ok(codes.includes('COMPLETED_MATCH_INCOMPLETE_BY_RULE'));
  assert.ok(codes.includes('PA7_COMPLETED_BEFORE_ALL_GAMES'));
});


test('audit detects mismatched match format for seven-game matches', async () => {
  prepare(`INSERT INTO matches (id, type, team_a, team_b, best_of, match_format, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'M-AUDIT-FORMAT',
      'doubles',
      JSON.stringify(['p1', 'p2']),
      JSON.stringify(['p3', 'p4']),
      7,
      'bo3',
      'pending'
    );
  saveDatabase();

  const report = await auditDatabase(process.env.DB_PATH);
  const issue = report.issues.find(item => item.code === 'MATCH_FORMAT_MISMATCH' && item.details.matchId === 'M-AUDIT-FORMAT');

  assert.ok(issue);
  assert.equal(issue.details.expectedMatchFormat, 'pa7');
});
