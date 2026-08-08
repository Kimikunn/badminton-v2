const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  prepare,
  setupTestDb,
  closeTestDb,
  insertSeason,
  insertRound,
  insertMatch,
  getDbMatch,
  getDbRound,
  getDbGames,
  startMatch,
  finishGame
} = createTestHarness('badminton-s6-treasury-test-');

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

function getS6Data(seasonId) {
  const row = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get(seasonId);
  return JSON.parse(row.comeback_data || '{}').s6 || {};
}

function postAction(seasonId, actionId, body) {
  return api.post(`/api/seasons/${seasonId}/actions/${actionId}`).send(body);
}

function soulRoll(seasonId, comboLabel, playerId, dice) {
  return postAction(seasonId, 's6_soul_roll', {
    roundNo: 5,
    comboLabel,
    playerId,
    rollChoice: dice.length,
    dice
  });
}

function soulPick(seasonId, comboLabel, playerId, cardId) {
  return postAction(seasonId, 's6_soul_pick', { roundNo: 5, comboLabel, playerId, cardId });
}

// 完成第 5 轮灵魂契合并创建轮次，返回该轮唯一比赛（AB=teamA/side a，CD=teamB/side b）。
// 默认点数：AB 5+6=11（第三阶）、CD 3+4=7（第二阶），均为不等点各选 1 奖。
async function setupBottomMatch(id, { abRolls, abPicks, cdRolls, cdPicks }) {
  const seasonId = `S-${id}`;
  const roundId = `R-${id}-5`;
  insertS6Season(seasonId);

  const [abFirst, abSecond] = abRolls || [['p1', [5]], ['p2', [6]]];
  const [cdFirst, cdSecond] = cdRolls || [['p3', [3]], ['p4', [4]]];
  await soulRoll(seasonId, 'AB', ...abFirst).expect(200);
  await soulRoll(seasonId, 'AB', ...abSecond).expect(200);
  await soulRoll(seasonId, 'CD', ...cdFirst).expect(200);
  await soulRoll(seasonId, 'CD', ...cdSecond).expect(200);
  for (const [playerId, cardId] of abPicks) await soulPick(seasonId, 'AB', playerId, cardId).expect(200);
  for (const [playerId, cardId] of cdPicks) await soulPick(seasonId, 'CD', playerId, cardId).expect(200);

  await api.post('/api/rounds').send({ id: roundId, seasonId, roundNo: 5 }).expect(201);
  return `${roundId}-M1`;
}

function cardActivate(seasonId, matchId, gameNo, playerId, cardId) {
  return postAction(seasonId, 's6_card_activate', { matchId, gameNo, playerId, cardId });
}

