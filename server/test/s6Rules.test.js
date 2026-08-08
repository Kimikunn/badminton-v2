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

function insertS6Season(id, comebackData = null) {
  insertSeason({ id, ruleId: 's6', totalRounds: 7, comebackData });
}

// 生产裁决口径的王序：p3(6) > p4(重投 4) > p2(重投 1) > p1(4)。
// 同分组内重投只决定组内顺序，客户端裁决后提交；服务端按提交顺序存储、不重排。
function kingOrderInput() {
  return [
    { playerId: 'p3', dice: 6 },
    { playerId: 'p4', dice: 4, rolls: [5, 4] },
    { playerId: 'p2', dice: 1, rolls: [5, 1] },
    { playerId: 'p1', dice: 4 }
  ];
}

function postAction(seasonId, actionId, body) {
  return api.post(`/api/seasons/${seasonId}/actions/${actionId}`).send(body);
}

function submitKingOrder(seasonId, order = kingOrderInput()) {
  return postAction(seasonId, 's6_king_roll', { order });
}

function getS6Data(seasonId) {
  const row = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get(seasonId);
  return JSON.parse(row.comeback_data).s6;
}

// 直接落库把轮次标记为已完成（创建下一轮要求前轮全部完成，见 roundsController）
function completeRound(roundId) {
  prepare(`UPDATE matches SET status = 'completed' WHERE round_id = ?`).run(roundId);
  prepare(`UPDATE rounds SET status = 'completed' WHERE id = ?`).run(roundId);
}

test('s6_king_roll persists kingOrder once and mirrors round-1 topKings', async () => {
  insertS6Season('S-S6-ROLL');

  const res = await submitKingOrder('S-S6-ROLL').expect(200);

  const s6 = res.body.data.comebackData.s6;
  assert.deepEqual(s6.kingOrder.map(entry => entry.playerId), ['p3', 'p4', 'p2', 'p1']);
  assert.deepEqual(s6.kingOrder.map(entry => entry.dice), [6, 4, 1, 4]);
  assert.deepEqual(s6.kingOrder[1].rolls, [5, 4]);

  // 兼容旧读取方：第 1 轮 topKings 同步写入，王为王序首位，形态待选
  const topKing = s6.topKings['1'];
  assert.equal(topKing.kingId, 'p3');
  assert.equal(topKing.form, null);
  assert.equal(topKing.rolls.length, 4);

  const persisted = getS6Data('S-S6-ROLL');
  assert.equal(persisted.kingOrder[0].playerId, 'p3');
  assert.equal(persisted.topKings['1'].kingId, 'p3');
});

test('s6_king_roll validates participant permutation and dice values', async () => {
  insertS6Season('S-S6-ROLL-BAD');

  // 旧的按轮提交形态（roundNo + rolls）不再支持，自然校验失败
  const legacy = await postAction('S-S6-ROLL-BAD', 's6_king_roll', {
    roundNo: 1,
    rolls: [
      { playerId: 'p1', dice: 3 },
      { playerId: 'p2', dice: 6 },
      { playerId: 'p3', dice: 1 },
      { playerId: 'p4', dice: 4 }
    ]
  }).expect(422);
  assert.match(legacy.body.error.message, /全部 4 名/);

  const outsider = await submitKingOrder('S-S6-ROLL-BAD', [
    { playerId: 'p1', dice: 3 },
    { playerId: 'p2', dice: 6 },
    { playerId: 'p3', dice: 1 },
    { playerId: 'p9', dice: 4 }
  ]).expect(422);
  assert.match(outsider.body.error.message, /非本赛季选手/);

  const duplicated = await submitKingOrder('S-S6-ROLL-BAD', [
    { playerId: 'p1', dice: 3 },
    { playerId: 'p2', dice: 6 },
    { playerId: 'p2', dice: 1 },
    { playerId: 'p4', dice: 4 }
  ]).expect(422);
  assert.match(duplicated.body.error.message, /只能出现一次/);

  const badDice = await submitKingOrder('S-S6-ROLL-BAD', [
    { playerId: 'p1', dice: 3 },
    { playerId: 'p2', dice: 7 },
    { playerId: 'p3', dice: 1 },
    { playerId: 'p4', dice: 4 }
  ]).expect(422);
  assert.match(badDice.body.error.message, /1-6/);

  const missing = await submitKingOrder('S-S6-ROLL-BAD', [
    { playerId: 'p1', dice: 3 },
    { playerId: 'p2', dice: 6 },
    { playerId: 'p3', dice: 1 }
  ]).expect(422);
  assert.match(missing.body.error.message, /全部 4 名/);

  await submitKingOrder('S-S6-ROLL-BAD').expect(200);
  const duplicate = await submitKingOrder('S-S6-ROLL-BAD').expect(422);
  assert.match(duplicate.body.error.message, /不能重复提交/);
});

