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
  getDbGames,
  getDbMatchesByRound,
  startMatch,
  finishGame
} = createTestHarness('badminton-s6-soulbond-test-');

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

function soulRoll(seasonId, roundNo, comboLabel, playerId, dice, extra = {}) {
  return postAction(seasonId, 's6_soul_roll', {
    roundNo,
    comboLabel,
    playerId,
    rollChoice: dice.length,
    dice,
    ...extra
  });
}

function soulPick(seasonId, roundNo, comboLabel, playerId, cardId) {
  return postAction(seasonId, 's6_soul_pick', { roundNo, comboLabel, playerId, cardId });
}

// 完成一个组合的灵魂契合：used 3/4 → 总点数 7（第二阶），双方各选 1 奖
async function completeCombo(seasonId, roundNo, comboLabel, [first, second]) {
  await soulRoll(seasonId, roundNo, comboLabel, first, [3]).expect(200);
  await soulRoll(seasonId, roundNo, comboLabel, second, [4]).expect(200);
  await soulPick(seasonId, roundNo, comboLabel, first, 'pause').expect(200);
  await soulPick(seasonId, roundNo, comboLabel, second, 'blade').expect(200);
}

test('s6_soul_roll validates round, combo label, membership and dice', async () => {
  insertS6Season('S-SB-VALIDATE');

  const badRound = await soulRoll('S-SB-VALIDATE', 4, 'AB', 'p1', [3]).expect(422);
  assert.match(badRound.body.error.message, /第 5-7 轮/);

  const badLabel = await soulRoll('S-SB-VALIDATE', 5, 'AC', 'p1', [3]).expect(422);
  assert.match(badLabel.body.error.message, /组合标识/);

  const outsider = await soulRoll('S-SB-VALIDATE', 5, 'AB', 'p3', [3]).expect(422);
  assert.match(outsider.body.error.message, /不属于此组合/);

  const badChoice = await postAction('S-SB-VALIDATE', 's6_soul_roll', {
    roundNo: 5, comboLabel: 'AB', playerId: 'p1', rollChoice: 3, dice: [3, 3, 3]
  }).expect(422);
  assert.match(badChoice.body.error.message, /1 或 2/);

  const mismatch = await postAction('S-SB-VALIDATE', 's6_soul_roll', {
    roundNo: 5, comboLabel: 'AB', playerId: 'p1', rollChoice: 2, dice: [3]
  }).expect(422);
  assert.match(mismatch.body.error.message, /与投掷次数一致/);

  const badDice = await soulRoll('S-SB-VALIDATE', 5, 'AB', 'p1', [7]).expect(422);
  assert.match(badDice.body.error.message, /1-6/);

  await soulRoll('S-SB-VALIDATE', 5, 'AB', 'p1', [3]).expect(200);
  const duplicate = await soulRoll('S-SB-VALIDATE', 5, 'AB', 'p1', [4]).expect(422);
  assert.match(duplicate.body.error.message, /重投/);

  await soulRoll('S-SB-VALIDATE', 5, 'AB', 'p2', [4]).expect(200);
  const combo = getS6Data('S-SB-VALIDATE').soulBond['5'].AB;
  assert.equal(combo.total, 7);
  assert.equal(combo.unlockTier, 2);
});

test('s6_soul_roll persists seeds on first roll and computes totals', async () => {
  insertS6Season('S-SB-TOTAL');

  // 投 2 次以第二次为准：p1 used=5，p2 used=5 → 同点 +1 → total 11 → 第三阶
  await soulRoll('S-SB-TOTAL', 5, 'AB', 'p1', [2, 5]).expect(200);
  let s6 = getS6Data('S-SB-TOTAL');
  assert.deepEqual(s6.seeds, { A: 'p1', B: 'p2', C: 'p3', D: 'p4' });
  assert.equal(s6.soulBond['5'].AB.rolls[0].used, 5);

  await soulRoll('S-SB-TOTAL', 5, 'AB', 'p2', [5]).expect(200);
  s6 = getS6Data('S-SB-TOTAL');
  const combo = s6.soulBond['5'].AB;
  assert.equal(combo.total, 11);
  assert.equal(combo.unlockTier, 3);
});

test('s6_soul_roll unlock tiers follow total thresholds', async () => {
  insertS6Season('S-SB-TIERS');

  // total 3+4=7 → 第二阶
  await soulRoll('S-SB-TIERS', 5, 'AB', 'p1', [3]).expect(200);
  await soulRoll('S-SB-TIERS', 5, 'AB', 'p2', [4]).expect(200);
  assert.equal(getS6Data('S-SB-TIERS').soulBond['5'].AB.unlockTier, 2);

  // total 2+3=5 → 第一阶
  await soulRoll('S-SB-TIERS', 5, 'CD', 'p3', [2]).expect(200);
  await soulRoll('S-SB-TIERS', 5, 'CD', 'p4', [3]).expect(200);
  assert.equal(getS6Data('S-SB-TIERS').soulBond['5'].CD.unlockTier, 1);
});

