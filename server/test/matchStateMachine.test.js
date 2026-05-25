const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  prepare,
  setupTestDb,
  closeTestDb,
  insertSeason,
  insertS5Season,
  insertRound,
  insertMatch,
  getDbMatch,
  getDbRound,
  getDbGames,
  startMatch,
  finishGame
} = createTestHarness('badminton-state-test-');

test.before(async () => {
  await setupTestDb({ players: ['p1', 'p2', 'p3', 'p4'] });
});

test.after(() => {
  closeTestDb();
});


test('GET /api/matches/:matchId/games returns games for that match', async () => {
  insertSeason('S-MATCH-GAMES');
  insertRound('R-MATCH-GAMES', 'S-MATCH-GAMES');
  insertMatch('M-MATCH-GAMES', 'S-MATCH-GAMES', 'R-MATCH-GAMES');
  await startMatch('M-MATCH-GAMES');

  const res = await api.get('/api/matches/M-MATCH-GAMES/games').expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.length, 3);
  assert.deepEqual(res.body.data.map(g => g.matchId), ['M-MATCH-GAMES', 'M-MATCH-GAMES', 'M-MATCH-GAMES']);
});

test('starting a pending match creates games and moves the round in progress', async () => {
  insertSeason('S-START');
  insertRound('R-START', 'S-START');
  insertMatch('M-START', 'S-START', 'R-START');

  const res = await api.post('/api/matches/M-START/start').expect(200);
  const games = getDbGames('M-START');

  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'in_progress');
  assert.equal(games.length, 3);
  assert.deepEqual(games.map(g => g.status), ['in_progress', 'pending', 'pending']);
  assert.equal(getDbRound('R-START').status, 'in_progress');
});

test('canceling an in-progress match deletes games and restores pending status', async () => {
  insertSeason('S-CANCEL');
  insertRound('R-CANCEL', 'S-CANCEL');
  insertMatch('M-CANCEL', 'S-CANCEL', 'R-CANCEL');
  await startMatch('M-CANCEL');

  const res = await api.post('/api/matches/M-CANCEL/cancel').expect(200);

  assert.equal(res.body.success, true);
  assert.equal(getDbMatch('M-CANCEL').status, 'pending');
  assert.equal(getDbRound('R-CANCEL').status, 'pending');
  assert.equal(getDbGames('M-CANCEL').length, 0);
});

test('ending games advances the next game and completes match and round', async () => {
  insertSeason('S-END');
  insertRound('R-END', 'S-END');
  insertMatch('M-END', 'S-END', 'R-END');
  let games = await startMatch('M-END');

  await finishGame(games[0].id, 21, 19);
  games = getDbGames('M-END');
  assert.deepEqual(games.map(g => g.status), ['completed', 'in_progress', 'pending']);
  assert.equal(getDbMatch('M-END').status, 'in_progress');

  await finishGame(games[1].id, 21, 18);
  games = getDbGames('M-END');
  assert.deepEqual(games.map(g => g.status), ['completed', 'completed', 'pending']);
  assert.equal(getDbMatch('M-END').status, 'completed');
  assert.equal(getDbMatch('M-END').winner, 'a');
  assert.equal(getDbRound('R-END').status, 'completed');
});

test('S5 mutation rounds end games at 15 points and advance normally', async () => {
  insertS5Season('S-S5-MUTATION');
  insertRound('R-S5-MUTATION', 'S-S5-MUTATION');
  insertMatch('M-S5-MUTATION', 'S-S5-MUTATION', 'R-S5-MUTATION');
  let games = await startMatch('M-S5-MUTATION');

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 15, scoreB: 14 }).expect(200);
  await api.post(`/api/games/${games[0].id}/end`).expect(422);

  await finishGame(games[0].id, 15, 13);
  games = getDbGames('M-S5-MUTATION');
  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get('S-S5-MUTATION');
  const comebackData = JSON.parse(season.comeback_data);

  assert.deepEqual(games.map(g => g.status), ['completed', 'in_progress', 'pending']);
  assert.equal(games[0].winner, 'a');
  assert.equal(getDbMatch('M-S5-MUTATION').status, 'in_progress');
  assert.equal(getDbRound('R-S5-MUTATION').status, 'in_progress');
  assert.deepEqual(comebackData.s5.debtRecords, {});
});

