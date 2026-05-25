const { canEndGame } = require('../services/scoringService');
const { RULE_ID, SCORING_MODE } = require('../constants');

function getGameConfig() {
  return {
    scoringMode: SCORING_MODE.STANDARD,
    targetScore: 21,
    maxScore: 30,
    requiresWinner: false,
    supportsPierce: false
  };
}

function validateGameEnd(ctx, input) {
  const config = ctx.gameConfig || getGameConfig(ctx);
  return canEndGame(input.scoreA, input.scoreB, { targetScore: config.targetScore });
}

function afterGameCompleted() {}

function onGameReverted() {}

module.exports = {
  id: RULE_ID.STANDARD,
  getGameConfig,
  validateGameEnd,
  afterGameCompleted,
  onGameReverted
};
