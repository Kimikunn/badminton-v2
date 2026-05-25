function noop() {}
function unsupportedAction() {
  return { validationError: '当前赛季不支持该操作' };
}

function normalizeRule(rule, fallbackRule) {
  const source = rule || fallbackRule;

  return {
    id: source.id || fallbackRule.id,
    getGameConfig: source.getGameConfig || fallbackRule.getGameConfig,
    validateGameEnd: source.validateGameEnd || fallbackRule.validateGameEnd,
    afterGameCompleted: source.afterGameCompleted || noop,
    onGameReverted: source.onGameReverted || noop,
    afterRoundRecalculated: source.afterRoundRecalculated || noop,
    recordSeasonAction: source.recordSeasonAction || unsupportedAction
  };
}

module.exports = {
  normalizeRule
};