test('s6_king_roll is rejected once round 1 is created', async () => {
  insertS6Season('S-S6-ROLL-LOCKED');
  await submitKingOrder('S-S6-ROLL-LOCKED').expect(200);
  await postAction('S-S6-ROLL-LOCKED', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
  await api
    .post('/api/rounds')
    .send({ id: 'R-S6-LOCKED-1', seasonId: 'S-S6-ROLL-LOCKED', roundNo: 1 })
    .expect(201);

  const res = await submitKingOrder('S-S6-ROLL-LOCKED').expect(422);
  assert.match(res.body.error.message, /该轮已创建/);
});

test('s6_king_form derives each round king from kingOrder and persists form', async () => {
  insertS6Season('S-S6-FORM');

  const noRoll = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'daiqing' }).expect(422);
  assert.match(noRoll.body.error.message, /王选掷骰/);

  await submitKingOrder('S-S6-FORM').expect(200);

  const badRound = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 5, form: 'daiqing' }).expect(422);
  assert.match(badRound.body.error.message, /第 1-4 轮/);

  const badForm = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'xuanwu' }).expect(422);
  assert.match(badForm.body.error.message, /形态/);

  const res = await postAction('S-S6-FORM', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
  const roundOne = res.body.data.comebackData.s6.topKings['1'];
  assert.equal(roundOne.kingId, 'p3');
  assert.equal(roundOne.form, 'feihong');
  // 王选时写入的 rolls 在选形态后保留
  assert.equal(roundOne.rolls.length, 4);

  // 第 2-4 轮的王由王序推导（王序 p3 > p4 > p2 > p1）
  await postAction('S-S6-FORM', 's6_king_form', { roundNo: 2, form: 'daiqing' }).expect(200);
  await postAction('S-S6-FORM', 's6_king_form', { roundNo: 4, form: 'yuebai' }).expect(200);
  const topKings = getS6Data('S-S6-FORM').topKings;
  assert.equal(topKings['2'].kingId, 'p4');
  assert.equal(topKings['2'].form, 'daiqing');
  assert.equal(topKings['4'].kingId, 'p1');
  assert.equal(topKings['4'].form, 'yuebai');
});

