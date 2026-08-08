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

// S6 下篇：种子的完整灵魂契合数据（双方投掷 + 各选 1 奖，总点数 7 → 第二阶）
function s6CompletedSoulBond(roundNo) {
  const labelsByRound = { 5: ['AB', 'CD'], 6: ['AC', 'BD'], 7: ['AD', 'BC'] };
  const seedOf = { A: 'p1', B: 'p2', C: 'p3', D: 'p4' };
  const bond = {};
  for (const label of labelsByRound[roundNo]) {
    const [first, second] = label.split('').map(key => seedOf[key]);
    bond[label] = {
      rolls: [
        { playerId: first, rollChoice: 1, dice: [3], used: 3 },
        { playerId: second, rollChoice: 1, dice: [4], used: 4 }
      ],
      total: 7,
      unlockTier: 2,
      picks: [
        { playerId: first, cardId: 'pause' },
        { playerId: second, cardId: 'blade' }
      ],
      rerollsUsed: []
    };
  }
  return { [String(roundNo)]: bond };
}

test('creating S6 combo rounds generates one PA7 match with fixed pairings', async () => {
  insertSeason({ id: 'S-ROUND-S6', ruleId: 's6' });

  const expected = {
    5: { teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] },
    6: { teamA: ['p1', 'p3'], teamB: ['p2', 'p4'] },
    7: { teamA: ['p1', 'p4'], teamB: ['p2', 'p3'] }
  };

  for (const roundNo of [5, 6, 7]) {
    prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?')
      .run(JSON.stringify({ s6: { soulBond: s6CompletedSoulBond(roundNo) } }), 'S-ROUND-S6');

    const res = await api
      .post('/api/rounds')
      .send({ id: `R-ROUND-S6-${roundNo}`, seasonId: 'S-ROUND-S6', roundNo })
      .expect(201);

    const matches = getDbMatchesByRound(`R-ROUND-S6-${roundNo}`);

    assert.equal(res.body.data.matchCount, 1);
    assert.equal(res.body.data.beforeRoundSetup.type, 'soul_bond');
    assert.equal(matches[0].best_of, 7);
    assert.equal(matches[0].match_format, 'pa7');
    assert.deepEqual(JSON.parse(matches[0].team_a), expected[roundNo].teamA);
    assert.deepEqual(JSON.parse(matches[0].team_b), expected[roundNo].teamB);

    prepare("UPDATE matches SET status = 'completed', winner = 'a' WHERE round_id = ?").run(`R-ROUND-S6-${roundNo}`);
    prepare("UPDATE rounds SET status = 'completed' WHERE id = ?").run(`R-ROUND-S6-${roundNo}`);
  }
});

test('S6 combo round uses persisted seeds when present', async () => {
  insertSeason({
    id: 'S-ROUND-S6-SEEDS',
    ruleId: 's6',
    comebackData: {
      s6: {
        seeds: { A: 'p3', B: 'p1', C: 'p4', D: 'p2' },
        soulBond: s6CompletedSoulBond(5)
      }
    }
  });

  const res = await api
    .post('/api/rounds')
    .send({ id: 'R-ROUND-S6-SEEDS-5', seasonId: 'S-ROUND-S6-SEEDS', roundNo: 5 })
    .expect(201);

  const matches = getDbMatchesByRound('R-ROUND-S6-SEEDS-5');
  assert.equal(res.body.data.matchCount, 1);
  assert.deepEqual(JSON.parse(matches[0].team_a), ['p3', 'p1']);
  assert.deepEqual(JSON.parse(matches[0].team_b), ['p4', 'p2']);
});

test('creating an S6 combo round rejects random pairings', async () => {
  insertSeason({
    id: 'S-ROUND-S6-NORANDOM',
    ruleId: 's6',
    comebackData: { s6: { soulBond: s6CompletedSoulBond(5) } }
  });

  const blocked = await api
    .post('/api/rounds')
    .send({
      id: 'R-ROUND-S6-NORANDOM-5',
      seasonId: 'S-ROUND-S6-NORANDOM',
      roundNo: 5,
      pairings: [
        { teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] },
        { teamA: ['p1', 'p3'], teamB: ['p2', 'p4'] },
        { teamA: ['p1', 'p4'], teamB: ['p2', 'p3'] }
      ]
    })
    .expect(422);

  assert.match(blocked.body.error.message, /S6组合赛轮次不支持随机对阵/);
  assert.equal(getDbMatchesByRound('R-ROUND-S6-NORANDOM-5').length, 0);
});