test('soul roll total 13 auto-grants chosen without consuming a pick', async () => {
  insertS6Season('S-SB-CHOSEN');

  await soulRoll('S-SB-CHOSEN', 5, 'AB', 'p1', [6]).expect(200);
  await soulRoll('S-SB-CHOSEN', 5, 'AB', 'p2', [6]).expect(200);

  const s6 = getS6Data('S-SB-CHOSEN');
  assert.equal(s6.soulBond['5'].AB.total, 13);
  assert.equal(s6.soulBond['5'].AB.unlockTier, 'chosen');
  assert.equal(s6.soulBond['5'].AB.chosenGranted, true);
  assert.equal(s6.treasury.AB.chosen, true);
  assert.deepEqual(s6.treasury.AB.activations, []);
  assert.deepEqual(s6.soulBond['5'].AB.picks, []);

  const pickChosen = await soulPick('S-SB-CHOSEN', 5, 'AB', 'p1', 'chosen').expect(422);
  assert.match(pickChosen.body.error.message, /自动触发/);

  // 天选视同解锁第三阶：可选第三阶奖励
  await soulPick('S-SB-CHOSEN', 5, 'AB', 'p1', 'rift').expect(200);
  assert.equal(getS6Data('S-SB-CHOSEN').treasury.AB.inventory.rift, 1);
});

test('s6_soul_pick enforces unlock tier, one pick each and no duplicates', async () => {
  insertS6Season('S-SB-PICK');

  const tooEarly = await soulPick('S-SB-PICK', 5, 'AB', 'p1', 'pause').expect(422);
  assert.match(tooEarly.body.error.message, /掷骰/);

  await soulRoll('S-SB-PICK', 5, 'AB', 'p1', [3]).expect(200);
  await soulRoll('S-SB-PICK', 5, 'AB', 'p2', [4]).expect(200);

  const locked = await soulPick('S-SB-PICK', 5, 'AB', 'p1', 'rift').expect(422);
  assert.match(locked.body.error.message, /尚未解锁/);

  const reforgePick = await soulPick('S-SB-PICK', 5, 'AB', 'p1', 'reforge').expect(422);
  assert.match(reforgePick.body.error.message, /重铸/);

  await soulPick('S-SB-PICK', 5, 'AB', 'p1', 'storage').expect(200);
  assert.equal(getS6Data('S-SB-PICK').treasury.AB.inventory.storage, 2);

  const duplicate = await soulPick('S-SB-PICK', 5, 'AB', 'p2', 'storage').expect(422);
  assert.match(duplicate.body.error.message, /不可重复选择/);

  await soulPick('S-SB-PICK', 5, 'AB', 'p2', 'pause').expect(200);
  assert.equal(getS6Data('S-SB-PICK').treasury.AB.inventory.pause, 3);

  const extra = await soulPick('S-SB-PICK', 5, 'AB', 'p1', 'blade').expect(422);
  assert.match(extra.body.error.message, /只能选择 1 次/);
});

test('equal dice grant the later roller a second pick', async () => {
  insertS6Season('S-SB-EQUAL');

  await soulRoll('S-SB-EQUAL', 5, 'AB', 'p1', [4]).expect(200);
  await soulRoll('S-SB-EQUAL', 5, 'AB', 'p2', [4]).expect(200);

  const s6 = getS6Data('S-SB-EQUAL');
  assert.equal(s6.soulBond['5'].AB.total, 9);
  assert.equal(s6.soulBond['5'].AB.unlockTier, 2);

  // 先投的 p1 只能选 1 次
  await soulPick('S-SB-EQUAL', 5, 'AB', 'p1', 'pause').expect(200);
  const p1Extra = await soulPick('S-SB-EQUAL', 5, 'AB', 'p1', 'blade').expect(422);
  assert.match(p1Extra.body.error.message, /只能选择 1 次/);

  // 后投的 p2 可选 2 次
  await soulPick('S-SB-EQUAL', 5, 'AB', 'p2', 'blade').expect(200);
  await soulPick('S-SB-EQUAL', 5, 'AB', 'p2', 'block').expect(200);
  const p2Third = await soulPick('S-SB-EQUAL', 5, 'AB', 'p2', 'charge').expect(422);
  assert.match(p2Third.body.error.message, /最多选择 2 次/);
});

