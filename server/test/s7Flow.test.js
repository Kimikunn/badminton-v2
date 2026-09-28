const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness } = require('./helpers/backendTestHarness');

const {
  api,
  prepare,
  setupTestDb,
  closeTestDb,
  insertSeason,
  getDbMatchesByRound,
  startMatch,
  finishGame
} = createTestHarness('badminton-s7-flow-test-');

test.before(async () => {
  await setupTestDb({ players: ['p1', 'p2', 'p3', 'p4'] });
});

test.after(() => {
  closeTestDb();
});

function insertS7Season(id) {
  insertSeason({ id, ruleId: 's7', totalRounds: 3 });
}

function postAction(seasonId, actionId, body) {
  return api.post(`/api/seasons/${seasonId}/actions/${actionId}`).send(body);
}

function soulRoll(seasonId, roundNo, comboLabel, playerId, dice) {
  return postAction(seasonId, 's7_soul_roll', { roundNo, comboLabel, playerId, rollChoice: dice.length, dice });
}

function soulPick(seasonId, roundNo, comboLabel, playerId, cardId) {
  return postAction(seasonId, 's7_soul_pick', { roundNo, comboLabel, playerId, cardId });
}

// S7 第 1 轮灵魂契合全流程：种子=ID 排序（p1-p4 → A-D），AB/CD 各完成投掷+选奖
test('s7 soul bond round 1 + round creation + combo pairing', async () => {
  const seasonId = 'S-s7-flow-1';
  insertS7Season(seasonId);

  // 未完成灵魂契合时创建轮次被拒
  await api.post('/api/rounds').send({ seasonId, roundNo: 1 }).expect(422);

  // AB：3+4=7（第二阶）；CD：双方同点 5+5 → 总 10+1=11（第三阶，后投者选 2 次）
  await soulRoll(seasonId, 1, 'AB', 'p1', [3]).expect(200);
  await soulRoll(seasonId, 1, 'AB', 'p2', [4]).expect(200);
  await soulPick(seasonId, 1, 'AB', 'p1', 'pause').expect(200);
  await soulPick(seasonId, 1, 'AB', 'p2', 'blade').expect(200);
  await soulRoll(seasonId, 1, 'CD', 'p3', [5, 5]).expect(200);
  await soulRoll(seasonId, 1, 'CD', 'p4', [5, 5]).expect(200);
  await soulPick(seasonId, 1, 'CD', 'p3', 'storage').expect(200);
  await soulPick(seasonId, 1, 'CD', 'p4', 'rift').expect(200);
  await soulPick(seasonId, 1, 'CD', 'p4', 'stardust').expect(200);

  // 灵魂契合后仍拒绝随机对阵（组合轮固定轮换）
  await api.post('/api/rounds').send({
    seasonId, roundNo: 1,
    pairings: [{ teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] }]
  }).expect(422);

  // 建轮成功：teamA=AB（p1,p2）、teamB=CD（p3,p4）
  await api.post('/api/rounds').send({ seasonId, roundNo: 1 }).expect(201);
  const matches = getDbMatchesByRound(prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = 1').get(seasonId).id);
  assert.equal(matches.length, 1);
  const teamA = JSON.parse(matches[0].team_a);
  const teamB = JSON.parse(matches[0].team_b);
  assert.deepEqual(teamA, ['p1', 'p2']);
  assert.deepEqual(teamB, ['p3', 'p4']);

  // 状态落盘：种子持久化 + 宝库库存（暂停卡×3 名刀×3 / 存储器×2 时空裂隙×1）
  const data = JSON.parse(prepare('SELECT comeback_data FROM seasons WHERE id = ?').get(seasonId).comeback_data);
  assert.deepEqual(data.s7.seeds, { A: 'p1', B: 'p2', C: 'p3', D: 'p4' });
  assert.equal(data.s7.soulBond['1'].AB.total, 7);
  assert.equal(data.s7.soulBond['1'].CD.total, 11);
  assert.equal(data.s7.treasury.AB.inventory.pause, 3);
  assert.equal(data.s7.treasury.CD.inventory.rift, 1);
  assert.equal(data.s7.treasury.CD.inventory.storage, 2);

  // 组合赛开打 + 记分（PA7）：AB（p1/p2）胜 CD（p3/p4）
  const matchId = matches[0].id;
  const players4 = [teamA[0], teamA[1], teamB[0], teamB[1]];
  for (const pid of players4) {
    await postAction(seasonId, 's7_card_activate', { matchId, gameNo: 1, playerId: pid, cardId: null }).expect(200);
  }
  await startMatch(matchId);
  const games = prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
  assert.equal(games.length, 7);
  for (let i = 0; i < games.length; i++) {
    if (i > 0) {
      for (const pid of players4) {
        const res = await postAction(seasonId, 's7_card_activate', {
          matchId, gameNo: i + 1, playerId: pid, cardId: null
        });
        if (res.status !== 200 && !/已提交暗选/.test(res.body?.error?.message || '')) {
          assert.fail(`G${i + 1} ${pid} 暗选失败: ${res.body?.error?.message || res.status}`);
        }
      }
      await api.post(`/api/matches/${matchId}/start`).expect(200);
    }
    await finishGame(games[i].id, 21, 10);
  }
  const finished = prepare('SELECT status, winner FROM matches WHERE id = ?').get(matchId);
  assert.equal(finished.winner, 'a');
});

// 无效轮次/动作拦截
test('s7 rejects king-era actions and out-of-range rounds', async () => {
  const seasonId = 'S-s7-flow-2';
  insertS7Season(seasonId);
  const outOfRange = await postAction(seasonId, 's7_soul_roll', { roundNo: 4, comboLabel: 'AB', playerId: 'p1', rollChoice: 1, dice: [3] });
  assert.match(outOfRange.body?.error?.message || '', /灵魂契合仅适用于第 1-3 轮/);
  const kingAction = await postAction(seasonId, 's7_king_roll', { order: [] });
  assert.match(kingAction.body?.error?.message || kingAction.body?.error || '', /第七赛季不支持该操作/);
  const wrongCombo = await postAction(seasonId, 's7_soul_roll', { roundNo: 2, comboLabel: 'AC', playerId: 'p2', rollChoice: 1, dice: [3] });
  assert.match(wrongCombo.body?.error?.message || wrongCombo.body?.error || '', /该选手不属于此组合/);
});
