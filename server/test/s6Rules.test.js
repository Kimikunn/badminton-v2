const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  prepare,
  setupTestDb,
  closeTestDb,
  insertSeason,
  getDbMatch,
  getDbRound,
  getDbGames,
  getDbMatchesByRound,
  startMatch,
  finishGame
} = createTestHarness('badminton-s6-test-');

const { getRule } = require('../src/rules');

test.before(async () => {
  await setupTestDb({ players: ['p1', 'p2', 'p3', 'p4'] });
});

test.after(() => {
  closeTestDb();
});

function insertS6Season(id) {
  insertSeason({ id, ruleId: 's6', totalRounds: 7 });
}

function kingRolls(kingId, dice = 6) {
  return ['p1', 'p2', 'p3', 'p4'].map((playerId, index) => ({
    playerId,
    dice: playerId === kingId ? dice : index + 1
  }));
}

function postAction(seasonId, actionId, body) {
  return api.post(`/api/seasons/${seasonId}/actions/${actionId}`).send(body);
}

async function completeKingSelection(seasonId, roundNo, kingId, form) {
  await postAction(seasonId, 's6_king_roll', { roundNo, rolls: kingRolls(kingId) }).expect(200);
  await postAction(seasonId, 's6_king_form', { roundNo, form }).expect(200);
}

test('s6_king_roll persists topKings with the unique highest roller as king', async () => {
  insertS6Season('S-S6-ROLL');

  const res = await postAction('S-S6-ROLL', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 3 },
      { playerId: 'p2', dice: 6 },
      { playerId: 'p3', dice: 1 },
      { playerId: 'p4', dice: 4 }
    ]
  }).expect(200);

  const topKing = res.body.data.comebackData.s6.topKings['1'];
  assert.equal(topKing.kingId, 'p2');
  assert.equal(topKing.form, null);
  assert.equal(topKing.rolls.length, 4);

  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get('S-S6-ROLL');
  assert.equal(JSON.parse(season.comeback_data).s6.topKings['1'].kingId, 'p2');
});

test('s6_king_roll rejects ties, non-participants, bad dice and duplicate submissions', async () => {
  insertS6Season('S-S6-ROLL-BAD');

  const tie = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 6 },
      { playerId: 'p2', dice: 6 },
      { playerId: 'p3', dice: 1 },
      { playerId: 'p4', dice: 4 }
    ]
  }).expect(422);
  assert.match(tie.body.error.message, /并列/);

  const outsider = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 3 },
      { playerId: 'p2', dice: 6 },
      { playerId: 'p3', dice: 1 },
      { playerId: 'p9', dice: 4 }
    ]
  }).expect(422);
  assert.match(outsider.body.error.message, /非本赛季选手/);

  const badDice = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 3 },
      { playerId: 'p2', dice: 7 },
      { playerId: 'p3', dice: 1 },
      { playerId: 'p4', dice: 4 }
    ]
  }).expect(422);
  assert.match(badDice.body.error.message, /1-6/);

  const missing = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 3 },
      { playerId: 'p2', dice: 6 },
      { playerId: 'p3', dice: 1 }
    ]
  }).expect(422);
  assert.match(missing.body.error.message, /全部 4 名/);

  const wrongRound = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 5,
    rolls: kingRolls('p2')
  }).expect(422);
  assert.match(wrongRound.body.error.message, /第 1-4 轮/);

  await postAction('S-S6-ROLL-BAD', 's6_king_roll', { roundNo: 1, rolls: kingRolls('p2') }).expect(200);
  const duplicate = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: kingRolls('p2')
  }).expect(422);
  assert.match(duplicate.body.error.message, /重复提交/);
});

test('s6_king_form validates roll-first and form values, then persists', async () => {
  insertS6Season('S-S6-FORM');

  const noRoll = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'daiqing' }).expect(422);
  assert.match(noRoll.body.error.message, /王选掷骰/);

  await postAction('S-S6-FORM', 's6_king_roll', { roundNo: 1, rolls: kingRolls('p3') }).expect(200);

  const badForm = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'xuanwu' }).expect(422);
  assert.match(badForm.body.error.message, /形态/);

  const res = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
  const topKing = res.body.data.comebackData.s6.topKings['1'];
  assert.equal(topKing.kingId, 'p3');
  assert.equal(topKing.form, 'feihong');
});

