/**
 * S4赛季规则
 * 上篇：前4轮个人星尘赛（BO3 + 轮次骰子）
 * 下篇：后3轮固定组合赛（AB / AC / AD 组合挑战）
 */

import { STATUS } from '@/constants'
import {
  getMatchesForRound,
  getMatchGameWins,
  calcComboRoundStats,
  buildComboRankings,
  resolveComboTie
} from './comboStardust'

const TOP_PHASE_LAST_ROUND = 4
const TOP_DICE_EFFECTS = {
  1: { name: '玄武的庇护', description: '分差5分内，败方也获得1星尘' },
  2: { name: '白虎的领域', description: '先到11分的队伍获得1星尘' },
  3: { name: '白虎的领域', description: '先到11分的队伍获得1星尘' },
  4: { name: '青龙的眷顾', description: '大场获胜+1星尘，2:0获得1张暂停卡' },
  5: { name: '青龙的眷顾', description: '大场获胜+1星尘，2:0获得1张暂停卡' },
  6: { name: '朱雀降临', description: '此轮星尘翻倍' }
}
const PRIMARY_COMBO_LABELS = ['AB', 'AC', 'AD']

const COMBO_CONFIGS = [
  { roundNo: 5, label: 'AB', opponentLabel: 'CD', seedKeys: ['A', 'B'], opponentSeedKeys: ['C', 'D'], perspective: 'a' },
  { roundNo: 6, label: 'AC', opponentLabel: 'BD', seedKeys: ['A', 'C'], opponentSeedKeys: ['B', 'D'], perspective: 'a' },
  { roundNo: 7, label: 'AD', opponentLabel: 'BC', seedKeys: ['A', 'D'], opponentSeedKeys: ['B', 'C'], perspective: 'a' },
  { roundNo: 5, label: 'CD', opponentLabel: 'AB', seedKeys: ['C', 'D'], opponentSeedKeys: ['A', 'B'], perspective: 'b' },
  { roundNo: 6, label: 'BD', opponentLabel: 'AC', seedKeys: ['B', 'D'], opponentSeedKeys: ['A', 'C'], perspective: 'b' },
  { roundNo: 7, label: 'BC', opponentLabel: 'AD', seedKeys: ['B', 'C'], opponentSeedKeys: ['A', 'D'], perspective: 'b' }
]

function getS4Data(context = {}) {
  return context?.season?.comebackData?.s4 || {}
}

function getTopDice(roundNo, s4Data) {
  const dice = Number(s4Data?.topDice?.[String(roundNo)]?.dice || 0)
  return dice >= 1 && dice <= 6 ? dice : null
}

function sortPlayerRankings(rankings) {
  return [...rankings].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars
    if (b.baseStars !== a.baseStars) return b.baseStars - a.baseStars
    if (b.matchWins !== a.matchWins) return b.matchWins - a.matchWins
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
    return String(a.id).localeCompare(String(b.id))
  })
}

function getRoundDiceMeta(roundNo, s4Data) {
  const dice = getTopDice(roundNo, s4Data)
  return {
    dice,
    effect: dice ? TOP_DICE_EFFECTS[dice] : null
  }
}

function getComboSeedMap(participants, matches, getGamesByMatch, getPlayerById, context) {
  const s4Data = getS4Data(context)
  if (s4Data?.seeds?.A && s4Data?.seeds?.B && s4Data?.seeds?.C && s4Data?.seeds?.D) {
    return s4Data.seeds
  }

  const rounds = context?.rounds || []
  const topRounds = rounds.filter(round => round.roundNo <= TOP_PHASE_LAST_ROUND)
  const completedTopRounds = topRounds.filter(round => round.status === STATUS.COMPLETED)

  if (completedTopRounds.length < TOP_PHASE_LAST_ROUND) {
    return null
  }

  const rankings = sortPlayerRankings(participants.map(playerId => {
    const player = getPlayerById(playerId)
    const stats = getTopPhasePlayerStats(playerId, matches, getGamesByMatch, {
      ...context,
      topRoundLimit: TOP_PHASE_LAST_ROUND
    })

    return {
      ...player,
      id: playerId,
      stars: stats.stars,
      baseStars: stats.baseStars,
      matchWins: stats.matchWins,
      totalPoints: stats.totalPoints
    }
  }))

  if (rankings.length < 4) return null

  return {
    A: rankings[0].id,
    B: rankings[1].id,
    C: rankings[2].id,
    D: rankings[3].id
  }
}

function getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context = {}) {
  const rounds = context?.rounds || []
  const s4Data = getS4Data(context)
  const first11Winners = s4Data?.first11Winners || {}
  const topRoundLimit = context?.topRoundLimit || TOP_PHASE_LAST_ROUND

  let stars = 0
  let baseStars = 0
  let matchWins = 0
  let totalPoints = 0
  let pendingFirst11Count = 0
  let pauseCards = 0
  const roundBreakdown = []

  rounds
    .filter(round => round.roundNo <= topRoundLimit)
    .sort((a, b) => a.roundNo - b.roundNo)
    .forEach(round => {
      const dice = getTopDice(round.roundNo, s4Data)
      let roundStars = 0
      let roundBaseStars = 0
      let roundBonusStars = 0
      let roundPoints = 0
      let roundMatchWins = 0
      let roundPending11 = 0
      let roundPauseCards = 0

      const roundMatches = getMatchesForRound(round.id, matches).filter(match => match.status === STATUS.COMPLETED)

      roundMatches.forEach(match => {
        const isTeamA = match.teamA?.includes(playerId)
        const isTeamB = match.teamB?.includes(playerId)
        if (!isTeamA && !isTeamB) return

        const { scoreA, scoreB, games } = getMatchGameWins(match, getGamesByMatch)
        if ((isTeamA && match.winner === 'a') || (isTeamB && match.winner === 'b')) {
          roundMatchWins++
        }

        games.forEach(game => {
          const myScore = isTeamA ? game.scoreA : game.scoreB
          const opponentScore = isTeamA ? game.scoreB : game.scoreA
          const wonGame = (isTeamA && game.winner === 'a') || (isTeamB && game.winner === 'b')

          totalPoints += myScore || 0
          roundPoints += myScore || 0

          if (wonGame) {
            roundBaseStars++
            roundStars++
          }

          if (dice === 1 && !wonGame && Math.abs((game.scoreA || 0) - (game.scoreB || 0)) <= 5) {
            roundBonusStars++
            roundStars++
          }

          if ((dice === 2 || dice === 3)) {
            const first11Winner = first11Winners[game.id]
            if (!first11Winner) {
              roundPending11++
            } else if ((isTeamA && first11Winner === 'a') || (isTeamB && first11Winner === 'b')) {
              roundBonusStars++
              roundStars++
            }
          }
        })

        if ((dice === 4 || dice === 5) && ((isTeamA && match.winner === 'a') || (isTeamB && match.winner === 'b'))) {
          roundBonusStars += 1
          roundStars += 1

          const myGameWins = isTeamA ? scoreA : scoreB
          const opponentGameWins = isTeamA ? scoreB : scoreA
          if (myGameWins >= 2 && opponentGameWins === 0) {
            roundPauseCards++
          }
        }
      })

      if (dice === 6) {
        roundStars *= 2
        roundBaseStars *= 2
        roundBonusStars *= 2
      }

      stars += roundStars
      baseStars += roundBaseStars
      matchWins += roundMatchWins
      pendingFirst11Count += roundPending11
      pauseCards += roundPauseCards

      roundBreakdown.push({
        roundNo: round.roundNo,
        roundId: round.id,
        dice,
        stars: roundStars,
        baseStars: roundBaseStars,
        bonusStars: roundBonusStars,
        matchWins: roundMatchWins,
        totalPoints: roundPoints,
        pendingFirst11Count: roundPending11,
        pauseCards: roundPauseCards
      })
    })

  return {
    stars,
    baseStars,
    matchWins,
    totalPoints,
    pendingFirst11Count,
    pauseCards,
    roundBreakdown
  }
}

function getComboDefinition(label) {
  return COMBO_CONFIGS.find(config => config.label === label) || null
}

function getComboDefinitions(context) {
  const seedMap = getComboSeedMap(
    context?.participants || [],
    context?.matches || [],
    context?.getGamesByMatch,
    context?.getPlayerById,
    context
  )

  if (!seedMap) return []

  return COMBO_CONFIGS.map(config => ({
    ...config,
    teamA: config.seedKeys.map(key => seedMap[key]),
    teamB: config.opponentSeedKeys.map(key => seedMap[key]),
    comboName: config.seedKeys.join('+'),
    opponentName: config.opponentSeedKeys.join('+')
  }))
}

function getComboLabelByRound(roundNo) {
  return COMBO_CONFIGS.find(config => config.roundNo === roundNo)?.label || null
}

function getTieBreakMeta(context) {
  const s4Data = getS4Data(context)
  return s4Data?.tieBreaks || {}
}

function calcTieBreakRankings(context) {
  const tieBreaks = getTieBreakMeta(context)
  const rounds = context?.rounds || []
  const matches = context?.matches || []
  const getGamesByMatch = context?.getGamesByMatch
  const results = []

  Object.entries(tieBreaks).forEach(([roundNo, meta]) => {
    const round = rounds.find(item => item.roundNo === Number(roundNo))
    if (!round || round.status !== STATUS.COMPLETED) return

    const roundMatches = getMatchesForRound(round.id, matches).filter(match => match.status === STATUS.COMPLETED)
    ;(meta.comboLabels || []).forEach((label, index) => {
      const match = roundMatches[index]
      if (!match) return

      const stats = getMatchGameWins(match, getGamesByMatch)
      const totalPoints = stats.games.reduce((sum, game) => sum + (game.scoreA || 0), 0)
      results.push({
        label,
        roundNo: Number(roundNo),
        win: match.winner === 'a' ? 1 : 0,
        smallWins: stats.scoreA,
        smallLosses: stats.scoreB,
        totalPoints
      })
    })
  })

  return results
}

