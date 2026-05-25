const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-validation-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const { initDatabase, closeDatabase, prepare } = require('../src/config/db');

function assertValidation(res, messagePattern) {
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.match(res.body.error.message, messagePattern);
}

test.before(async () => {
  await initDatabase();
  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    prepare('INSERT INTO players (id, name) VALUES (?, ?)').run(id, id);
  }
  prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'S-VALID',
      'Validation Season',
      7,
      3,
      'ongoing',
      JSON.stringify(['p1', 'p2', 'p3', 'p4']),
      'standard'
    );
  prepare('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)')
    .run('R-VALID', 'S-VALID', 1, 'pending');
  prepare(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, match_format, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'M-VALID',
      'S-VALID',
      'R-VALID',
      'doubles',
      JSON.stringify(['p1', 'p2']),
      JSON.stringify(['p3', 'p4']),
      3,
      'bo3',
      'pending'
    );
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('POST /api/rounds rejects missing roundNo with validation error', async () => {
  const res = await request(app)
    .post('/api/rounds')
    .send({ id: 'R-INVALID', seasonId: 'S-VALID' })
    .expect(422);

  assertValidation(res, /轮次编号/);
});

test('POST /api/matches rejects mismatched bestOf and matchFormat', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ teamA: ['p1'], teamB: ['p2'], bestOf: 7, matchFormat: 'bo3' })
    .expect(422);

  assertValidation(res, /应使用赛制 pa7/);
});

test('POST /api/matches rejects duplicated player across teams', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ teamA: ['p1'], teamB: ['p1'], bestOf: 1 })
    .expect(422);

  assertValidation(res, /两队不能包含同一名选手/);
});

test('PUT /api/games/:id/score rejects non-integer scores', async () => {
  await request(app).post('/api/matches/M-VALID/start').expect(200);
  const game = prepare('SELECT id FROM games WHERE match_id = ? AND status = ?').get('M-VALID', 'in_progress');

  const res = await request(app)
    .put(`/api/games/${game.id}/score`)
    .send({ scoreA: 21, scoreB: '19' })
    .expect(422);

  assertValidation(res, /B队比分/);
});


test('POST /api/matches returns HTTP 201 without leaking numeric meta', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ teamA: ['p1'], teamB: ['p2'], bestOf: 1 })
    .expect(201);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.bestOf, 1);
  assert.equal(res.body.data.matchFormat, 'bo1');
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'meta'), false);
});


test('POST /api/matches maps duplicate IDs to stable conflict errors', async () => {
  await request(app)
    .post('/api/matches')
    .send({ id: 'F-DUPLICATE-ID', teamA: ['p1'], teamB: ['p2'], bestOf: 1 })
    .expect(201);

  const res = await request(app)
    .post('/api/matches')
    .send({ id: 'F-DUPLICATE-ID', teamA: ['p3'], teamB: ['p4'], bestOf: 1 })
    .expect(409);

  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'CONFLICT');
  assert.equal(res.body.error.message, '数据已存在，不能重复创建');
  assert.doesNotMatch(JSON.stringify(res.body), /UNIQUE constraint failed/);
});


test('POST /api/matches rejects unsupported bestOf values', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ teamA: ['p1'], teamB: ['p2'], bestOf: 0 })
    .expect(422);

  assertValidation(res, /比赛局数只支持/);
});

test('POST /api/upload/avatar rejects unsupported avatar payloads', async () => {
  const missing = await request(app)
    .post('/api/upload/avatar')
    .send({})
    .expect(422);
  assertValidation(missing, /缺少图片数据/);

  const spoofed = await request(app)
    .post('/api/upload/avatar')
    .send({ image: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}` })
    .expect(422);
  assertValidation(spoofed, /图片内容与格式不匹配/);
});

test('POST /api/seasons validates rule IDs and participant references', async () => {
  const badRule = await request(app)
    .post('/api/seasons')
    .send({ name: 'Bad Rule', ruleId: 'unknown' })
    .expect(422);
  assertValidation(badRule, /规则ID/);

  const missingPlayer = await request(app)
    .post('/api/seasons')
    .send({ name: 'Missing Player', participants: ['p1', 'p404'] })
    .expect(422);
  assertValidation(missingPlayer, /参赛选手不存在/);
});

test('venue CRUD is available at /api/venues and validates input', async () => {
  const invalid = await request(app)
    .post('/api/venues')
    .send({ name: '', hourlyRate: -1 })
    .expect(422);
  assertValidation(invalid, /场地名称/);

  const created = await request(app)
    .post('/api/venues')
    .send({ name: 'Test Court', address: 'Road 1', hourlyRate: 88, notes: '' })
    .expect(201);

  assert.equal(created.body.success, true);
  assert.match(created.body.data.id, /^v-/);
  assert.equal(created.body.data.hourlyRate, 88);

  const updated = await request(app)
    .put(`/api/bookings/venues/${created.body.data.id}`)
    .send({ hourlyRate: 99 })
    .expect(200);

  assert.equal(updated.body.data.hourlyRate, 99);
});

test('booking records validate player and venue references', async () => {
  const venue = await request(app)
    .post('/api/venues')
    .send({ name: 'Booking Court', hourlyRate: 66 })
    .expect(201);

  const missingPlayer = await request(app)
    .post('/api/bookings/records')
    .send({ playerId: 'p404', venueId: venue.body.data.id, date: '2026-05-24' })
    .expect(422);
  assertValidation(missingPlayer, /订场人不存在/);

  const created = await request(app)
    .post('/api/bookings/records')
    .send({ playerId: 'p1', venueId: venue.body.data.id, date: '2026-05-24', cost: 66 })
    .expect(201);

  assert.equal(created.body.success, true);
  assert.equal(created.body.data.playerId, 'p1');
  assert.equal(created.body.data.venueId, venue.body.data.id);
  assert.equal(typeof created.body.data.id, 'number');
});