test('s6_reforge consumes a pick and recomputes total and tier', async () => {
  insertS6Season('S-SB-REFORGE');

  await soulRoll('S-SB-REFORGE', 5, 'AB', 'p1', [3]).expect(200);
  await soulRoll('S-SB-REFORGE', 5, 'AB', 'p2', [4]).expect(200);

  const badDice = await postAction('S-SB-REFORGE', 's6_reforge', {
    roundNo: 5, comboLabel: 'AB', playerId: 'p1', dice: 0
  }).expect(422);
  assert.match(badDice.body.error.message, /1-6/);

  await postAction('S-SB-REFORGE', 's6_reforge', {
    roundNo: 5, comboLabel: 'AB', playerId: 'p1', dice: 6
  }).expect(200);

  const s6 = getS6Data('S-SB-REFORGE');
  const combo = s6.soulBond['5'].AB;
  assert.equal(combo.rolls[0].used, 6);
  assert.equal(combo.rolls[0].reforged, true);
  assert.equal(combo.total, 10);
  assert.equal(combo.unlockTier, 3);
  assert.deepEqual(combo.picks, [{ playerId: 'p1', cardId: 'reforge' }]);

  // 重铸已占用 p1 的选择次数
  const p1Pick = await soulPick('S-SB-REFORGE', 5, 'AB', 'p1', 'rift').expect(422);
  assert.match(p1Pick.body.error.message, /只能选择 1 次/);

  // p2 可享受重铸后解锁的第三阶
  await soulPick('S-SB-REFORGE', 5, 'AB', 'p2', 'rift').expect(200);
});

test('s6_reforge requires tier 2 unlocked', async () => {
  insertS6Season('S-SB-REFORGE-LOCKED');

  await soulRoll('S-SB-REFORGE-LOCKED', 5, 'AB', 'p1', [2]).expect(200);
  await soulRoll('S-SB-REFORGE-LOCKED', 5, 'AB', 'p2', [3]).expect(200);

  const res = await postAction('S-SB-REFORGE-LOCKED', 's6_reforge', {
    roundNo: 5, comboLabel: 'AB', playerId: 'p1', dice: 6
  }).expect(422);
  assert.match(res.body.error.message, /第二阶/);
});

test('triumph reroll is limited to top-2 of the top phase, one use each', async () => {
  insertS6Season('S-SB-TRIUMPH');
  // 上篇 1-4 轮：p1/p2 全胜 → 凯旋前二
  for (let roundNo = 1; roundNo <= 4; roundNo += 1) {
    insertRound(`R-SB-TRIUMPH-${roundNo}`, 'S-SB-TRIUMPH', 'completed', roundNo);
    insertMatch({
      id: `M-SB-TRIUMPH-${roundNo}`,
      seasonId: 'S-SB-TRIUMPH',
      roundId: `R-SB-TRIUMPH-${roundNo}`,
      status: 'completed',
      winner: 'a',
      teamA: ['p1', 'p2'],
      teamB: ['p3', 'p4']
    });
  }

  await soulRoll('S-SB-TRIUMPH', 5, 'AB', 'p1', [2]).expect(200);
  await soulRoll('S-SB-TRIUMPH', 5, 'AB', 'p2', [3]).expect(200);
  await soulRoll('S-SB-TRIUMPH', 5, 'CD', 'p3', [2]).expect(200);

  // p3 非前二：无凯旋重投次数
  const denied = await soulRoll('S-SB-TRIUMPH', 5, 'CD', 'p3', [6], { rerollSource: 'triumph' }).expect(422);
  assert.match(denied.body.error.message, /没有可用的重投次数/);

  // p1 前二：可重投一次，总点数随新骰子重算
  await soulRoll('S-SB-TRIUMPH', 5, 'AB', 'p1', [6], { rerollSource: 'triumph' }).expect(200);
  const s6 = getS6Data('S-SB-TRIUMPH');
  assert.equal(s6.soulBond['5'].AB.rolls[0].used, 6);
  assert.equal(s6.soulBond['5'].AB.total, 9);
  assert.deepEqual(s6.soulBond['5'].AB.rerollsUsed, [{ playerId: 'p1', source: 'triumph' }]);

  const second = await soulRoll('S-SB-TRIUMPH', 5, 'AB', 'p1', [6], { rerollSource: 'triumph' }).expect(422);
  assert.match(second.body.error.message, /没有可用的重投次数/);

  const badSource = await soulRoll('S-SB-TRIUMPH', 5, 'AB', 'p2', [6], { rerollSource: 'magic' }).expect(422);
  assert.match(badSource.body.error.message, /重投来源/);
});

