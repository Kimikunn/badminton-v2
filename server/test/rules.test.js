const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRule } = require('../src/rules/adapter');
const standardRule = require('../src/rules/standard');
const { getRule } = require('../src/rules');
const { RULE_ID } = require('../src/constants');

test('normalizeRule fills missing hooks with safe defaults', () => {
  const rule = normalizeRule({ id: 'partial' }, standardRule);

  assert.equal(rule.id, 'partial');
  assert.equal(typeof rule.getGameConfig, 'function');
  assert.equal(typeof rule.validateGameEnd, 'function');
  assert.equal(typeof rule.afterGameCompleted, 'function');
  assert.equal(typeof rule.onGameReverted, 'function');
  assert.equal(typeof rule.afterRoundRecalculated, 'function');
  assert.equal(typeof rule.recordSeasonAction, 'function');
  assert.doesNotThrow(() => rule.afterGameCompleted({}, {}, {}));
  assert.doesNotThrow(() => rule.onGameReverted({}));
  assert.doesNotThrow(() => rule.afterRoundRecalculated({}));
  assert.deepEqual(rule.recordSeasonAction({}, 'unknown', {}), { validationError: '当前赛季不支持该操作' });
});

test('getRule returns normalized registered rules and falls back to standard', () => {
  const s5 = getRule(RULE_ID.S5);
  const unknown = getRule('unknown-rule');

  assert.equal(typeof s5.getGameConfig, 'function');
  assert.equal(typeof s5.validateGameEnd, 'function');
  assert.equal(typeof s5.afterGameCompleted, 'function');
  assert.equal(typeof s5.onGameReverted, 'function');
  assert.equal(typeof s5.afterRoundRecalculated, 'function');
  assert.equal(typeof s5.recordSeasonAction, 'function');
  assert.equal(unknown.id, RULE_ID.STANDARD);
});
