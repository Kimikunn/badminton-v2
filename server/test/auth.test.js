const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_TOKEN = 'test-admin-token';

const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  setupTestDb,
  closeTestDb
} = createTestHarness('badminton-auth-test-');

test.before(async () => {
  await setupTestDb();
});

test.after(() => {
  closeTestDb();
  delete process.env.ADMIN_TOKEN;
});

test('read endpoints do not require admin token when write auth is enabled', async () => {
  await api.get('/api/health').expect(200);

  const res = await api.get('/api/matches').expect(200);
  assert.equal(res.body.success, true);
});

test('write endpoints require a configured admin token', async () => {
  const missing = await api
    .post('/api/venues')
    .send({ name: 'Auth Court' })
    .expect(401);

  assert.equal(missing.body.success, false);
  assert.equal(missing.body.error.code, 'UNAUTHORIZED');

  const wrong = await api
    .post('/api/venues')
    .set('x-admin-token', 'wrong-token')
    .send({ name: 'Auth Court' })
    .expect(403);

  assert.equal(wrong.body.success, false);
  assert.equal(wrong.body.error.code, 'FORBIDDEN');
});

test('write endpoints accept x-admin-token and bearer tokens', async () => {
  const created = await api
    .post('/api/venues')
    .set('x-admin-token', 'test-admin-token')
    .send({ name: 'Auth Court', hourlyRate: 80 })
    .expect(201);

  assert.equal(created.body.success, true);

  const updated = await api
    .put(`/api/venues/${created.body.data.id}`)
    .set('authorization', 'Bearer test-admin-token')
    .send({ notes: 'authorized' })
    .expect(200);

  assert.equal(updated.body.success, true);
  assert.equal(updated.body.data.notes, 'authorized');
});