test('s5 shard rerolls are limited by pierce shard count', async () => {
  insertSeason({
    id: 'S-SB-S5-SOURCE',
    ruleId: 's5',
    totalRounds: 10,
    comebackData: { s5: { pierceCounts: { p3: 5 } } }
  });
  insertS6Season('S-SB-SHARD');

  await soulRoll('S-SB-SHARD', 5, 'CD', 'p3', [2]).expect(200);
  await soulRoll('S-SB-SHARD', 5, 'CD', 'p4', [3]).expect(200);

  // p3 贯穿 5 次 → 2 个碎片 → 可重投 2 次
  await soulRoll('S-SB-SHARD', 5, 'CD', 'p3', [4], { rerollSource: 's5_shard' }).expect(200);
  await soulRoll('S-SB-SHARD', 5, 'CD', 'p3', [6], { rerollSource: 's5_shard' }).expect(200);
  const third = await soulRoll('S-SB-SHARD', 5, 'CD', 'p3', [6], { rerollSource: 's5_shard' }).expect(422);
  assert.match(third.body.error.message, /没有可用的重投次数/);

  // p4 无碎片
  const denied = await soulRoll('S-SB-SHARD', 5, 'CD', 'p4', [6], { rerollSource: 's5_shard' }).expect(422);
  assert.match(denied.body.error.message, /没有可用的重投次数/);

  const s6 = getS6Data('S-SB-SHARD');
  assert.equal(s6.soulBond['5'].CD.rolls[0].used, 6);
  assert.equal(s6.soulBond['5'].CD.rerollsUsed.length, 2);
});

test('reroll without an existing roll is rejected', async () => {
  insertS6Season('S-SB-REROLL-EARLY');

  const res = await soulRoll('S-SB-REROLL-EARLY', 5, 'AB', 'p1', [3], { rerollSource: 's5_shard' }).expect(422);
  assert.match(res.body.error.message, /尚未投掷/);
});

test('creating an s6 combo round is blocked until both combos finish soul bond', async () => {
  insertS6Season('S-SB-ROUND');

  const blocked = await api
    .post('/api/rounds')
    .send({ id: 'R-SB-ROUND-5', seasonId: 'S-SB-ROUND', roundNo: 5 })
    .expect(422);
  assert.match(blocked.body.error.message, /灵魂契合/);

  // AB 完成掷骰但未选奖 → 仍然阻塞
  await soulRoll('S-SB-ROUND', 5, 'AB', 'p1', [3]).expect(200);
  await soulRoll('S-SB-ROUND', 5, 'AB', 'p2', [4]).expect(200);
  const noPicks = await api
    .post('/api/rounds')
    .send({ id: 'R-SB-ROUND-5', seasonId: 'S-SB-ROUND', roundNo: 5 })
    .expect(422);
  assert.match(noPicks.body.error.message, /灵魂契合/);

  await completeComboPicksOnly('S-SB-ROUND', 5, 'AB', ['p1', 'p2']);
  await completeCombo('S-SB-ROUND', 5, 'CD', ['p3', 'p4']);

  const created = await api
    .post('/api/rounds')
    .send({ id: 'R-SB-ROUND-5', seasonId: 'S-SB-ROUND', roundNo: 5 })
    .expect(201);

  assert.equal(created.body.data.beforeRoundSetup.type, 'soul_bond');
  const matches = getDbMatchesByRound('R-SB-ROUND-5');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].match_format, 'pa7');
  assert.deepEqual(JSON.parse(matches[0].team_a), ['p1', 'p2']);
  assert.deepEqual(JSON.parse(matches[0].team_b), ['p3', 'p4']);

  // 轮次创建后灵魂契合动作锁定
  const locked = await soulRoll('S-SB-ROUND', 5, 'AB', 'p1', [5], { rerollSource: 'triumph' }).expect(422);
  assert.match(locked.body.error.message, /该轮已创建/);
});

async function completeComboPicksOnly(seasonId, roundNo, comboLabel, [first, second]) {
  await soulPick(seasonId, roundNo, comboLabel, first, 'pause').expect(200);
  await soulPick(seasonId, roundNo, comboLabel, second, 'blade').expect(200);
}