test('creating s6 top-phase rounds 1-4 requires king order and per-round form', async () => {
  insertS6Season('S-S6-ROUND');

  const noOrder = await api
    .post('/api/rounds')
    .send({ id: 'R-S6-ROUND-1', seasonId: 'S-S6-ROUND', roundNo: 1 })
    .expect(422);
  assert.match(noOrder.body.error.message, /王选掷骰/);

  await submitKingOrder('S-S6-ROUND').expect(200);

  const noForm = await api
    .post('/api/rounds')
    .send({ id: 'R-S6-ROUND-1', seasonId: 'S-S6-ROUND', roundNo: 1 })
    .expect(422);
  assert.match(noForm.body.error.message, /形态/);

  // 形态齐后第 1-4 轮均可创建；每轮王来自王序（前轮落库标记完成后创建下一轮）
  const kings = ['p3', 'p4', 'p2', 'p1'];
  const forms = ['daiqing', 'feihong', 'yuebai', 'feihong'];
  for (let roundNo = 1; roundNo <= 4; roundNo += 1) {
    const roundId = `R-S6-ROUND-${roundNo}`;
    await postAction('S-S6-ROUND', 's6_king_form', { roundNo, form: forms[roundNo - 1] }).expect(200);
    const created = await api
      .post('/api/rounds')
      .send({ id: roundId, seasonId: 'S-S6-ROUND', roundNo })
      .expect(201);
    assert.equal(created.body.data.beforeRoundSetup.type, 'king_selection');
    assert.equal(created.body.data.beforeRoundSetup.topKing.kingId, kings[roundNo - 1]);
    completeRound(roundId);
  }

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
  await submitKingOrder('S-S6-DAIQING').expect(200);
  await postAction('S-S6-DAIQING', 's6_king_form', { roundNo: 1, form: 'daiqing' }).expect(200);
  await api.post('/api/rounds').send({ id: 'R-S6-DAIQING-1', seasonId: 'S-S6-DAIQING', roundNo: 1 }).expect(201);

  // 第 1 轮王 = 王序首位 p3；M1: teamA [p1,p2] vs teamB [p3,p4]，王在 B 方
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
  assert.equal(config.scoringMode, 'standard');
  assert.equal(config.requiresWinner, false);
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

test('daiqing opening score in rounds 2-4 uses the king derived from kingOrder', async () => {
  insertS6Season('S-S6-DAIQING-R2');
  await submitKingOrder('S-S6-DAIQING-R2').expect(200);
  await postAction('S-S6-DAIQING-R2', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
  await postAction('S-S6-DAIQING-R2', 's6_king_form', { roundNo: 2, form: 'daiqing' }).expect(200);
  await api.post('/api/rounds').send({ id: 'R-S6-DAIQING-R2-1', seasonId: 'S-S6-DAIQING-R2', roundNo: 1 }).expect(201);
  completeRound('R-S6-DAIQING-R2-1');
  await api.post('/api/rounds').send({ id: 'R-S6-DAIQING-R2-2', seasonId: 'S-S6-DAIQING-R2', roundNo: 2 }).expect(201);

  // 第 2 轮王 = 王序第二位 p4；M1: teamA [p1,p2] vs teamB [p3,p4]，王在 B 方
  const games = await startMatch('R-S6-DAIQING-R2-2-M1');
  assert.equal(games[0].score_a, 0);
  assert.equal(games[0].score_b, 2);

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch('R-S6-DAIQING-R2-2-M1'),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-S6-DAIQING-R2'),
    round: getDbRound('R-S6-DAIQING-R2-2'),
    ruleId: 's6'
  });
  assert.equal(config.openingScoreA, 0);
  assert.equal(config.openingScoreB, 2);
  assert.equal(config.kingId, 'p4');
  assert.equal(config.kingForm, 'daiqing');
});

test('feihong and yuebai forms start games at 0:0', async () => {
  insertS6Season('S-S6-FEIHONG');
  await submitKingOrder('S-S6-FEIHONG').expect(200);
  await postAction('S-S6-FEIHONG', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
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
  assert.equal(config.kingId, 'p3');
  assert.equal(config.kingForm, 'feihong');
});

test('s6 games still validate standard 21-point endings', async () => {
  insertS6Season('S-S6-END');
  await submitKingOrder('S-S6-END').expect(200);
  await postAction('S-S6-END', 's6_king_form', { roundNo: 1, form: 'feihong' }).expect(200);
  await api.post('/api/rounds').send({ id: 'R-S6-END-1', seasonId: 'S-S6-END', roundNo: 1 }).expect(201);
  const games = await startMatch('R-S6-END-1-M1');

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 20, scoreB: 18 }).expect(200);
  await api.post(`/api/games/${games[0].id}/end`).expect(422);

  await finishGame(games[0].id, 21, 18);
  assert.equal(getDbGames('R-S6-END-1-M1')[0].winner, 'a');
});