export default {
  id: 's4',
  name: 'S4赛季规则',
  description: '前4轮个人星尘赛 + 后3轮固定组合赛',

  isTopPhaseRound(roundNo) {
    return roundNo >= 1 && roundNo <= TOP_PHASE_LAST_ROUND
  },

  isComboPhaseRound(roundNo) {
    return roundNo >= 5 && roundNo <= 7
  },

  getTopDiceEffect(roundNo, context) {
    return getRoundDiceMeta(roundNo, getS4Data(context))
  },

  getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context) {
    return getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context)
  },

  getComboSeedMap(participants, matches, getGamesByMatch, getPlayerById, context) {
    return getComboSeedMap(participants, matches, getGamesByMatch, getPlayerById, {
      ...context,
      matches,
      getGamesByMatch,
      getPlayerById
    })
  },

  getComboDefinitions(context) {
    return getComboDefinitions(context)
  },

  calcComboRoundStats(match, getGamesByMatch) {
    return calcComboRoundStats(match, getGamesByMatch)
  },

  calcComboRankings(matches, getGamesByMatch, rounds, context) {
    const definitions = getComboDefinitions({
      ...context,
      matches,
      rounds,
      getGamesByMatch
    })

    return buildComboRankings(definitions, matches, getGamesByMatch, rounds)
  },

  getComboTieStatus(matches, getGamesByMatch, rounds, context) {
    const rankings = this.calcComboRankings(matches, getGamesByMatch, rounds, context)
    if (rankings.length === 0) {
      return { tied: false, leaders: [], rankings }
    }

    const uniqueComboRounds = [...new Set(COMBO_CONFIGS.map(c => c.roundNo))]
    const completedComboRounds = rounds.filter(round => this.isComboPhaseRound(round.roundNo) && round.status === STATUS.COMPLETED)
    if (completedComboRounds.length < uniqueComboRounds.length) {
      return { tied: false, leaders: [], rankings }
    }

    return resolveComboTie(rankings)
  },

  calcTieBreakRankings(context) {
    return calcTieBreakRankings(context)
  },

  calcPlayerScore(playerId, matches, getGamesByMatch, context) {
    const stats = getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context)

    return {
      bigScore: stats.stars,
      smallScore: stats.baseStars,
      totalPoints: stats.totalPoints,
      bonusBigScore: 0,
      bonusSmallScore: 0,
      finalBigScore: stats.stars,
      finalSmallScore: stats.baseStars,
      stars: stats.stars,
      baseStars: stats.baseStars,
      pendingFirst11Count: stats.pendingFirst11Count,
      pauseCards: stats.pauseCards
    }
  },

  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context) {
    const rankings = participants.map(playerId => {
      const player = getPlayerById(playerId)
      const stats = getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context)

      return {
        ...player,
        id: playerId,
        bigScore: stats.stars,
        smallScore: stats.baseStars,
        totalPoints: stats.totalPoints,
        finalBigScore: stats.stars,
        finalSmallScore: stats.baseStars,
        score: stats.stars,
        stars: stats.stars,
        baseStars: stats.baseStars,
        wins: stats.matchWins,
        losses: 0,
        buffs: [],
        pendingFirst11Count: stats.pendingFirst11Count,
        pauseCards: stats.pauseCards
      }
    })

    return sortPlayerRankings(rankings)
  },

  getPlayerBuffs(playerId, matches, getGamesByMatch, context) {
    const stats = getTopPhasePlayerStats(playerId, matches, getGamesByMatch, context)
    if (stats.pendingFirst11Count <= 0) return []

    return [{
      id: 'first11_pending',
      name: '待记11分',
      count: stats.pendingFirst11Count,
      settled: false,
      description: `仍有${stats.pendingFirst11Count}局未记录先到11分的队伍`
    }]
  },

  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    const s4Data = getS4Data(context)
    const topDice = [1, 2, 3, 4].map(roundNo => ({
      roundNo,
      ...getRoundDiceMeta(roundNo, s4Data)
    }))
    const comboRankings = this.calcComboRankings(matches, getGamesByMatch, rounds, {
      ...context,
      matches,
      rounds,
      getGamesByMatch
    })
    const seedMap = this.getComboSeedMap(
      context?.participants || [],
      matches,
      getGamesByMatch,
      context?.getPlayerById,
      {
        ...context,
        matches,
        rounds,
        getGamesByMatch
      }
    )
    const tieStatus = this.getComboTieStatus(matches, getGamesByMatch, rounds, {
      ...context,
      matches,
      rounds,
      getGamesByMatch
    })

    return {
      buffs: [
        {
          id: 's4_top_phase',
          name: '上篇骰子',
          settled: false,
          interactive: true,
          topDice
        },
        {
          id: 's4_combo_phase',
          name: '组合赛',
          settled: false,
          interactive: true,
          seedMap,
          comboRankings,
          tieStatus
        }
      ]
    }
  },

  getComboLabelByRound(roundNo) {
    return getComboLabelByRound(roundNo)
  }
}