test('reroll is rejected once any pick has been made', async () => {
  insertSeason({
    id: 'S-SB-REROLL-LOCKED-S5',
    ruleId: 's5',
    totalRounds: 10,
    comebackData: { s5: { pierceCounts: { p1: 4 } } }
  });
  insertS6Season('S-SB-REROLL-LOCKED');

  await soulRoll('S-SB-REROLL-LOCKED', 5, 'AB', 'p1', [2]).expect(200);
  await soulRoll('S-SB-REROLL-LOCKED', 5, 'AB', 'p2', [3]).expect(200);
  await soulPick('S-SB-REROLL-LOCKED', 5, 'AB', 'p1', 'pause').expect(200);

  const res = await soulRoll('S-SB-REROLL-LOCKED', 5, 'AB', 'p1', [6], { rerollSource: 's5_shard' }).expect(422);
  assert.match(res.body.error.message, /奖励选择完成后无法重投/);
});

test('unlock tier lower boundaries: totals 3/6 → tier 1, 10 → tier 3', async () => {
  insertS6Season('S-SB-BOUNDS');

  // total 1+2=3 → 第一阶下限
  await soulRoll('S-SB-BOUNDS', 5, 'AB', 'p1', [1]).expect(200);
  await soulRoll('S-SB-BOUNDS', 5, 'AB', 'p2', [2]).expect(200);
  assert.equal(getS6Data('S-SB-BOUNDS').soulBond['5'].AB.unlockTier, 1);

  // total 2+4=6 → 第一阶上限
  await soulRoll('S-SB-BOUNDS', 5, 'CD', 'p3', [2]).expect(200);
  await soulRoll('S-SB-BOUNDS', 5, 'CD', 'p4', [4]).expect(200);
  assert.equal(getS6Data('S-SB-BOUNDS').soulBond['5'].CD.unlockTier, 1);

  // total 4+6=10 → 第三阶下限
  await soulRoll('S-SB-BOUNDS', 6, 'AC', 'p1', [4]).expect(200);
  await soulRoll('S-SB-BOUNDS', 6, 'AC', 'p3', [6]).expect(200);
  assert.equal(getS6Data('S-SB-BOUNDS').soulBond['6'].AC.unlockTier, 3);
});

test('season completion writes s6 champion and comboChampion', async () => {
  insertS6Season('S-SB-COMPLETE');

  // 上篇 1-4 轮：p1/p2 所在方全胜
  for (let roundNo = 1; roundNo <= 4; roundNo += 1) {
    insertRound(`R-SB-COMPLETE-${roundNo}`, 'S-SB-COMPLETE', 'completed', roundNo);
    insertMatch({
      id: `M-SB-COMPLETE-${roundNo}`,
      seasonId: 'S-SB-COMPLETE',
      roundId: `R-SB-COMPLETE-${roundNo}`,
      status: 'completed',
      winner: 'a',
      teamA: ['p1', 'p2'],
      teamB: ['p3', 'p4']
    });
  }

  // 下篇 5-6 轮已完赛（各一场 PA7），第 7 轮进行中
  insertRound('R-SB-COMPLETE-5', 'S-SB-COMPLETE', 'completed', 5);
  insertMatch({
    id: 'M-SB-COMPLETE-5', seasonId: 'S-SB-COMPLETE', roundId: 'R-SB-COMPLETE-5',
    bestOf: 7, status: 'completed', winner: 'a', teamA: ['p1', 'p2'], teamB: ['p3', 'p4']
  });
  insertRound('R-SB-COMPLETE-6', 'S-SB-COMPLETE', 'completed', 6);
  insertMatch({
    id: 'M-SB-COMPLETE-6', seasonId: 'S-SB-COMPLETE', roundId: 'R-SB-COMPLETE-6',
    bestOf: 7, status: 'completed', winner: 'a', teamA: ['p1', 'p3'], teamB: ['p2', 'p4']
  });
  insertRound('R-SB-COMPLETE-7', 'S-SB-COMPLETE', 'in_progress', 7);
  insertMatch({
    id: 'M-SB-COMPLETE-7', seasonId: 'S-SB-COMPLETE', roundId: 'R-SB-COMPLETE-7',
    bestOf: 7, status: 'pending', teamA: ['p1', 'p4'], teamB: ['p2', 'p3']
  });

  const games = await startMatch('M-SB-COMPLETE-7');
  assert.equal(games.length, 7);
  for (const game of games) {
    await finishGame(game.id, 21, 0);
  }

  const season = prepare('SELECT status, champion_player_id, comeback_data FROM seasons WHERE id = ?')
    .get('S-SB-COMPLETE');
  assert.equal(season.status, 'completed');
  assert.equal(season.champion_player_id, 'p1');

  const s6 = JSON.parse(season.comeback_data).s6;
  assert.deepEqual(s6.comboChampion.players, ['p1', 'p2']);
  assert.equal(s6.comboChampion.wins, 1);
});
