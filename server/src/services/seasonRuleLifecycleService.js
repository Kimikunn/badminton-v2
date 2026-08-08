const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { RULE_ID } = require('../constants');
const s6Rule = require('../rules/s6');

function getS5RoundMode(dice) {
  return dice === 1 || dice === 6 ? 'mutation' : 'order';
}

function normalizeRoundDice(setup) {
  const value = setup?.roundDice?.dice ?? setup?.dice ?? setup?.roundDice ?? setup;
  return Number(value);
}

const S6_TOP_ROUND_MAX = 4;

function isS6TopRound(season, roundNo) {
  return season.rule_id === RULE_ID.S6 && Number(roundNo) >= 1 && Number(roundNo) <= S6_TOP_ROUND_MAX;
}

function isS6ComboRound(season, roundNo) {
  return season.rule_id === RULE_ID.S6 && Number(roundNo) > S6_TOP_ROUND_MAX;
}

// 返回创建指定轮次前必须完成的赛前准备；无要求时返回 null。
// S5：赛前投骰；S6 上篇（1-4 轮）：王选掷骰 + 王形态；
// S6 下篇（5-7 轮）：两个组合的灵魂契合（掷骰 + 选奖）全部完成。
function getBeforeRoundRequirement(season, roundNo) {
  if (season.rule_id === RULE_ID.S5) {
    return {
      timing: 'beforeRound',
      type: 'dice',
      required: true,
      label: '赛前投骰'
    };
  }
  if (isS6TopRound(season, roundNo)) {
    return {
      timing: 'beforeRound',
      type: 'king_selection',
      required: true,
      label: '王选'
    };
  }
  if (isS6ComboRound(season, roundNo)) {
    return {
      timing: 'beforeRound',
      type: 'soul_bond',
      required: true,
      label: '灵魂契合'
    };
  }
  return null;
}

function getS6TopKing(season, roundNo) {
  const data = parseJson(season.comeback_data, {});
  return data.s6?.topKings?.[String(roundNo)] || null;
}

function getS6SoulBond(season, roundNo) {
  const data = parseJson(season.comeback_data, {});
  return data.s6?.soulBond?.[String(roundNo)] || null;
}

function validateBeforeRoundSetup(season, setup, roundNo) {
  const requirement = getBeforeRoundRequirement(season, roundNo);
  if (!requirement) return null;

  if (requirement.type === 'king_selection') {
    const king = getS6TopKing(season, roundNo);
    if (!king?.kingId) return '第六赛季创建上篇轮次前必须先完成王选掷骰';
    if (!king.form) return '请先为本轮的王选择形态';
    return null;
  }

  if (requirement.type === 'soul_bond') {
    if (!s6Rule.isSoulBondCompleteForRound(season, roundNo)) {
      return '第六赛季创建下篇轮次前必须先完成两个组合的灵魂契合';
    }
    return null;
  }

  const dice = normalizeRoundDice(setup);
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return '第五赛季创建轮次前必须先投骰子';
  }

  return null;
}

function applyBeforeRoundSetup(season, roundNo, setup) {
  const requirement = getBeforeRoundRequirement(season, roundNo);
  if (!requirement) return null;

  // S6 王选/灵魂契合状态已通过赛季动作持久化，这里只做回显
  if (requirement.type === 'king_selection') {
    return {
      timing: requirement.timing,
      type: requirement.type,
      topKing: getS6TopKing(season, roundNo)
    };
  }

  if (requirement.type === 'soul_bond') {
    return {
      timing: requirement.timing,
      type: requirement.type,
      soulBond: getS6SoulBond(season, roundNo)
    };
  }

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