test('s6_card_activate validates window, ownership and reveals after all 4 players submit', async () => {
  const matchId = await setupBottomMatch('TR-ACT', {
    abPicks: [['p1', 'blast'], ['p2', 'storage']],
    cdPicks: [['p3', 'block'], ['p4', 'pause']]
  });

  const missing = await cardActivate('S-TR-ACT', 'NOPE', 1, 'p1', 'blast').expect(422);
  assert.match(missing.body.error.message, /比赛不存在/);

  // 非下篇轮次的比赛
  insertRound('R-TR-ACT-2', 'S-TR-ACT', 'in_progress', 2);
  insertMatch({ id: 'M-TR-ACT-TOP', seasonId: 'S-TR-ACT', roundId: 'R-TR-ACT-2' });
  const topPhase = await cardActivate('S-TR-ACT', 'M-TR-ACT-TOP', 1, 'p1', 'blast').expect(422);
  assert.match(topPhase.body.error.message, /第 5-7 轮/);

  const outsider = await cardActivate('S-TR-ACT', matchId, 1, 'p9', 'blast').expect(422);
  assert.match(outsider.body.error.message, /不属于此比赛/);

  const badGameNo = await cardActivate('S-TR-ACT', matchId, 8, 'p1', 'blast').expect(422);
  assert.match(badGameNo.body.error.message, /局号/);

  const badCard = await cardActivate('S-TR-ACT', matchId, 1, 'p1', 'nope').expect(422);
  assert.match(badCard.body.error.message, /无效的宝库卡片/);

  const anytime = await cardActivate('S-TR-ACT', matchId, 1, 'p4', 'pause').expect(422);
  assert.match(anytime.body.error.message, /无需在局前暗选/);

  // 卡片归属：爆破是 p1 选到的，p2 不能启用
  const notOwned = await cardActivate('S-TR-ACT', matchId, 1, 'p2', 'blast').expect(422);
  assert.match(notOwned.body.error.message, /未获得此卡/);

  // 正常提交：p1 暗选爆破（局行尚未创建 → gameId 为 null）
  await cardActivate('S-TR-ACT', matchId, 1, 'p1', 'blast').expect(200);
  let s6 = getS6Data('S-TR-ACT');
  assert.equal(s6.treasury.AB.inventory.blast, 1);
  const entry = s6.treasury.AB.activations[0];
  assert.ok(entry.id);
  assert.equal(entry.timing, 'pre_game');
  assert.equal(entry.matchId, matchId);
  assert.equal(entry.gameId, null);
  assert.equal(entry.gameNo, 1);
  assert.equal(entry.side, 'a');
  assert.equal(entry.playerId, 'p1');
  assert.equal(entry.cardId, 'blast');
  assert.equal(entry.revealed, false);
  assert.equal(entry.consumed, false);

  // 同一人同局重复提交 → 拒绝
  const duplicate = await cardActivate('S-TR-ACT', matchId, 1, 'p1', null).expect(422);
  assert.match(duplicate.body.error.message, /已提交暗选/);

  // 3 人提交后仍未亮出
  await cardActivate('S-TR-ACT', matchId, 1, 'p2', null).expect(200);
  await cardActivate('S-TR-ACT', matchId, 1, 'p3', null).expect(200);
  s6 = getS6Data('S-TR-ACT');
  assert.equal(s6.treasury.AB.activations[0].revealed, false);

  // 第 4 人提交"不使用" → 4 条记录同时亮出，且不扣库存
  await cardActivate('S-TR-ACT', matchId, 1, 'p4', null).expect(200);
  s6 = getS6Data('S-TR-ACT');
  assert.equal(s6.treasury.AB.activations.filter(e => e.gameNo === 1).length, 2);
  assert.ok(s6.treasury.AB.activations.every(e => e.revealed === true));
  const cdEntries = s6.treasury.CD.activations.filter(e => e.gameNo === 1);
  assert.equal(cdEntries.length, 2);
  assert.ok(cdEntries.every(e => e.revealed === true && e.cardId === null));
  assert.deepEqual(s6.treasury.CD.inventory, { block: 1, pause: 3 });

  // 库存耗尽：CD 阻碍仅 1 次
  await cardActivate('S-TR-ACT', matchId, 2, 'p3', 'block').expect(200);
  const exhausted = await cardActivate('S-TR-ACT', matchId, 3, 'p3', 'block').expect(422);
  assert.match(exhausted.body.error.message, /库存不足/);

  // 局已进入进行中 → 拒绝暗选
  await startMatch(matchId);
  const started = await cardActivate('S-TR-ACT', matchId, 1, 'p2', 'storage').expect(422);
  assert.match(started.body.error.message, /已开始/);
});

test('s6_card_use records anytime cards and exhausts inventory', async () => {
  const matchId = await setupBottomMatch('TR-USE', {
    abPicks: [['p1', 'pause'], ['p2', 'blade']],
    cdPicks: [['p3', 'pause_plus'], ['p4', 'block']]
  });
  await startMatch(matchId);

  const preGame = await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'block' }).expect(422);
  assert.match(preGame.body.error.message, /暗选/);

  await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'pause' }).expect(200);
  let s6 = getS6Data('S-TR-USE');
  assert.equal(s6.treasury.AB.inventory.pause, 2);
  const entry = s6.treasury.AB.activations.at(-1);
  assert.equal(entry.timing, 'anytime');
  assert.equal(entry.cardId, 'pause');
  assert.equal(entry.side, 'a');
  assert.equal(entry.revealed, true);
  assert.equal(entry.consumed, true);

  // 名刀 3 次用尽后拒绝
  await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'blade' }).expect(200);
  await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'blade' }).expect(200);
  await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'blade' }).expect(200);
  s6 = getS6Data('S-TR-USE');
  assert.equal(s6.treasury.AB.inventory.blade, 0);
  const exhausted = await postAction('S-TR-USE', 's6_card_use', { matchId, side: 'a', cardId: 'blade' }).expect(422);
  assert.match(exhausted.body.error.message, /库存不足/);
});