test('creating an s6 top-phase round requires king roll and form', async () => {
  insertS6Season('S-S6-ROUND');

  const noKing = await api.post('/api/rounds').send({ id: 'R-S6-ROUND-1', seasonId: 'S-S6-ROUND', roundNo: 1 }).expect(422);
  assert.match(noKing.body.error.message, /王选掷骰/);

  await postAction('S-S6-ROUND', 's6_king_roll', { roundNo: 1, rolls: kingRolls('p1') }).expect(200);

  const noForm = await api.post('/api/rounds').send({ id: 'R-S6-ROUND-1', seasonId: 'S-S6-ROUND', roundNo: 1 }).expect(422);
  assert.match(noForm.body.error.message, /形态/);

  await postAction('S-S6-ROUND', 's6_king_form', { roundNo: 1, form: 'yuebai' }).expect(200);

  const created = await api
    .post('/api/rounds')
    .send({ id: 'R-S6-ROUND-1', seasonId: 'S-S6-ROUND', roundNo: 1 })
    .expect(201);
  assert.equal(created.body.data.beforeRoundSetup.type, 'king_selection');
  assert.equal(created.body.data.beforeRoundSetup.topKing.kingId, 'p1');

  const matches = getDbMatchesByRound('R-S6-ROUND-1');
  assert.equal(matches.length, 3);
  assert.ok(matches.every(m => m.match_format === 'bo3'));

  const locked = await postAction('S-S6-ROUND', 's6_king_form', { roundNo: 1, form: 'daiqing' }).expect(422);
  assert.match(locked.body.error.message, /该轮已创建/);
});

test('s6 second-phase rounds (5-7) require soul bond completion before creation', async () => {
  insertS6Season('S-S6-LATE');

  const blocked = await api
    .post('/api/rounds')
    .send({ id: 'R-S6-LATE-5', seasonId: 'S-S6-LATE', roundNo: 5 })
    .expect(422);

  assert.match(blocked.body.error.message, /灵魂契合/);
  assert.equal(getDbMatchesByRound('R-S6-LATE-5').length, 0);
});

test('daiqing form gives the king side a 2:0 opening score on every started game', async () => {
  insertS6Season('S-S6-DAIQING');
  await completeKingSelection('S-S6-DAIQING', 1, 'p3', 'daiqing');
  await api.post('/api/rounds').send({ id: 'R-S6-DAIQING-1', seasonId: 'S-S6-DAIQING', roundNo: 1 }).expect(201);

  // M1: teamA [p1,p2] vs teamB [p3,p4]，王 p3 在 B 方
  let games = await startMatch('R-S6-DAIQING-1-M1');
  assert.equal(games[0].score_a, 0);
  assert.equal(games[0].score_b, 2);

  const match = getDbMatch('R-S6-DAIQING-1-M1');
  const season = prepare('SELECT * FROM seasons WHERE id = ?').get('S-S6-DAIQING');
  const config = getRule('s6').getGameConfig({
    game: games[0],
    match,
    season,
    round: getDbRound('R-S6-DAIQING-1'),
    ruleId: 's6'
  });
  assert.equal(config.targetScore, 21);
  assert.equal(config.openingScoreA, 0);
  assert.equal(config.openingScoreB, 2);
  assert.equal(config.kingId, 'p3');
  assert.equal(config.kingForm, 'daiqing');

  // 开局分计入局比分：从 0:2 打到 21:19 可正常结束，下一局同样 0:2 开局
  await finishGame(games[0].id, 21, 19);
  games = getDbGames('R-S6-DAIQING-1-M1');
  assert.deepEqual(games.map(g => g.status), ['completed', 'in_progress', 'pending']);
  assert.equal(games[1].score_a, 0);
  assert.equal(games[1].score_b, 2);
});

test('feihong and yuebai forms start games at 0:0', async () => {
  insertS6Season('S-S6-FEIHONG');
  await completeKingSelection('S-S6-FEIHONG', 1, 'p1', 'feihong');
  await api.post('/api/rounds').send({ id: 'R-S6-FEIHONG-1', seasonId: 'S-S6-FEIHONG', roundNo: 1 }).expect(201);

  const games = await startMatch('R-S6-FEIHONG-1-M1');
  assert.equal(games[0].score_a, 0);
  assert.equal(games[0].score_b, 0);

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch('R-S6-FEIHONG-1-M1'),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-S6-FEIHONG'),
    round: getDbRound('R-S6-FEIHONG-1'),
    ruleId: 's6'
  });
  assert.equal(config.openingScoreA, 0);
  assert.equal(config.openingScoreB, 0);
  assert.equal(config.kingForm, 'feihong');
});

test('s6 games still validate standard 21-point endings', async () => {
  insertS6Season('S-S6-END');
  await completeKingSelection('S-S6-END', 1, 'p2', 'yuebai');
  await api.post('/api/rounds').send({ id: 'R-S6-END-1', seasonId: 'S-S6-END', roundNo: 1 }).expect(201);
  const games = await startMatch('R-S6-END-1-M1');

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 20, scoreB: 18 }).expect(200);
  await api.post(`/api/games/${games[0].id}/end`).expect(422);

  await finishGame(games[0].id, 21, 18);
  assert.equal(getDbGames('R-S6-END-1-M1')[0].winner, 'a');
});
