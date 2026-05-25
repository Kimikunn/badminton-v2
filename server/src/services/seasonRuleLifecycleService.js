const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { RULE_ID } = require('../constants');

function getS5RoundMode(dice) {
  return dice === 1 || dice === 6 ? 'mutation' : 'order';
}

function normalizeRoundDice(setup) {
  const value = setup?.roundDice?.dice ?? setup?.dice ?? setup?.roundDice ?? setup;
  return Number(value);
}

function getBeforeRoundRequirement(season) {
  if (season.rule_id !== RULE_ID.S5) return null;
  return {
    timing: 'beforeRound',
    type: 'dice',
    required: true,
    label: '赛前投骰'
  };
}

function validateBeforeRoundSetup(season, setup) {
  const requirement = getBeforeRoundRequirement(season);
  if (!requirement) return null;

  const dice = normalizeRoundDice(setup);
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return '第五赛季创建轮次前必须先投骰子';
  }

  return null;
}

function applyBeforeRoundSetup(season, roundNo, setup) {
  const requirement = getBeforeRoundRequirement(season);
  if (!requirement) return null;

  const dice = normalizeRoundDice(setup);
  const data = parseJson(season.comeback_data, {});
  const s5 = data.s5 || {};
  const roundDice = s5.roundDice || {};
  roundDice[String(roundNo)] = {
    dice,
    mode: getS5RoundMode(dice)
  };

  const nextData = {
    ...data,
    s5: {
      ...s5,
      roundDice,
      pierceCounts: s5.pierceCounts || {},
      debtRecords: s5.debtRecords || {},
      pauseUses: Array.isArray(s5.pauseUses) ? s5.pauseUses : [],
      debtSettlements: s5.debtSettlements || {}
    }
  };

  const serialized = stringifyJson(nextData);
  prepare('UPDATE seasons SET comeback_data = ? WHERE id = ?').run(serialized, season.id);
  season.comeback_data = serialized;

  return {
    timing: requirement.timing,
    type: requirement.type,
    roundDice: nextData.s5.roundDice[String(roundNo)]
  };
}

module.exports = {
  getBeforeRoundRequirement,
  validateBeforeRoundSetup,
  applyBeforeRoundSetup,
  getS5RoundMode
};
