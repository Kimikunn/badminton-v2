/**
 * 下篇组合赛星尘计分（S4 / S6 共享）
 *
 * 从 s4.js 抽取的纯函数模块，行为与 S4 原有实现完全一致：
 * - 组合轮次配置：第 5/6/7 轮 = AB vs CD / AC vs BD / AD vs BC（双视角）
 * - 计分：每个小分 2 星尘；连胜 2/3/4 局 +1/+2/+4（BONUS 表）；终结对方
 *   2 连胜及以上 +3
 * - 排名：星尘 → 胜场 → 局分差 → 总得分 → 逐局净胜分链（第 7 局 → 第 1 局）
 *
 * 种子推导因赛季而异（S4 读 comebackData.s4.seeds，S6 读 s6.seeds 或上篇
 * 标准排名），由各赛季规则模块自行解析后以 seedMap 参数传入。
 */

import { STATUS } from '@/constants'

export const COMBO_CONFIGS = [
  { roundNo: 5, label: 'AB', opponentLabel: 'CD', seedKeys: ['A', 'B'], opponentSeedKeys: ['C', 'D'], perspective: 'a' },
  { roundNo: 6, label: 'AC', opponentLabel: 'BD', seedKeys: ['A', 'C'], opponentSeedKeys: ['B', 'D'], perspective: 'a' },
  { roundNo: 7, label: 'AD', opponentLabel: 'BC', seedKeys: ['A', 'D'], opponentSeedKeys: ['B', 'C'], perspective: 'a' },
  { roundNo: 5, label: 'CD', opponentLabel: 'AB', seedKeys: ['C', 'D'], opponentSeedKeys: ['A', 'B'], perspective: 'b' },
  { roundNo: 6, label: 'BD', opponentLabel: 'AC', seedKeys: ['B', 'D'], opponentSeedKeys: ['A', 'C'], perspective: 'b' },
  { roundNo: 7, label: 'BC', opponentLabel: 'AD', seedKeys: ['B', 'C'], opponentSeedKeys: ['A', 'D'], perspective: 'b' }
]

export function isComboPhaseRound(roundNo) {
  return roundNo >= 5 && roundNo <= 7
}

export function getMatchesForRound(roundId, matches) {
  return matches.filter(match => match.roundId === roundId)
}

export function getCompletedGames(match, getGamesByMatch) {
  return getGamesByMatch(match.id).filter(game => game.status === STATUS.COMPLETED)
}

export function getMatchGameWins(match, getGamesByMatch) {
  const games = getCompletedGames(match, getGamesByMatch)
  let scoreA = 0
  let scoreB = 0

  games.forEach(game => {
    if (game.winner === 'a') scoreA++
    if (game.winner === 'b') scoreB++
  })

  return { scoreA, scoreB, games }
}

/**
 * 由已解析的种子表生成全部组合定义（双视角）
 * @param {Object} seedMap - { A, B, C, D } 种子选手 ID
 */
export function getComboDefinitions(seedMap) {
  if (!seedMap) return []

  return COMBO_CONFIGS.map(config => ({
    ...config,
    teamA: config.seedKeys.map(key => seedMap[key]),
    teamB: config.opponentSeedKeys.map(key => seedMap[key]),
    comboName: config.seedKeys.join('+'),
    opponentName: config.opponentSeedKeys.join('+')
  }))
}

export function getComboLabelByRound(roundNo) {
  return COMBO_CONFIGS.find(config => config.roundNo === roundNo)?.label || null
}

// 某一轮的两个对阵组合标识，如第 5 轮 → ['AB', 'CD']
export function getComboLabelsByRound(roundNo) {
  const config = COMBO_CONFIGS.find(item => item.roundNo === roundNo)
  return config ? [config.label, config.opponentLabel] : []
}

/**
 * 获取组合比赛的逐局净胜分链（从第7局到第1局，用于同分决胜）
 * 返回数组 [{ gameNo, pointDiff }]，按 gameNo 降序排列（第7局在前）
 */
