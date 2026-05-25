/**
 * S5赛季规则
 * 10轮 BO3。每轮赛前掷骰：1/6 为异变（15分制），其余为秩序（21分制）。
 * 排名仍按大分 > 小分 > 得分；贯穿奖励通过 comebackData.s5.pierceCounts 记录。
 */

import { STATUS } from '@/constants'

const MUTATION_DICE = new Set([1, 6])

function getS5Data(context = {}) {
  return context?.season?.comebackData?.s5 || {}
}

function getRoundDice(roundNo, context = {}) {
  const data = getS5Data(context)
  const value = data?.roundDice?.[String(roundNo)]
  if (!value) return null
  const dice = Number(value.dice || 0)
  if (dice < 1 || dice > 6) return null
  return {
    dice,
    mode: value.mode || (MUTATION_DICE.has(dice) ? 'mutation' : 'order')
  }
}

function getPierceReward(count) {
  const safeCount = Math.max(0, Number(count || 0))
  return {
    pierceCount: safeCount,
    bonusSmallScore: safeCount >= 1 ? 2 : 0,
    bonusBigScore: (safeCount >= 2 ? 1 : 0) + (safeCount >= 3 ? 1 : 0),
    pauseSeconds: safeCount >= 1 ? 45 : 0,
    shards: Math.max(0, safeCount - 3)
  }
}

function getDebtRecords(context = {}) {
  return Object.values(getS5Data(context)?.debtRecords || {})
}

function getDebtSummary(playerId, context = {}) {
  const summary = { debtCount: 0, creditCount: 0 }
  for (const record of getDebtRecords(context)) {
    if (record.debtors?.includes(playerId)) summary.debtCount += 1
    if (record.creditors?.includes(playerId)) summary.creditCount += 1
  }
  return summary
}

function compareRankings(a, b) {
  if ((b.finalBigScore ?? 0) !== (a.finalBigScore ?? 0)) return (b.finalBigScore ?? 0) - (a.finalBigScore ?? 0)
  if ((b.finalSmallScore ?? 0) !== (a.finalSmallScore ?? 0)) return (b.finalSmallScore ?? 0) - (a.finalSmallScore ?? 0)
  if ((b.totalPoints ?? 0) !== (a.totalPoints ?? 0)) return (b.totalPoints ?? 0) - (a.totalPoints ?? 0)
  return String(a.id).localeCompare(String(b.id))
}

export default {
  id: 's5',
  name: 'S5赛季规则',
  description: '异变/秩序骰子，15/21分制切换，贯穿奖励',
  lifecycle: {
    beforeRound: {
      type: 'dice',
      required: true,
      label: '赛前投骰'
    },
    roundStart: {
      type: 'matches'
    },
    afterRound: {
      type: 'ranking'
    }
  },

  getRoundMode(roundNo, context) {
    const roundDice = getRoundDice(roundNo, context)
    if (!roundDice) return { dice: null, mode: 'order', targetScore: 21, settled: false }
    return {
      ...roundDice,
      targetScore: roundDice.mode === 'mutation' ? 15 : 21,
      settled: true
    }
  },

  getGameConfig(roundNo, context) {
    const roundMode = this.getRoundMode(roundNo, context)
    if (roundMode.mode === 'mutation') {
      return {
        scoringMode: 'standard',
        targetScore: 15,
        maxScore: 21,
        requiresWinner: false,
        supportsPierce: false,
        roundMode
      }
    }

    return {
      scoringMode: 'resistance',
      targetScore: 21,
      maxScore: 30,
      requiresWinner: true,
      supportsPierce: true,
      roundMode
    }
  },

  calcPlayerScore(playerId, matches, getGamesByMatch, context) {
    let bigScore = 0
    let smallScore = 0
    let totalPoints = 0
    let wins = 0
    let losses = 0

    matches
      .filter(match => match.status === STATUS.COMPLETED)
      .forEach(match => {
        const isTeamA = match.teamA?.includes(playerId)
        const isTeamB = match.teamB?.includes(playerId)
        if (!isTeamA && !isTeamB) return

        const wonMatch = (isTeamA && match.winner === 'a') || (isTeamB && match.winner === 'b')
        if (wonMatch) {
          bigScore++
          wins++
        } else {
          losses++
        }

        getGamesByMatch(match.id).forEach(game => {
          if (game.status !== STATUS.COMPLETED) return
          if (isTeamA) {
            if (game.winner === 'a') smallScore++
            totalPoints += game.scoreA || 0
          } else {
            if (game.winner === 'b') smallScore++
            totalPoints += game.scoreB || 0
          }
        })
      })

    const pierce = getPierceReward(getS5Data(context)?.pierceCounts?.[playerId])
    const debt = getDebtSummary(playerId, context)

    return {
      bigScore,
      smallScore,
      totalPoints,
      wins,
      losses,
      ...pierce,
      ...debt,
      finalBigScore: bigScore + pierce.bonusBigScore,
      finalSmallScore: smallScore + pierce.bonusSmallScore
    }
  },

  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context) {
    return participants.map(playerId => {
      const player = getPlayerById(playerId)
      const scores = this.calcPlayerScore(playerId, matches, getGamesByMatch, context)
      return {
        ...player,
        id: playerId,
        ...scores,
        buffs: this.getPlayerBuffs(playerId, matches, getGamesByMatch, context)
      }
    }).sort(compareRankings)
  },

  getPlayerBuffs(playerId, matches, getGamesByMatch, context) {
    const buffs = []
    const reward = getPierceReward(getS5Data(context)?.pierceCounts?.[playerId])
    if (reward.pierceCount) {
      buffs.push({
        id: 'pierce',
        name: '贯穿',
        count: reward.pierceCount,
        settled: true,
        description: `贯穿${reward.pierceCount}次`
      })
    }

    const debt = getDebtSummary(playerId, context)
    if (debt.creditCount) {
      buffs.push({
        id: 'debt-credit',
        name: '债权',
        count: debt.creditCount,
        settled: true,
        description: `异变债务受益${debt.creditCount}次`
      })
    }
    if (debt.debtCount) {
      buffs.push({
        id: 'debt',
        name: '债务',
        count: debt.debtCount,
        settled: true,
        description: `异变债务${debt.debtCount}次`
      })
    }
    return buffs
  },

  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    return {
      buffs: [
        {
          id: 's5_round_dice',
          name: '异变/秩序',
          roundModes: (rounds || []).map(round => ({
            roundNo: round.roundNo,
            status: round.status,
            ...this.getRoundMode(round.roundNo, context)
          }))
        }
      ]
    }
  }
}
