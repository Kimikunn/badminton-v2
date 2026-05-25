const test = require('node:test');
const assert = require('node:assert/strict');
const { canEndGame, checkMatchComplete } = require('../src/services/scoringService');

test('canEndGame accepts standard 21-point wins', () => {
  assert.deepEqual(canEndGame(21, 19), { canEnd: true, winner: 'a', reason: '' });
  assert.deepEqual(canEndGame(18, 21), { canEnd: true, winner: 'b', reason: '' });
});

test('canEndGame rejects unfinished or tied games', () => {
  assert.equal(canEndGame(20, 20).canEnd, false);
  assert.equal(canEndGame(21, 20).canEnd, false);
  assert.equal(canEndGame(18, 16).canEnd, false);
});

test('canEndGame handles deuce and current 30-point cap behavior', () => {
  assert.deepEqual(canEndGame(22, 20), { canEnd: true, winner: 'a', reason: '' });
  assert.deepEqual(canEndGame(29, 27), { canEnd: true, winner: 'a', reason: '' });
  assert.deepEqual(canEndGame(30, 28), { canEnd: true, winner: 'a', reason: '' });
  assert.deepEqual(canEndGame(30, 29), { canEnd: true, winner: 'a', reason: '' });
  assert.equal(canEndGame(31, 29).canEnd, false);
});

test('canEndGame rejects scores that should have ended earlier', () => {
  assert.equal(canEndGame(23, 20).canEnd, false);
});

test('canEndGame supports S5 mutation 15-point games', () => {
  assert.deepEqual(canEndGame(15, 13, { targetScore: 15 }), { canEnd: true, winner: 'a', reason: '' });
  assert.equal(canEndGame(15, 14, { targetScore: 15 }).canEnd, false);
  assert.deepEqual(canEndGame(21, 20, { targetScore: 15 }), { canEnd: true, winner: 'a', reason: '' });
  assert.equal(canEndGame(22, 20, { targetScore: 15 }).canEnd, false);
});

test('checkMatchComplete handles BO1, BO3, and PA7', () => {
  assert.deepEqual(checkMatchComplete([{ winner: 'a' }], 1), { isComplete: true, winner: 'a' });
  assert.deepEqual(checkMatchComplete([{ winner: 'a' }, { winner: 'b' }], 3), { isComplete: false, winner: null });
  assert.deepEqual(checkMatchComplete([{ winner: 'a' }, { winner: 'b' }, { winner: 'a' }], 3), { isComplete: true, winner: 'a' });
  assert.deepEqual(checkMatchComplete([
    { winner: 'a' }, { winner: 'a' }, { winner: 'a' }, { winner: 'a' }
  ], 7, 'pa7'), { isComplete: false, winner: null });
  assert.deepEqual(checkMatchComplete([
    { winner: 'a' }, { winner: 'b' }, { winner: 'a' }, { winner: 'b' },
    { winner: 'a' }, { winner: 'b' }, { winner: 'b' }
  ], 7, 'pa7'), { isComplete: true, winner: 'b' });
});