test('revealed blast switches the game to first-to-11 with cap 12', async () => {
  const matchId = await setupBottomMatch('TR-BLAST', {
    abPicks: [['p1', 'blast'], ['p2', 'pause']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });
  await cardActivate('S-TR-BLAST', matchId, 1, 'p1', 'blast').expect(200);
  await cardActivate('S-TR-BLAST', matchId, 1, 'p2', null).expect(200);
  await cardActivate('S-TR-BLAST', matchId, 1, 'p3', null).expect(200);
  await cardActivate('S-TR-BLAST', matchId, 1, 'p4', null).expect(200);
  const games = await startMatch(matchId);

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch(matchId),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-BLAST'),
    round: getDbRound('R-TR-BLAST-5'),
    ruleId: 's6'
  });
  assert.equal(config.targetScore, 11);
  assert.equal(config.maxScore, 12);
  assert.equal(config.activeEffects.blast, 'a');
  assert.equal(config.activeEffects.block, null);
  assert.equal(config.activeEffects.chosenA, false);

  // 从 10 分一球 2 分越过 11 → 12:10 允许；超过 12 封顶
  const rule = getRule('s6');
  assert.equal(rule.validateGameEnd({ gameConfig: config }, { scoreA: 12, scoreB: 10 }).canEnd, true);
  assert.equal(rule.validateGameEnd({ gameConfig: config }, { scoreA: 13, scoreB: 10 }).canEnd, false);

  // 21:10 不按标准制结束
  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 21, scoreB: 10 }).expect(200);
  const tooHigh = await api.post(`/api/games/${games[0].id}/end`).send({}).expect(422);
  assert.match(tooHigh.body.error.message, /封顶/);

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 10, scoreB: 8 }).expect(200);
  const notYet = await api.post(`/api/games/${games[0].id}/end`).send({}).expect(422);
  assert.match(notYet.body.error.message, /先达到11分/);

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 11, scoreB: 8 }).expect(200);
  await api.post(`/api/games/${games[0].id}/end`).send({}).expect(200);
  assert.equal(getDbGames(matchId)[0].winner, 'a');

  // 第二局无爆破暗选，仍按 21 分制校验
  const second = getDbGames(matchId)[1];
  await api.put(`/api/games/${second.id}/score`).send({ scoreA: 21, scoreB: 18 }).expect(200);
  await api.post(`/api/games/${second.id}/end`).send({}).expect(200);
});

test('chosen combo starts every bottom-phase game 2:0', async () => {
  const matchId = await setupBottomMatch('TR-CHOSEN', {
    abRolls: [['p1', [6]], ['p2', [6]]],
    abPicks: [['p1', 'pause'], ['p2', 'blade'], ['p2', 'block']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });
  assert.equal(getS6Data('S-TR-CHOSEN').treasury.AB.chosen, true);

  const games = await startMatch(matchId);
  assert.equal(games[0].score_a, 2);
  assert.equal(games[0].score_b, 0);

  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch(matchId),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-CHOSEN'),
    round: getDbRound('R-TR-CHOSEN-5'),
    ruleId: 's6'
  });
  assert.equal(config.openingScoreA, 2);
  assert.equal(config.openingScoreB, 0);
  assert.equal(config.activeEffects.chosenA, true);
  assert.equal(config.activeEffects.chosenB, false);

  // 每局都是 2:0 开局
  await finishGame(games[0].id, 22, 20);
  const second = getDbGames(matchId)[1];
  assert.equal(second.status, 'in_progress');
  assert.equal(second.score_a, 2);
  assert.equal(second.score_b, 0);
});

