const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  prepare,
  setupTestDb,
  closeTestDb,
  insertSeason,
  getDbMatchesByRound
} = createTestHarness('badminton-round-creation-test-');

test.before(async () => {
  await setupTestDb();
});

test.after(() => {
  closeTestDb();
});

test('creating a standard round generates three BO3 matches', async () => {
  insertSeason({ id: 'S-ROUND-STANDARD' });

  const res = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-STANDARD-1', seasonId: 'S-ROUND-STANDARD', roundNo: 1 })
    .expect(201);

  const matches = getDbMatchesByRound('R-ROUND-STANDARD-1');

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'in_progress');
  assert.equal(res.body.data.matchCount, 3);
  assert.equal(res.body.data.matches.length, 3);
  assert.equal(res.body.data.season.id, 'S-ROUND-STANDARD');
  assert.deepEqual(matches.map(m => m.best_of), [3, 3, 3]);
  assert.deepEqual(matches.map(m => m.match_format), ['bo3', 'bo3', 'bo3']);
  assert.deepEqual(matches.map(m => JSON.parse(m.team_a)), [['p1', 'p2'], ['p1', 'p3'], ['p1', 'p4']]);
  assert.deepEqual(matches.map(m => JSON.parse(m.team_b)), [['p3', 'p4'], ['p2', 'p4'], ['p2', 'p3']]);
});

test('creating a standard round accepts validated custom random pairings', async () => {
  insertSeason({ id: 'S-ROUND-CUSTOM-PAIRINGS' });

  const pairings = [
    { teamA: ['p3', 'p4'], teamB: ['p1', 'p2'] },
    { teamA: ['p3', 'p1'], teamB: ['p4', 'p2'] },
    { teamA: ['p3', 'p2'], teamB: ['p4', 'p1'] }
  ];

  const res = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-CUSTOM-PAIRINGS-1', seasonId: 'S-ROUND-CUSTOM-PAIRINGS', roundNo: 1, pairings })
    .expect(201);

  const matches = getDbMatchesByRound('R-ROUND-CUSTOM-PAIRINGS-1');

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.matchCount, 3);
  assert.deepEqual(res.body.data.matches.map(m => m.teamA), pairings.map(p => p.teamA));
  assert.deepEqual(res.body.data.matches.map(m => m.teamB), pairings.map(p => p.teamB));
  assert.deepEqual(matches.map(m => JSON.parse(m.team_a)), pairings.map(p => p.teamA));
  assert.deepEqual(matches.map(m => JSON.parse(m.team_b)), pairings.map(p => p.teamB));
});

test('creating a standard round rejects invalid custom pairings', async () => {
  insertSeason({ id: 'S-ROUND-BAD-PAIRINGS' });

  const blocked = await api
    .post('/api/rounds')
    .send({
      id: 'R-ROUND-BAD-PAIRINGS-1',
      seasonId: 'S-ROUND-BAD-PAIRINGS',
      roundNo: 1,
      pairings: [
        { teamA: ['p1', 'p1'], teamB: ['p3', 'p4'] },
        { teamA: ['p1', 'p3'], teamB: ['p2', 'p4'] },
        { teamA: ['p1', 'p4'], teamB: ['p2', 'p3'] }
      ]
    })
    .expect(422);

  assert.equal(blocked.body.success, false);
  assert.match(blocked.body.error.message, /重复选手/);
});

test('creating the next round requires the current round to be completed', async () => {
  insertSeason({ id: 'S-ROUND-GATED' });

  await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-GATED-1', seasonId: 'S-ROUND-GATED', roundNo: 1 })
    .expect(201);

  const blocked = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-GATED-2', seasonId: 'S-ROUND-GATED', roundNo: 2 })
    .expect(422);

  assert.equal(blocked.body.success, false);
  assert.match(blocked.body.error.message, /第 1 轮尚未完成/);

  prepare("UPDATE matches SET status = 'completed', winner = 'a' WHERE round_id = ?").run('R-ROUND-GATED-1');
  prepare("UPDATE rounds SET status = 'completed' WHERE id = ?").run('R-ROUND-GATED-1');

  const allowed = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-GATED-2', seasonId: 'S-ROUND-GATED', roundNo: 2 })
    .expect(201);

  assert.equal(allowed.body.success, true);
  assert.equal(allowed.body.data.roundNo, 2);
});

test('creating an S5 round requires and stores pre-round dice', async () => {
  insertSeason({
    id: 'S-ROUND-S5',
    ruleId: 's5',
    totalRounds: 10,
    comebackData: { s5: { roundDice: {}, pierceCounts: {} } }
  });

  const blocked = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-S5-1', seasonId: 'S-ROUND-S5', roundNo: 1 })
    .expect(422);

  assert.equal(blocked.body.success, false);
  assert.match(blocked.body.error.message, /必须先投骰子/);

  const created = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-S5-1', seasonId: 'S-ROUND-S5', roundNo: 1, beforeRoundSetup: { roundDice: { dice: 6 } } })
    .expect(201);

  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get('S-ROUND-S5');
  const comebackData = JSON.parse(season.comeback_data);

  assert.equal(created.body.success, true);
  assert.deepEqual(created.body.data.beforeRoundSetup, {
    timing: 'beforeRound',
    type: 'dice',
    roundDice: { dice: 6, mode: 'mutation' }
  });
  assert.deepEqual(comebackData.s5.roundDice['1'], { dice: 6, mode: 'mutation' });
});

test('creating the first round starts a pending season', async () => {
  insertSeason({ id: 'S-ROUND-PENDING', status: 'pending' });

  const created = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-PENDING-1', seasonId: 'S-ROUND-PENDING', roundNo: 1 })
    .expect(201);

  const season = prepare('SELECT status FROM seasons WHERE id = ?').get('S-ROUND-PENDING');
  assert.equal(season.status, 'ongoing');
  assert.equal(created.body.data.season.status, 'ongoing');
});

test('creating an S4 combo round generates one PA7 match', async () => {
  insertSeason({ id: 'S-ROUND-S4', ruleId: 's4' });

  const res = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-S4-5', seasonId: 'S-ROUND-S4', roundNo: 5 })
    .expect(201);

  const matches = getDbMatchesByRound('R-ROUND-S4-5');

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'in_progress');
  assert.equal(res.body.data.matchCount, 1);
  assert.equal(res.body.data.matches.length, 1);
  assert.equal(res.body.data.matches[0].matchFormat, 'pa7');
  assert.equal(matches[0].best_of, 7);
  assert.equal(matches[0].match_format, 'pa7');
  assert.deepEqual(JSON.parse(matches[0].team_a), ['p1', 'p2']);
  assert.deepEqual(JSON.parse(matches[0].team_b), ['p3', 'p4']);
});
