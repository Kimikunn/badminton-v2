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
} = createTestHarness('badminton-s6p-flow-test-');

test.before(async () => {
  await setupTestDb({ players: ['p1', 'p2', 'p3', 'p4'] });
});

test.after(() => {
  closeTestDb();
});

// 幸运数固定为 {1:4, 2:5}（测试确定化；真实建季由 seasonService 随机生成）
const S6P_LUCKY = { 1: 4, 2: 5, 3: 6, 4: 4, 5: 5, 6: 6 };

function insertS6pSeason(id, { resetDice = [] } = {}) {
  insertSeason({
    id,
    ruleId: 's6p',
    totalRounds: 6,
    comebackData: { s6p: { lucky: { ...S6P_LUCKY }, resetDice } }
  });
}

function postAction(seasonId, actionId, body) {
  return api.post(`/api/seasons/${seasonId}/actions/${actionId}`).send(body);
}

function getS6pData(seasonId) {
  return JSON.parse(prepare('SELECT comeback_data FROM seasons WHERE id = ?').get(seasonId).comeback_data).s6p;
}

function soulRoll(seasonId, roundNo, comboLabel, playerId, dice) {
  return postAction(seasonId, 's6p_soul_roll', { roundNo, comboLabel, playerId, rollChoice: dice.length, dice });
}

function soulPick(seasonId, roundNo, comboLabel, playerId, cardId) {
  return postAction(seasonId, 's6p_soul_pick', { roundNo, comboLabel, playerId, cardId });
}

// 组合赛逐局推进：提交全部 4 人「不使用」暗选（免录入局容忍已自动开始）后 start
async function advanceGameWithNullPicks(seasonId, matchId, gameNo, players4) {
  for (const pid of players4) {
    const res = await postAction(seasonId, 's6p_card_activate', { matchId, gameNo, playerId: pid, cardId: null });
    if (res.status !== 200 && !/已提交暗选|该局已开始|比赛进行中/.test(res.body?.error?.message || '')) {
      assert.fail(`G${gameNo} ${pid} 暗选失败: ${res.body?.error?.message || res.status}`);
    }
  }
  await api.post(`/api/matches/${matchId}/start`).expect(200);
}

// 打满一场 PA7（每局之间按需暗选），胜方序列 side 'a'/'b'
async function playOutComboMatch(seasonId, matchId, players4, gameWinners) {
  for (let i = 0; i < gameWinners.length; i++) {
    const gameNo = i + 1;
    await advanceGameWithNullPicks(seasonId, matchId, gameNo, players4);
    const games = prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
    const current = games.find(g => g.game_no === gameNo);
    const side = gameWinners[i];
    await finishGame(current.id, side === 'a' ? 21 : 10, side === 'a' ? 10 : 21);
  }
}

// 双循环重复轮（4-6）：完成指定轮次的灵魂契合（每人一选，避开本轮幸运数）→ 建轮 →
// 断言固定对阵。返回 matchId。
async function buildRepeatComboRound(seasonId, roundNo, combos, expected) {
  const lucky = getS6pData(seasonId).lucky[String(roundNo)];
  const pick = (exclude) => [1, 2, 3, 4, 5, 6].find(v => v !== lucky && !exclude.includes(v));
  for (const combo of combos) {
    const d1 = pick([]);
    const d2 = pick([d1]);
    await soulRoll(seasonId, roundNo, combo.label, combo.p1, [d1]).expect(200);
    await soulRoll(seasonId, roundNo, combo.label, combo.p2, [d2]).expect(200);
    await soulPick(seasonId, roundNo, combo.label, combo.p1, 'pause').expect(200);
    await soulPick(seasonId, roundNo, combo.label, combo.p2, 'blade').expect(200);
  }
  const res = await api.post('/api/rounds').send({ seasonId, roundNo });
  assert.equal(res.status, 201, `第 ${roundNo} 轮创建被拒: ${JSON.stringify(res.body?.error?.message || res.body)}`);
  const round = prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = ?').get(seasonId, roundNo);
  const matches = getDbMatchesByRound(round.id);
  assert.equal(matches.length, 1);
  assert.deepEqual(JSON.parse(matches[0].team_a), expected[0]);
  assert.deepEqual(JSON.parse(matches[0].team_b), expected[1]);
  return matches[0].id;
}