test('storage record carries extra-ball points into the next game opening', async () => {
  const matchId = await setupBottomMatch('TR-STORAGE', {
    abPicks: [['p1', 'storage'], ['p2', 'pause']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });

  const noActivation = await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 1, side: 'a', points: 3 }).expect(422);
  assert.match(noActivation.body.error.message, /存储器暗选记录/);

  await cardActivate('S-TR-STORAGE', matchId, 1, 'p1', 'storage').expect(200);
  const games = await startMatch(matchId);

  const tooEarly = await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 3 }).expect(422);
  assert.match(tooEarly.body.error.message, /尚未结束/);

  // a 方获胜 → 额外 5 球；局终后下一局自动进入进行中
  await finishGame(games[0].id, 21, 10);

  const overMax = await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 6 }).expect(422);
  assert.match(overMax.body.error.message, /0-5/);

  await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 4 }).expect(200);
  let s6 = getS6Data('S-TR-STORAGE');
  assert.deepEqual(s6.storageCarry, {});
  const second = getDbGames(matchId)[1];
  assert.equal(second.status, 'in_progress');
  assert.equal(second.score_a, 4);
  assert.equal(second.score_b, 0);

  const duplicate = await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 2 }).expect(422);
  assert.match(duplicate.body.error.message, /已记录/);

  // 第 3 局再次暗选存储器（uses=2）；局行已存在 → gameId 回填
  await cardActivate('S-TR-STORAGE', matchId, 3, 'p1', 'storage').expect(200);
  s6 = getS6Data('S-TR-STORAGE');
  const thirdEntry = s6.treasury.AB.activations.find(e => e.gameNo === 3);
  assert.equal(thirdEntry.gameId, `${matchId}-G3`);
  assert.equal(s6.treasury.AB.inventory.storage, 0);

  // a 方落败 → 额外 3 球
  await finishGame(second.id, 21, 18);
  const third = getDbGames(matchId)[2];
  await finishGame(third.id, 10, 21);

  const loserOverMax = await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 3, side: 'a', points: 4 }).expect(422);
  assert.match(loserOverMax.body.error.message, /0-3/);

  await postAction('S-TR-STORAGE', 's6_storage_record', { matchId, gameNo: 3, side: 'a', points: 3 }).expect(200);
  const fourth = getDbGames(matchId)[3];
  assert.equal(fourth.status, 'in_progress');
  assert.equal(fourth.score_a, 3);
  assert.equal(fourth.score_b, 0);
});

test('onGameStarted applies a pending storage carry once and clears it', async () => {
  insertS6Season('S-TR-CARRY', {
    s6: { storageCarry: { 'M-TR-CARRY': { side: 'b', points: 3, gameNo: 1 } } }
  });
  insertRound('R-TR-CARRY-5', 'S-TR-CARRY', 'in_progress', 5);
  insertMatch({ id: 'M-TR-CARRY', seasonId: 'S-TR-CARRY', roundId: 'R-TR-CARRY-5', bestOf: 7 });

  const ctx = {
    game: { id: 'M-TR-CARRY-G2', match_id: 'M-TR-CARRY', game_no: 2 },
    match: getDbMatch('M-TR-CARRY'),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-CARRY'),
    round: getDbRound('R-TR-CARRY-5'),
    ruleId: 's6'
  };
  const rule = getRule('s6');
  assert.deepEqual(rule.onGameStarted(ctx), { scoreA: 0, scoreB: 3 });
  assert.deepEqual(getS6Data('S-TR-CARRY').storageCarry, {});

  // 清除后不再重复应用
  const freshCtx = {
    ...ctx,
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-CARRY')
  };
  assert.equal(rule.onGameStarted(freshCtx), null);
});

