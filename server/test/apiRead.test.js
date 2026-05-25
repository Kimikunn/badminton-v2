const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-api-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const { initDatabase, closeDatabase } = require('../src/config/db');

test.before(async () => {
  await initDatabase();
});

test.after(() => {
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('GET /api/health returns the unified success shape', async () => {
  const res = await request(app).get('/api/health').expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ok');
  assert.match(res.body.data.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET /api/matches returns an array in the unified response shape', async () => {
  const res = await request(app).get('/api/matches').expect(200);

  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
});

test('GET /api/games returns an array in the unified response shape', async () => {
  const res = await request(app).get('/api/games').expect(200);

  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
});