test('yuebai king games use resistance scoring with an explicit winner', async () => {
  insertS6Season('S-S6-YUEBAI');
  await submitKingOrder('S-S6-YUEBAI').expect(200);
  await postAction('S-S6-YUEBAI', 's6_king_form', { roundNo: 1, form: 'yuebai' }).expect(200);
  await api.post('/api/rounds').send({ id: 'R-S6-YUEBAI-1', seasonId: 'S-S6-YUEBAI', roundNo: 1 }).expect(201);
  const games = await startMatch('R-S6-YUEBAI-1-M1');

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch('R-S6-YUEBAI-1-M1'),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-S6-YUEBAI'),
    round: getDbRound('R-S6-YUEBAI-1'),
    ruleId: 's6'
  });
  assert.equal(config.scoringMode, 'resistance');
  assert.equal(config.targetScore, 21);
  assert.equal(config.maxScore, 30);
  assert.equal(config.requiresWinner, true);
  assert.equal(config.supportsPierce, false);
  assert.equal(config.openingScoreA, 0);
  assert.equal(config.openingScoreB, 0);
  assert.equal(config.kingId, 'p3');
  assert.equal(config.kingForm, 'yuebai');

  const rule = getRule('s6');
  const ctx = { gameConfig: config };
  // 分低者获胜：胜方 A 21:29 合法
  assert.deepEqual(rule.validateGameEnd(ctx, { scoreA: 21, scoreB: 29, winner: 'a' }),
    { canEnd: true, winner: 'a', reason: '' });
  // 普通比分 21:15 同样可结束
  assert.equal(rule.validateGameEnd(ctx, { scoreA: 21, scoreB: 15, winner: 'a' }).canEnd, true);
  // 未显式选择胜方 → 拒绝
  const noWinner = rule.validateGameEnd(ctx, { scoreA: 21, scoreB: 15 });
  assert.equal(noWinner.canEnd, false);
  assert.match(noWinner.reason, /胜方/);
  // 超过 30 封顶 → 拒绝
  assert.equal(rule.validateGameEnd(ctx, { scoreA: 31, scoreB: 29, winner: 'a' }).canEnd, false);
  // 胜方未达 21 分 → 拒绝
  assert.equal(rule.validateGameEnd(ctx, { scoreA: 20, scoreB: 29, winner: 'a' }).canEnd, false);

  // 端到端：分低者获胜（21:29 胜方为 A）
  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 21, scoreB: 29 }).expect(200);
  const rejected = await api.post(`/api/games/${games[0].id}/end`).send({}).expect(422);
  assert.match(rejected.body.error.message, /胜方/);
  await api.post(`/api/games/${games[0].id}/end`).send({ winner: 'a' }).expect(200);
  assert.equal(getDbGames('R-S6-YUEBAI-1-M1')[0].winner, 'a');
});

// 旧数据（王选调整前写入，如 prod 第 1 轮）：无 kingOrder，仅有 topKings。
// 形态提交、轮次门禁与局配置均回退到 topKings[roundNo].kingId。
test('legacy topKings-only data still drives form, round gate and game config', async () => {
  insertS6Season('S-S6-LEGACY', {
    s6: {
      topKings: {
        1: {
          rolls: [
            { playerId: 'p1', dice: 4 },
            { playerId: 'p2', dice: 2 },
            { playerId: 'p3', dice: 6 },
            { playerId: 'p4', dice: 1 }
          ],
          kingId: 'p3',
          form: null
        }
      }
    }
  });

  const noForm = await api
    .post('/api/rounds')
    .send({ id: 'R-S6-LEGACY-1', seasonId: 'S-S6-LEGACY', roundNo: 1 })
    .expect(422);
  assert.match(noForm.body.error.message, /形态/);

  const res = await postAction('S-S6-LEGACY', 's6_king_form', { roundNo: 1, form: 'daiqing' }).expect(200);
  assert.equal(res.body.data.comebackData.s6.topKings['1'].kingId, 'p3');
  assert.equal(res.body.data.comebackData.s6.topKings['1'].form, 'daiqing');

  await api
    .post('/api/rounds')
    .send({ id: 'R-S6-LEGACY-1', seasonId: 'S-S6-LEGACY', roundNo: 1 })
    .expect(201);

  // 王回退到 topKings['1'].kingId = p3（B 方）→ 黛青 0:2 开局
  const games = await startMatch('R-S6-LEGACY-1-M1');
  assert.equal(games[0].score_a, 0);
  assert.equal(games[0].score_b, 2);

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch('R-S6-LEGACY-1-M1'),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-S6-LEGACY'),
    round: getDbRound('R-S6-LEGACY-1'),
    ruleId: 's6'
  });
  assert.equal(config.kingId, 'p3');
  assert.equal(config.kingForm, 'daiqing');
});
