const standardRule = require('./standard');
const s5Rule = require('./s5');
const { RULE_ID } = require('../constants');
const { normalizeRule } = require('./adapter');

const rawRules = {
  [RULE_ID.STANDARD]: standardRule,
  [RULE_ID.S2]: standardRule,
  [RULE_ID.S3]: standardRule,
  [RULE_ID.S4]: standardRule,
  [RULE_ID.S5]: s5Rule
};

const rules = Object.fromEntries(
  Object.entries(rawRules).map(([ruleId, rule]) => [ruleId, normalizeRule(rule, standardRule)])
);

function getRule(ruleId) {
  return rules[ruleId] || rules[RULE_ID.STANDARD];
}

module.exports = {
  getRule,
  rules
};
