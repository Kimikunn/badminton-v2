const { WINNER_SIDE } = require('../constants');

// 抵抗局终校验（S5 秩序 / S6 月白共用）：比分非负、不超过封顶、必须显式
// 选择胜方且胜方得分达到目标分；允许分低者获胜（如胜方 21:29）。
// config 需含 targetScore/maxScore。
function validateResistanceGame(config, input) {
  const scoreA = Number(input.scoreA || 0);
  const scoreB = Number(input.scoreB || 0);
  const winner = input.winner || null;

  if (scoreA < 0 || scoreB < 0) return { canEnd: false, winner: null, reason: '比分不能为负数' };
  if (scoreA > config.maxScore || scoreB > config.maxScore) {
    return { canEnd: false, winner: null, reason: `最高${config.maxScore}分封顶` };
  }
  if (!Object.values(WINNER_SIDE).includes(winner)) return { canEnd: false, winner: null, reason: '抵抗局需要选择胜方' };

  const winnerScore = winner === WINNER_SIDE.A ? scoreA : scoreB;
  if (winnerScore < config.targetScore) {
    return { canEnd: false, winner: null, reason: `抵抗局胜方需至少达到${config.targetScore}分` };
  }

  return { canEnd: true, winner, reason: '' };
}

module.exports = { validateResistanceGame };