test('S5 completed mutation rounds create debt records by round ranking', async () => {
  insertS5Season('S-S5-DEBT', { 1: { dice: 6, mode: 'mutation' } });
  insertRound('R-S5-DEBT', 'S-S5-DEBT');
  insertMatch('M-S5-DEBT', 'S-S5-DEBT', 'R-S5-DEBT');
  const games = await startMatch('M-S5-DEBT');

  await finishGame(games[0].id, 15, 13);
  await finishGame(games[1].id, 15, 11);

  const round = getDbRound('R-S5-DEBT');
  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get('S-S5-DEBT');
  const comebackData = JSON.parse(season.comeback_data);
  const debtRecord = comebackData.s5.debtRecords['1'];

  assert.equal(round.status, 'completed');
  assert.deepEqual(debtRecord.creditors, ['p1', 'p2']);
  assert.deepEqual(debtRecord.debtors, ['p3', 'p4']);
  assert.deepEqual(debtRecord.rankings.map(row => [row.playerId, row.rank, row.bigScore, row.smallScore, row.totalPoints]), [
    ['p1', 1, 1, 2, 30],
    ['p2', 2, 1, 2, 30],
    ['p3', 3, 0, 0, 24],
    ['p4', 4, 0, 0, 24]
  ]);

  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?')
    .run(JSON.stringify({ ...comebackData, s5: { ...comebackData.s5, debtRecords: {} } }), 'S-S5-DEBT');

  const backfillRes = await api.get('/api/seasons/S-S5-DEBT').expect(200);
  assert.deepEqual(backfillRes.body.data.comebackData.s5.debtRecords['1'].creditors, ['p1', 'p2']);

  const settleRes = await api
    .post('/api/seasons/S-S5-DEBT/actions/s5_debt_settlement')
    .send({ roundNo: 1, note: '饮料已结算' })
    .expect(200);

  assert.deepEqual(settleRes.body.data.comebackData.s5.debtSettlements['1'].creditors, ['p1', 'p2']);
  assert.deepEqual(settleRes.body.data.comebackData.s5.debtSettlements['1'].debtors, ['p3', 'p4']);
  assert.equal(settleRes.body.data.comebackData.s5.debtSettlements['1'].note, '饮料已结算');

  await api
    .post('/api/seasons/S-S5-DEBT/actions/s5_debt_settlement')
    .send({ roundNo: 1 })
    .expect(422);
});

test('S5 order rounds can record resistance winners and pierce after game events', async () => {
  insertS5Season('S-S5-ORDER', { 1: { dice: 2, mode: 'order' } });
  insertRound('R-S5-ORDER', 'S-S5-ORDER');
  insertMatch('M-S5-ORDER', 'S-S5-ORDER', 'R-S5-ORDER');
  let games = await startMatch('M-S5-ORDER');

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 22, scoreB: 25 }).expect(200);
  await api.post(`/api/games/${games[0].id}/end`).expect(422);
  const endRes = await api
    .post(`/api/games/${games[0].id}/end`)
    .send({ winner: 'a', rulePayload: { pierceTeam: 'a' } })
    .expect(200);

  games = getDbGames('M-S5-ORDER');
  const listRes = await api.get('/api/matches/M-S5-ORDER/games').expect(200);
  const events = prepare('SELECT * FROM game_rule_events WHERE game_id = ? ORDER BY type').all(games[0].id);
  const season = prepare('SELECT comeback_data FROM seasons WHERE id = ?').get('S-S5-ORDER');
  const comebackData = JSON.parse(season.comeback_data);

  assert.equal(games[0].winner, 'a');
  assert.deepEqual(endRes.body.data.ruleEvents.map(e => e.type).sort(), ['pierce', 'resistance']);
  assert.deepEqual(listRes.body.data[0].ruleEvents.map(e => e.type).sort(), ['pierce', 'resistance']);
  assert.deepEqual(events.map(e => e.type), ['pierce', 'resistance']);
  assert.deepEqual(comebackData.s5.pierceCounts, { p1: 1, p2: 1 });

  const pauseRes = await api
    .post('/api/seasons/S-S5-ORDER/actions/s5_pause_use')
    .send({ playerId: 'p1', note: 'G2 使用45秒暂停' })
    .expect(200);

  assert.equal(pauseRes.body.data.comebackData.s5.pauseUses[0].playerId, 'p1');
  assert.equal(pauseRes.body.data.comebackData.s5.pauseUses[0].note, 'G2 使用45秒暂停');

  const compatPauseRes = await api
    .post('/api/seasons/S-S5-ORDER/s5/pause-uses')
    .send({ playerId: 'p2', note: '兼容入口' })
    .expect(200);

  assert.equal(compatPauseRes.body.data.comebackData.s5.pauseUses[1].playerId, 'p2');

  await api
    .post('/api/seasons/S-S5-ORDER/actions/s5_pause_use')
    .send({ playerId: 'p1' })
    .expect(422);

  await api
    .post('/api/seasons/S-S5-ORDER/actions/s5_pause_use')
    .send({ playerId: 'p3' })
    .expect(422);
});