test('s6_rift reverts the last completed games through the shared revert path', async () => {
  const matchId = await setupBottomMatch('TR-RIFT', {
    abPicks: [['p1', 'rift'], ['p2', 'pause']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });
  const games = await startMatch(matchId);
  await cardActivate('S-TR-RIFT', matchId, 3, 'p1', 'rift').expect(200);

  const badCount = await postAction('S-TR-RIFT', 's6_rift', { matchId, games: 3 }).expect(422);
  assert.match(badCount.body.error.message, /1 或 2/);

  const notEnough = await postAction('S-TR-RIFT', 's6_rift', { matchId, games: 1 }).expect(422);
  assert.match(notEnough.body.error.message, /局数不足/);

  // 逐人匹配：rift 是 p1 的暗选，p2 无法执行
  const wrongPlayer = await postAction('S-TR-RIFT', 's6_rift', { matchId, playerId: 'p2', games: 1 }).expect(422);
  assert.match(wrongPlayer.body.error.message, /没有可用的时空裂隙/);

  await finishGame(games[0].id, 21, 10);
  await finishGame(games[1].id, 21, 10);

  // 给第 3 局（将被回溯删除）插一条规则事件，验证清理与普通 revert 一致
  prepare(`INSERT INTO game_rule_events (id, season_id, round_id, match_id, game_id, rule_id, timing, type, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('GRE-TR-RIFT-X', 'S-TR-RIFT', 'R-TR-RIFT-5', matchId, `${matchId}-G3`, 's6', 'afterGame', 'x', '{}');

  await postAction('S-TR-RIFT', 's6_rift', { matchId, playerId: 'p1', games: 2 }).expect(200);

  const remaining = getDbGames(matchId);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].game_no, 1);
  assert.equal(remaining[0].status, 'in_progress');
  assert.equal(getDbMatch(matchId).status, 'in_progress');
  assert.equal(prepare('SELECT * FROM game_rule_events WHERE match_id = ?').all(matchId).length, 0);

  const s6 = getS6Data('S-TR-RIFT');
  const riftEntry = s6.treasury.AB.activations.find(e => e.cardId === 'rift');
  assert.equal(riftEntry.consumed, true);
  assert.equal(riftEntry.gameId, `${matchId}-G3`);
  assert.equal(s6.treasury.AB.inventory.rift, 0);

  const again = await postAction('S-TR-RIFT', 's6_rift', { matchId, games: 1 }).expect(422);
  assert.match(again.body.error.message, /没有可用的时空裂隙/);
});

test('s6_rift is rejected once game 7 is completed', async () => {
  const matchId = await setupBottomMatch('TR-RIFT7', {
    abPicks: [['p1', 'rift'], ['p2', 'pause']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });
  const games = await startMatch(matchId);
  await cardActivate('S-TR-RIFT7', matchId, 7, 'p1', 'rift').expect(200);
  for (const game of games) {
    await finishGame(game.id, 21, 10);
  }
  assert.equal(getDbMatch(matchId).status, 'completed');

  const res = await postAction('S-TR-RIFT7', 's6_rift', { matchId, games: 1 }).expect(422);
  assert.match(res.body.error.message, /第七局结束后无法启用回溯/);
});

test('two players on the same side can each activate a card and both effects apply', async () => {
  const matchId = await setupBottomMatch('TR-SAMESIDE', {
    abPicks: [['p1', 'blast'], ['p2', 'stardust']],
    cdPicks: [['p3', 'pause'], ['p4', 'blade']]
  });

  // 同方两人各激活一张局前卡
  await cardActivate('S-TR-SAMESIDE', matchId, 1, 'p1', 'blast').expect(200);
  await cardActivate('S-TR-SAMESIDE', matchId, 1, 'p2', 'stardust').expect(200);
  await cardActivate('S-TR-SAMESIDE', matchId, 1, 'p3', null).expect(200);
  await cardActivate('S-TR-SAMESIDE', matchId, 1, 'p4', null).expect(200);

  const games = await startMatch(matchId);
  const config = getRule('s6').getGameConfig({
    game: games[0],
    match: getDbMatch(matchId),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-SAMESIDE'),
    round: getDbRound('R-TR-SAMESIDE-5'),
    ruleId: 's6'
  });
  // 两个效果都挂在 a 方：爆破切换 11 分制，星尘卡同时亮出
  assert.equal(config.activeEffects.blast, 'a');
  assert.equal(config.activeEffects.stardust, 'a');
  assert.equal(config.targetScore, 11);
  assert.equal(config.maxScore, 12);

  const s6 = getS6Data('S-TR-SAMESIDE');
  assert.equal(s6.treasury.AB.inventory.blast, 1);
  assert.equal(s6.treasury.AB.inventory.stardust, 0);
});

test('two same-side storage activations are each recorded and their points add up', async () => {
  // 同一奖励不可重复选择，API 路径下只有一人能拥有存储器；为验证同方双存储器
  // 暗选的逐条记录语义，直接播种两人各持一条 storage 归属的数据
  insertS6Season('S-TR-STORAGE2', {
    s6: {
      soulBond: { 5: { AB: { picks: [{ playerId: 'p1', cardId: 'storage' }, { playerId: 'p2', cardId: 'storage' }] } } },
      treasury: { AB: { inventory: { storage: 2 }, activations: [] } }
    }
  });
  insertRound('R-TR-STORAGE2-5', 'S-TR-STORAGE2', 'in_progress', 5);
  insertMatch({ id: 'M-TR-STORAGE2', seasonId: 'S-TR-STORAGE2', roundId: 'R-TR-STORAGE2-5', bestOf: 7 });
  const matchId = 'M-TR-STORAGE2';

  // 同方两人同局各激活存储器
  await cardActivate('S-TR-STORAGE2', matchId, 1, 'p1', 'storage').expect(200);
  await cardActivate('S-TR-STORAGE2', matchId, 1, 'p2', 'storage').expect(200);
  const games = await startMatch(matchId);
  await finishGame(games[0].id, 21, 10);

  // 下一局已在进行中：两条记录各自直接加分，效果累加
  await postAction('S-TR-STORAGE2', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 4 }).expect(200);
  await postAction('S-TR-STORAGE2', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p2', points: 5 }).expect(200);
  const second = getDbGames(matchId)[1];
  assert.equal(second.score_a, 9);
  assert.equal(second.score_b, 0);

  const s6 = getS6Data('S-TR-STORAGE2');
  const entries = s6.treasury.AB.activations.filter(e => e.cardId === 'storage');
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.consumed === true));
  assert.equal(s6.treasury.AB.inventory.storage, 0);

  // 两条暗选都已消费 → 再次记录拒绝
  const third = await postAction('S-TR-STORAGE2', 's6_storage_record', { matchId, gameNo: 1, side: 'a', points: 1 }).expect(422);
  assert.match(third.body.error.message, /已记录/);
});

test('pending storage carries append per activation and sum on game start', async () => {
  // PA7 赛制下局终会自动开启下一局，carry 写入路径只能靠"局行存在但仍 pending"
  // 的状态触发——直接播种该状态（另含一条旧的单对象形态 carry 验证兼容包装）
  insertS6Season('S-TR-CARRYSUM', {
    s6: {
      treasury: {
        AB: {
          inventory: { storage: 0 },
          activations: [
            { id: 'S6CA-CS-1', timing: 'pre_game', matchId: 'M-TR-CARRYSUM', gameId: 'M-TR-CARRYSUM-G1', gameNo: 1, side: 'a', playerId: 'p1', cardId: 'storage', revealed: true, consumed: false },
            { id: 'S6CA-CS-2', timing: 'pre_game', matchId: 'M-TR-CARRYSUM', gameId: 'M-TR-CARRYSUM-G1', gameNo: 1, side: 'a', playerId: 'p2', cardId: 'storage', revealed: true, consumed: false }
          ]
        }
      },
      storageCarry: { 'M-TR-CARRYSUM': { side: 'a', points: 2, gameNo: 1 } }
    }
  });
  insertRound('R-TR-CARRYSUM-5', 'S-TR-CARRYSUM', 'in_progress', 5);
  insertMatch({ id: 'M-TR-CARRYSUM', seasonId: 'S-TR-CARRYSUM', roundId: 'R-TR-CARRYSUM-5', bestOf: 7 });
  const matchId = 'M-TR-CARRYSUM';
  prepare("INSERT INTO games (id, match_id, game_no, status, winner, score_a, score_b) VALUES (?, ?, ?, 'completed', 'a', 21, 10)")
    .run(`${matchId}-G1`, matchId, 1);
  prepare("INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, 'pending')")
    .run(`${matchId}-G2`, matchId, 2);

  // 两条暗选各记录一次：carry 逐条追加（旧的单对象形态被包装进数组）
  await postAction('S-TR-CARRYSUM', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p1', points: 5 }).expect(200);
  await postAction('S-TR-CARRYSUM', 's6_storage_record', { matchId, gameNo: 1, side: 'a', playerId: 'p2', points: 5 }).expect(200);

  const carries = getS6Data('S-TR-CARRYSUM').storageCarry[matchId];
  assert.equal(carries.length, 3);
  assert.deepEqual(carries, [
    { side: 'a', points: 2, gameNo: 1 },
    { side: 'a', points: 5, gameNo: 1 },
    { side: 'a', points: 5, gameNo: 1 }
  ]);

  // 局开始时按方求和应用并整体清除
  const ctx = {
    game: { id: `${matchId}-G2`, match_id: matchId, game_no: 2 },
    match: getDbMatch(matchId),
    season: prepare('SELECT * FROM seasons WHERE id = ?').get('S-TR-CARRYSUM'),
    round: getDbRound('R-TR-CARRYSUM-5'),
    ruleId: 's6'
  };
  assert.deepEqual(getRule('s6').onGameStarted(ctx), { scoreA: 12, scoreB: 0 });
  assert.deepEqual(getS6Data('S-TR-CARRYSUM').storageCarry, {});
});