export function getComboGamePointDiffChain(match, getGamesByMatch, perspective = 'a') {
  if (!match) return []
  const games = getCompletedGames(match, getGamesByMatch)
  const ourSide = perspective

  return games
    .map(game => {
      const myScore = ourSide === 'a' ? (game.scoreA || 0) : (game.scoreB || 0)
      const oppScore = ourSide === 'a' ? (game.scoreB || 0) : (game.scoreA || 0)
      return {
        gameNo: game.gameNo,
        pointDiff: myScore - oppScore
      }
    })
    .sort((a, b) => b.gameNo - a.gameNo)
}

/**
 * 比较两个组合的逐局净胜分链，返回正数表示 a 更优（分差更大）
 */
export function comparePointDiffChains(chainA, chainB) {
  const maxLen = Math.max(chainA.length, chainB.length)
  for (let i = 0; i < maxLen; i++) {
    const diffA = chainA[i]?.pointDiff ?? 0
    const diffB = chainB[i]?.pointDiff ?? 0
    if (diffA !== diffB) return diffA - diffB
  }
  return 0
}

export function calcComboRoundStats(match, getGamesByMatch, perspective = 'a') {
  if (!match || match.status !== STATUS.COMPLETED) {
    return {
      stars: 0,
      baseStars: 0,
      streakBonus: 0,
      breakerBonus: 0,
      matchWon: false,
      scoreA: 0,
      scoreB: 0,
      totalPoints: 0,
      opponentPoints: 0,
      completedGames: 0,
      pointDiffChain: []
    }
  }

  const games = getCompletedGames(match, getGamesByMatch)
  const winners = games.map(game => game.winner)
  const ourSide = perspective
  const theirSide = perspective === 'a' ? 'b' : 'a'

  const winsOurs = winners.filter(winner => winner === ourSide).length
  const winsTheirs = winners.filter(winner => winner === theirSide).length

  let streakBonus = 0
  let breakerBonus = 0
  let currentWinner = null
  let currentLength = 0

  const closeStreak = () => {
    if (currentWinner !== ourSide) return
    // 硬编码连胜规则：只结算到7局
    // 1:+0, 2:+1, 3:+2, 4:+4, 5:+5, 6:+6, 7:+6
    const BONUS = [0, 0, 1, 2, 4, 5, 6, 6]
    if (currentLength >= 2) {
      streakBonus += BONUS[currentLength]
    }
  }

  winners.forEach(winner => {
    if (winner === currentWinner) {
      currentLength++
      return
    }

    if (winner === ourSide && currentWinner === theirSide && currentLength >= 2) {
      breakerBonus += 3
    }

    closeStreak()
    currentWinner = winner
    currentLength = 1
  })

  closeStreak()

  const totalPoints = games.reduce((sum, game) => sum + (ourSide === 'a' ? (game.scoreA || 0) : (game.scoreB || 0)), 0)
  const opponentPoints = games.reduce((sum, game) => sum + (ourSide === 'a' ? (game.scoreB || 0) : (game.scoreA || 0)), 0)
  const baseStars = winsOurs * 2
  const pointDiffChain = getComboGamePointDiffChain(match, getGamesByMatch, perspective)

  return {
    stars: baseStars + streakBonus + breakerBonus,
    baseStars,
    streakBonus,
    breakerBonus,
    matchWon: winsOurs > winsTheirs,
    scoreA: winsOurs,
    scoreB: winsTheirs,
    totalPoints,
    opponentPoints,
    completedGames: games.length,
    pointDiffChain
  }
}

export function sortComboRankings(rankings) {
  return [...rankings].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars
    if (b.matchWon !== a.matchWon) return Number(b.matchWon) - Number(a.matchWon)
    if ((b.scoreA - b.scoreB) !== (a.scoreA - a.scoreB)) return (b.scoreA - b.scoreB) - (a.scoreA - a.scoreB)
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
    // 逐局净胜分比较（从第7局开始，分差大者优先）
    const diffResult = comparePointDiffChains(a.pointDiffChain || [], b.pointDiffChain || [])
    if (diffResult !== 0) return diffResult
    return a.label.localeCompare(b.label)
  })
}

/**
 * 由已解析的组合定义计算组合星尘榜（赛季无关核心）
 */