// S6+ 双循环六轮全流程：种子=ID 排序（p1-p4 → A-D），R1/R4=AB-CD、R2/R5=AC-BD、R3/R6=AD-BC
test('s6p soul bond rounds 1-6 (double round-robin), creation, pairing and completion', async () => {
  const seasonId = 'S-s6p-flow-1';
  insertS6pSeason(seasonId);

  // 未完成灵魂契合时创建轮次被拒
  await api.post('/api/rounds').send({ seasonId, roundNo: 1 }).expect(422);

  const lucky1 = getS6pData(seasonId).lucky['1'];
  // AB：3+4=7（第二阶）；骰值避开本轮幸运数
  await soulRoll(seasonId, 1, 'AB', 'p1', [lucky1 === 3 ? 4 : 3]).expect(200);
  await soulRoll(seasonId, 1, 'AB', 'p2', [lucky1 === 4 ? 5 : 4]).expect(200);
  await soulPick(seasonId, 1, 'AB', 'p1', 'pause').expect(200);
  await soulPick(seasonId, 1, 'AB', 'p2', 'blade').expect(200);

  // CD：同点 5+5 → 总 11（第三阶，后投者选 2 次）；骰点避开幸运数
  const cdDie = [5, 6, 2, 1, 4, 3].find(v => v !== lucky1);
  await soulRoll(seasonId, 1, 'CD', 'p3', [cdDie]).expect(200);
  await soulRoll(seasonId, 1, 'CD', 'p4', [cdDie]).expect(200);
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
  const round1Matches = getDbMatchesByRound(prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = 1').get(seasonId).id);
  assert.equal(round1Matches.length, 1);
  const teamA = JSON.parse(round1Matches[0].team_a);
  const teamB = JSON.parse(round1Matches[0].team_b);
  assert.deepEqual(teamA, ['p1', 'p2']);
  assert.deepEqual(teamB, ['p3', 'p4']);

  // 状态落盘：种子持久化 + 宝库库存 + 幸运数
  const s6p = getS6pData(seasonId);
  assert.deepEqual(s6p.seeds, { A: 'p1', B: 'p2', C: 'p3', D: 'p4' });
  assert.equal(s6p.soulBond['1'].AB.total, (lucky1 === 3 ? 4 : 3) + (lucky1 === 4 ? 5 : 4));
  assert.equal(s6p.soulBond['1'].CD.total, cdDie * 2 + 1);
  assert.equal(s6p.treasury.AB.inventory.pause, 3);
  assert.equal(s6p.treasury.CD.inventory.rift, 1);
  assert.equal(s6p.treasury.CD.inventory.storage, 2);

  // 第 1 轮 PA7 打满：AB 胜 CD
  await playOutComboMatch(seasonId, round1Matches[0].id, [teamA[0], teamA[1], teamB[0], teamB[1]], ['a', 'a', 'a', 'b', 'b', 'a', 'b']);

  // 第 2 轮灵魂契合（AC/BD）→ 建轮
  const lucky2 = S6P_LUCKY[2];
  await soulRoll(seasonId, 2, 'AC', 'p1', [lucky2 === 4 ? 3 : 4]).expect(200);
  await soulRoll(seasonId, 2, 'AC', 'p3', [lucky2 === 5 ? 2 : 5]).expect(200);
  await soulPick(seasonId, 2, 'AC', 'p3', 'charge').expect(200);
  await soulPick(seasonId, 2, 'AC', 'p1', 'pause').expect(200);
  await soulRoll(seasonId, 2, 'BD', 'p2', [lucky2 === 4 ? 5 : 4]).expect(200);
  await soulRoll(seasonId, 2, 'BD', 'p4', [lucky2 === 4 ? 5 : 4]).expect(200);
  await soulPick(seasonId, 2, 'BD', 'p4', 'yuebai').expect(200);
  await soulPick(seasonId, 2, 'BD', 'p4', 'storage').expect(200);
  await soulPick(seasonId, 2, 'BD', 'p2', 'feihong').expect(200);

  const round2Res = await api.post('/api/rounds').send({ seasonId, roundNo: 2 });
  if (round2Res.status !== 201) {
    const d = getS6pData(seasonId);
    console.log('DBG-R2BOND', JSON.stringify({ AC: d.soulBond?.['2']?.AC, BD: d.soulBond?.['2']?.BD }));
  }
  assert.equal(round2Res.status, 201, `第 2 轮创建被拒: ${JSON.stringify(round2Res.body?.error?.message || round2Res.body)}`);
  const round2Matches = getDbMatchesByRound(prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = 2').get(seasonId).id);
  assert.equal(round2Matches.length, 1);
  assert.deepEqual(JSON.parse(round2Matches[0].team_a), ['p1', 'p3']);
  assert.deepEqual(JSON.parse(round2Matches[0].team_b), ['p2', 'p4']);

  // 第 7 轮超出六轮边界 → 422
  const overRound = await postAction(seasonId, 's6p_soul_roll', { roundNo: 7, comboLabel: 'AB', playerId: 'p1', rollChoice: 1, dice: [3] });
  assert.match(overRound.body?.error?.message || '', /灵魂契合仅适用于第 1-6 轮/);

  // 第 2 轮 PA7 打满
  await playOutComboMatch(seasonId, round2Matches[0].id, ['p1', 'p3', 'p2', 'p4'], ['a', 'a', 'a', 'b', 'b', 'a', 'b']);

  // 第 3 轮灵魂契合（AD/BC）→ 建轮
  const lucky3 = S6P_LUCKY[3];
  await soulRoll(seasonId, 3, 'AD', 'p1', [lucky3 === 4 ? 3 : 4]).expect(200);
  await soulRoll(seasonId, 3, 'AD', 'p4', [lucky3 === 5 ? 2 : 5]).expect(200);
  await soulPick(seasonId, 3, 'AD', 'p1', 'pause').expect(200);
  await soulPick(seasonId, 3, 'AD', 'p4', 'blade').expect(200);
  await soulRoll(seasonId, 3, 'BC', 'p2', [lucky3 === 5 ? 2 : 5]).expect(200);
  await soulRoll(seasonId, 3, 'BC', 'p3', [lucky3 === 3 ? 6 : 3]).expect(200);
  await soulPick(seasonId, 3, 'BC', 'p2', 'charge').expect(200);
  await soulPick(seasonId, 3, 'BC', 'p3', 'block').expect(200);

  const round3Res = await api.post('/api/rounds').send({ seasonId, roundNo: 3 });
  assert.equal(round3Res.status, 201, `第 3 轮创建被拒: ${JSON.stringify(round3Res.body?.error?.message || round3Res.body)}`);
  const round3Matches = getDbMatchesByRound(prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = 3').get(seasonId).id);
  assert.equal(round3Matches.length, 1);
  assert.deepEqual(JSON.parse(round3Matches[0].team_a), ['p1', 'p4']);
  assert.deepEqual(JSON.parse(round3Matches[0].team_b), ['p2', 'p3']);

  // 第 3 轮 PA7 打满（双循环前半程结束）
  await playOutComboMatch(seasonId, round3Matches[0].id, ['p1', 'p4', 'p2', 'p3'], ['a', 'a', 'a', 'b', 'b', 'a', 'b']);

  // 双循环后半程：第 4-6 轮重复第 1-3 轮对阵（AB/CD、AC/BD、AD/BC）
  const round4MatchId = await buildRepeatComboRound(seasonId, 4,
    [{ label: 'AB', p1: 'p1', p2: 'p2' }, { label: 'CD', p1: 'p3', p2: 'p4' }],
    [['p1', 'p2'], ['p3', 'p4']]);
  await playOutComboMatch(seasonId, round4MatchId, ['p1', 'p2', 'p3', 'p4'], ['a', 'a', 'a', 'b', 'b', 'a', 'b']);

  const round5MatchId = await buildRepeatComboRound(seasonId, 5,
    [{ label: 'AC', p1: 'p1', p2: 'p3' }, { label: 'BD', p1: 'p2', p2: 'p4' }],
    [['p1', 'p3'], ['p2', 'p4']]);
  await playOutComboMatch(seasonId, round5MatchId, ['p1', 'p3', 'p2', 'p4'], ['b', 'b', 'b', 'a', 'a', 'b', 'a']);

  const round6MatchId = await buildRepeatComboRound(seasonId, 6,
    [{ label: 'AD', p1: 'p1', p2: 'p4' }, { label: 'BC', p1: 'p2', p2: 'p3' }],
    [['p1', 'p4'], ['p2', 'p3']]);
  await playOutComboMatch(seasonId, round6MatchId, ['p1', 'p4', 'p2', 'p3'], ['a', 'a', 'a', 'b', 'b', 'a', 'b']);

  const finished = prepare('SELECT status, winner FROM matches WHERE id = ?').get(round2Matches[0].id);
  assert.equal(finished.winner, 'a');
  const season = prepare('SELECT status, champion_player_id FROM seasons WHERE id = ?').get(seasonId);
  assert.equal(season.status, 'completed');
  // 六轮胜场：p1=5（AB×2/AC/AD×2），p2=3，p3=1，p4=3 → 冠军 p1
  assert.equal(season.champion_player_id, 'p1');
});

// S6+ 奇招：投中幸运数须先完成二选一才能选奖；plus1 计入总点数
test('s6p lucky hit gates picks; plus-one adds to combo total', async () => {
  const seasonId = 'S-s6p-flow-2';
  insertS6pSeason(seasonId);
  const lucky = S6P_LUCKY[1];

  // p1 投中幸运数
  await soulRoll(seasonId, 1, 'AB', 'p1', [lucky]).expect(200);
  // p2 避开幸运数
  await soulRoll(seasonId, 1, 'AB', 'p2', [lucky === 4 ? 5 : 4]).expect(200);

  // 奇招未决 → 选奖被拒
  const pickBlocked = await soulPick(seasonId, 1, 'AB', 'p1', 'pause');
  assert.match(pickBlocked.body?.error?.message || '', /奇招选择未完成/);

  // 二选一：总点数 +1 → 落盘并重算
  await postAction(seasonId, 's6p_lucky_choice', { roundNo: 1, comboLabel: 'AB', playerId: 'p1', choice: 'plus1' }).expect(200);
  const s6p = getS6pData(seasonId);
  const combo = s6p.soulBond['1'].AB;
  assert.equal(combo.rolls[0].luckyChoice, 'plus1');
  assert.equal(s6p.luckyBonus['1'].AB, 1);
  assert.equal(combo.total, combo.rolls[0].used + combo.rolls[1].used + 1);
  // 加成后选奖恢复
  await soulPick(seasonId, 1, 'AB', 'p1', 'pause').expect(200);
});

// S6+ 奇招：重掷一次替换计分值（不占奖励选择次数）
test('s6p lucky reroll replaces own used value', async () => {
  const seasonId = 'S-s6p-flow-3';
  insertS6pSeason(seasonId);
  const lucky = S6P_LUCKY[1];

  await soulRoll(seasonId, 1, 'AB', 'p1', [lucky]).expect(200);
  await soulRoll(seasonId, 1, 'AB', 'p2', [lucky === 2 ? 3 : 2]).expect(200);

  await postAction(seasonId, 's6p_lucky_choice', { roundNo: 1, comboLabel: 'AB', playerId: 'p1', choice: 'reroll', dice: 6 }).expect(200);
  const combo = getS6pData(seasonId).soulBond['1'].AB;
  assert.equal(combo.rolls[0].used, 6);
  assert.equal(combo.rolls[0].rollChoice, 1);
  assert.equal(combo.rolls[0].luckyChoice, 'reroll');
  assert.equal(combo.rolls[0].luckyRerolled, true);
});

// S6+ 重置骰子：持有者整季 1 次重掷本人投掷；无骰者与非持有者均被拒
test('s6p reset die rerolls once per holder', async () => {
  const seasonId = 'S-s6p-flow-4';
  insertS6pSeason(seasonId, { resetDice: ['p1'] });
  const lucky1 = S6P_LUCKY[1];

  await soulRoll(seasonId, 1, 'AB', 'p1', [lucky1 === 3 ? 4 : 3]).expect(200);
  const p2Roll = await soulRoll(seasonId, 1, 'AB', 'p2', [lucky1 === 4 ? 5 : 4]);
  if (p2Roll.status !== 200) console.log('DBG-P2ROLL', JSON.stringify(p2Roll.body));
  assert.equal(p2Roll.status, 200);

  // 非持有者（p2）重掷被拒
  const outsider = await postAction(seasonId, 's6p_soul_roll', { roundNo: 1, comboLabel: 'AB', playerId: 'p2', rollChoice: 1, dice: [2], rerollSource: 'reset_dice' });
  console.log('DBG-OUTSIDER', outsider.status, JSON.stringify(outsider.body).slice(0, 160));
  assert.match(outsider.body?.error?.message || '', /没有可用的重投次数/);

  // 持有者 p1 重掷成功：新值替换
  const holderRes = await postAction(seasonId, 's6p_reset_roll', { roundNo: 1, comboLabel: 'AB', playerId: 'p1', rollChoice: 1, dice: [6], rerollSource: 'reset_dice' });
  if (holderRes.status !== 200) console.log('DBG-HOLDER', JSON.stringify(holderRes.body));
  assert.equal(holderRes.status, 200);
  const combo = getS6pData(seasonId).soulBond['1'].AB;
  assert.equal(combo.rolls.find(r => r.playerId === 'p1').used, 6);

  // 第二次重掷被拒（整季 1 次，同轮同组合再掷）
  const second = await postAction(seasonId, 's6p_reset_roll', { roundNo: 1, comboLabel: 'AB', playerId: 'p1', rollChoice: 1, dice: [2], rerollSource: 'reset_dice' });
  console.log('DBG-SECOND', second.status, JSON.stringify(second.body).slice(0, 160));
  assert.match(second.body?.error?.message || '', /没有可用的重投次数/);
});

// S6+ 月白局：被作用方获胜须在赛点后连拿两分（21 分制即 22 分起步；30:29 逃生）
test('s6p yuebai game requires two straight points at game point', async () => {
  const seasonId = 'S-s6p-flow-5';
  insertS6pSeason(seasonId);
  const lucky1 = S6P_LUCKY[1];

  // AB 组合第二阶（7 点）→ p1 选月白
  await soulRoll(seasonId, 1, 'AB', 'p1', [lucky1 === 3 ? 4 : 3]).expect(200);
  await soulRoll(seasonId, 1, 'AB', 'p2', [lucky1 === 4 ? 5 : 4]).expect(200);
  await soulPick(seasonId, 1, 'AB', 'p1', 'yuebai').expect(200);
  await soulPick(seasonId, 1, 'AB', 'p2', 'blade').expect(200);
  const yuebaiUses = getS6pData(seasonId).treasury.AB.inventory.yuebai;
  assert.equal(yuebaiUses, 2);

  // CD 组合完成（未解锁则无需选奖）
  const cdDie = [2, 1].find(v => v !== lucky1);
  await soulRoll(seasonId, 1, 'CD', 'p3', [cdDie]).expect(200);
  await soulRoll(seasonId, 1, 'CD', 'p4', [cdDie === 2 ? 1 : 2]).expect(200);
  const cdBond = getS6pData(seasonId).soulBond['1'].CD;
  if (cdBond.unlockTier !== null && cdBond.unlockTier !== undefined) {
    const p3pick = await soulPick(seasonId, 1, 'CD', 'p3', 'pause');
    console.log('DBG-P3PICK', p3pick.status, JSON.stringify(p3pick.body).slice(0, 120));
    assert.equal(p3pick.status, 200);
    const p4pick = await soulPick(seasonId, 1, 'CD', 'p4', 'blade');
    console.log('DBG-P4PICK', p4pick.status, JSON.stringify(p4pick.body).slice(0, 120));
    assert.equal(p4pick.status, 200);
  }

  const round1Res = await api.post('/api/rounds').send({ seasonId, roundNo: 1 });
  if (round1Res.status !== 201) {
    const d = getS6pData(seasonId);
    console.log('DBG-R1BOND', JSON.stringify({ AB: d.soulBond?.['1']?.AB, CD: d.soulBond?.['1']?.CD }));
  }
  assert.equal(round1Res.status, 201, `第 1 轮创建被拒: ${JSON.stringify(round1Res.body?.error?.message || round1Res.body)}`);
  const matchId = getDbMatchesByRound(prepare('SELECT id FROM rounds WHERE season_id = ? AND round_no = 1').get(seasonId).id)[0].id;

  // G1 暗选：p1 启用月白（作用 B 方）；余者不使用
  await postAction(seasonId, 's6p_card_activate', { matchId, gameNo: 1, playerId: 'p1', cardId: 'yuebai' }).expect(200);
  for (const pid of ['p2', 'p3', 'p4']) {
    await postAction(seasonId, 's6p_card_activate', { matchId, gameNo: 1, playerId: pid, cardId: null }).expect(200);
  }
  const startRes = await api.post(`/api/matches/${matchId}/start`);
  console.log('DBG-START', startRes.status, JSON.stringify(startRes.body).slice(0, 180));
  assert.equal(startRes.status, 200);
  const games = prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);

  // B 方（被作用方）21:19 → 拒绝（赛点只拿 1 分）
  await finishGame(games[0].id, 19, 21).catch(() => {});
  const game1 = prepare('SELECT * FROM games WHERE id = ?').get(games[0].id);
  if (game1.status !== 'completed') {
    // 422 路径：比分仍在进行中；改用直接断言 end 422
    const endRes = await api.post(`/api/games/${games[0].id}/end`).send({});
    assert.equal(endRes.status, 422);
  } else {
    assert.fail('月白局 21:19 不应结束');
  }

  // B 方 22:20 → 允许（赛点后连拿两分）
  await finishGame(games[0].id, 20, 22);
});

// 无效轮次/动作拦截
test('s6p rejects king-era actions and out-of-range rounds', async () => {
  const seasonId = 'S-s6p-flow-6';
  insertS6pSeason(seasonId);
  const outOfRange = await postAction(seasonId, 's6p_soul_roll', { roundNo: 7, comboLabel: 'AB', playerId: 'p1', rollChoice: 1, dice: [3] });
  assert.match(outOfRange.body?.error?.message || '', /灵魂契合仅适用于第 1-6 轮/);
  const kingAction = await postAction(seasonId, 's6p_king_roll', { order: [] });
  assert.match(kingAction.body?.error?.message || kingAction.body?.error || '', /S6\+ 延长赛不支持该操作/);
  const wrongCombo = await postAction(seasonId, 's6p_soul_roll', { roundNo: 2, comboLabel: 'AC', playerId: 'p2', rollChoice: 1, dice: [3] });
  assert.match(wrongCombo.body?.error?.message || wrongCombo.body?.error || '', /该选手不属于此组合/);
});