test('deleting a match removes S5 game rule events before deleting games', async () => {
  insertS5Season('S-S5-DELETE-MATCH', { 1: { dice: 2, mode: 'order' } });
  insertRound('R-S5-DELETE-MATCH', 'S-S5-DELETE-MATCH');
  insertMatch('M-S5-DELETE-MATCH', 'S-S5-DELETE-MATCH', 'R-S5-DELETE-MATCH');
  const games = await startMatch('M-S5-DELETE-MATCH');

  await api.put(`/api/games/${games[0].id}/score`).send({ scoreA: 22, scoreB: 25 }).expect(200);
  await api
    .post(`/api/games/${games[0].id}/end`)
    .send({ winner: 'a', rulePayload: { pierceTeam: 'a' } })
    .expect(200);

  assert.equal(prepare('SELECT COUNT(*) AS c FROM game_rule_events WHERE match_id = ?').get('M-S5-DELETE-MATCH').c, 2);

  const res = await api.delete('/api/matches/M-S5-DELETE-MATCH').expect(200);

  assert.equal(res.body.success, true);
  assert.equal(prepare('SELECT COUNT(*) AS c FROM game_rule_events WHERE match_id = ?').get('M-S5-DELETE-MATCH').c, 0);
  assert.equal(prepare('SELECT COUNT(*) AS c FROM games WHERE match_id = ?').get('M-S5-DELETE-MATCH').c, 0);
  assert.equal(getDbMatch('M-S5-DELETE-MATCH'), null);
});


test('ending a game repairs missing games for an in-progress BO7 match', async () => {
  insertSeason('S-REPAIR');
  insertRound('R-REPAIR', 'S-REPAIR', 'in_progress');
  insertMatch('M-REPAIR', 'S-REPAIR', 'R-REPAIR', 7, 'in_progress');
  prepare('INSERT INTO games (id, match_id, game_no, score_a, score_b, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run('M-REPAIR-G1', 'M-REPAIR', 1, 24, 22, 'in_progress');

  await api.post('/api/games/M-REPAIR-G1/end').expect(200);
  const games = getDbGames('M-REPAIR');

  assert.equal(games.length, 7);
  assert.deepEqual(games.map(g => g.game_no), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(games.map(g => g.status), ['completed', 'in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']);
  assert.equal(getDbMatch('M-REPAIR').status, 'in_progress');
  assert.equal(getDbRound('R-REPAIR').status, 'in_progress');
});


test('PA7 requires all seven games even after one side wins four games', async () => {
  insertSeason('S-PA7');
  insertRound('R-PA7', 'S-PA7');
  insertMatch('M-PA7', 'S-PA7', 'R-PA7', 7, 'pending', null, 'pa7');
  let games = await startMatch('M-PA7');

  for (let i = 0; i < 4; i++) {
    await finishGame(games[i].id, 21, 10 + i);
    games = getDbGames('M-PA7');
  }

  assert.equal(getDbMatch('M-PA7').status, 'in_progress');
  assert.deepEqual(games.map(g => g.status), ['completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending']);

  for (let i = 4; i < 7; i++) {
    await finishGame(games[i].id, i === 4 ? 18 : 21, i === 4 ? 21 : 12);
    games = getDbGames('M-PA7');
  }

  assert.equal(getDbMatch('M-PA7').status, 'completed');
  assert.equal(getDbMatch('M-PA7').winner, 'a');
});

test('reverting the last completed game restores in-progress match and deletes later games', async () => {
  insertSeason('S-REVERT');
  insertRound('R-REVERT', 'S-REVERT');
  insertMatch('M-REVERT', 'S-REVERT', 'R-REVERT');
  let games = await startMatch('M-REVERT');
  await finishGame(games[0].id, 21, 19);
  games = getDbGames('M-REVERT');
  await finishGame(games[1].id, 21, 18);
  games = getDbGames('M-REVERT');

  const res = await api.post(`/api/games/${games[1].id}/revert`).expect(200);
  games = getDbGames('M-REVERT');

  assert.equal(res.body.success, true);
  assert.deepEqual(games.map(g => [g.game_no, g.status, g.winner]), [[1, 'completed', 'a'], [2, 'in_progress', null]]);
  assert.equal(getDbMatch('M-REVERT').status, 'in_progress');
  assert.equal(getDbMatch('M-REVERT').winner, null);
  assert.equal(getDbRound('R-REVERT').status, 'in_progress');
});

test('editing a completed game can reopen match and round status', async () => {
  insertSeason('S-EDIT');
  insertRound('R-EDIT', 'S-EDIT');
  insertMatch('M-EDIT', 'S-EDIT', 'R-EDIT');
  let games = await startMatch('M-EDIT');
  await finishGame(games[0].id, 21, 19);
  games = getDbGames('M-EDIT');
  await finishGame(games[1].id, 21, 18);
  games = getDbGames('M-EDIT');

  const res = await api
    .post(`/api/games/${games[1].id}/update-completed-score`)
    .send({ scoreA: 18, scoreB: 21 })
    .expect(200);

  assert.equal(res.body.success, true);
  games = getDbGames('M-EDIT');
  assert.equal(games[1].winner, 'b');
  assert.deepEqual(games.map(g => g.status), ['completed', 'completed', 'in_progress']);
  assert.equal(getDbMatch('M-EDIT').status, 'in_progress');
  assert.equal(getDbMatch('M-EDIT').winner, null);
  assert.equal(getDbRound('R-EDIT').status, 'in_progress');
});