export function buildComboRankings(definitions, matches, getGamesByMatch, rounds) {
  const rankings = definitions.map(definition => {
    const round = rounds.find(item => item.roundNo === definition.roundNo)
    const match = round ? getMatchesForRound(round.id, matches)[0] : null
    const stats = calcComboRoundStats(match, getGamesByMatch, definition.perspective)

    return {
      label: definition.label,
      opponentLabel: definition.opponentLabel,
      roundNo: definition.roundNo,
      name: definition.comboName,
      description: `${definition.comboName} vs ${definition.opponentName}`,
      teamA: definition.teamA,
      teamB: definition.teamB,
      roundId: round?.id || null,
      matchId: match?.id || null,
      roundStatus: round?.status || STATUS.PENDING,
      perspective: definition.perspective,
      ...stats
    }
  })

  return sortComboRankings(rankings)
}

/**
 * 格式化净胜分链为可读字符串
 */
export function formatPointDiffChain(chain) {
  if (!chain || chain.length === 0) return '无数据'
  return chain.map(g => `G${g.gameNo}:${g.pointDiff >= 0 ? '+' : ''}${g.pointDiff}`).join(' → ')
}

/**
 * 同分决胜核心（假定全部组合轮次已完成）：取星尘第一，
 * 同分按逐局净胜分自动决胜。
 * @param {Array} rankings - buildComboRankings 的结果（已排序）
 */
export function resolveComboTie(rankings) {
  // 取第一名（rankings 已经按 sortComboRankings 排好序，包含逐局净胜分比较）
  const winner = rankings[0]

  // 检查是否有多人并列第一（同星尘 = 同分）
  const topScore = winner.stars
  const tiedForTop = rankings.filter(item => item.stars === topScore)

  if (tiedForTop.length <= 1) {
    return {
      tied: false,
      leaders: [winner],
      rankings,
      tieResolved: false,
      tieResolution: null
    }
  }

  // 同分 → 用逐局净胜分自动决胜
  // tiedForTop 已经按 sortComboRankings 排好序，包含了逐局净胜分比较
  const resolvedWinner = tiedForTop[0]

  // 找出胜负关键的局（第一个分差不同的局）
  let decisiveGame = null
  const chainWinner = resolvedWinner.pointDiffChain || []

  for (let i = 1; i < tiedForTop.length; i++) {
    const chainOther = tiedForTop[i].pointDiffChain || []
    const maxLen = Math.max(chainWinner.length, chainOther.length)
    for (let j = 0; j < maxLen; j++) {
      const diffW = chainWinner[j]?.pointDiff ?? 0
      const diffO = chainOther[j]?.pointDiff ?? 0
      if (diffW !== diffO) {
        decisiveGame = {
          gameNo: chainWinner[j]?.gameNo || chainOther[j]?.gameNo,
          winnerDiff: diffW,
          otherDiff: diffO,
          winnerLabel: resolvedWinner.label,
          otherLabel: tiedForTop[i].label
        }
        break
      }
    }
    if (decisiveGame) break
  }

  return {
    tied: false, // 自动决胜后不再需要手动决胜轮
    leaders: [resolvedWinner],
    rankings,
    tieResolved: true,
    tieResolution: {
      method: '逐局净胜分',
      description: '同分组合按第7局→第6局→…→第1局的净胜分（得分−失分）比较，分差大者胜出',
      decisiveGame,
      tiedCombos: tiedForTop.map(item => ({
        label: item.label,
        stars: item.stars,
        pointDiffChain: item.pointDiffChain || [],
        pointDiffSummary: formatPointDiffChain(item.pointDiffChain || [])
      }))
    }
  }
}

/**
 * 最强组合判定（赛季无关核心）：全部组合轮次完成后取星尘第一，
 * 同分按逐局净胜分自动决胜；未完成全部组合轮次时不判定。
 * @param {Array} rankings - buildComboRankings 的结果（已排序）
 * @param {Array} rounds - 赛季轮次列表
 */
export function resolveComboTieStatus(rankings, rounds) {
  if (rankings.length === 0) {
    return { tied: false, leaders: [], rankings }
  }

  const uniqueComboRounds = [...new Set(COMBO_CONFIGS.map(c => c.roundNo))]
  const completedComboRounds = rounds.filter(round => isComboPhaseRound(round.roundNo) && round.status === STATUS.COMPLETED)
  if (completedComboRounds.length < uniqueComboRounds.length) {
    return { tied: false, leaders: [], rankings }
  }

  return resolveComboTie(rankings)
}
