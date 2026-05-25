/**
 * S2赛季规则
 * 包含：绝对压制、绝地反击 Buff
 */

import { STATUS } from '@/constants'

/**
 * 绝对压制 Buff 配置
 * 条件：小局净胜分 >= 12（如21:9）
 * 奖励：1次:小分+2 / 2次:大分+1 / 3次:大分+2（取最高档）
 * 第7轮结束后结算
 */
const ABSOLUTE_DOMINATION = {
  id: 'absolute_domination',
  name: '绝对压制',
  minPointDiff: 12,  // 最小净胜分
  settleAfterRound: 7,  // 第7轮后结算
  rewards: [
    { count: 1, type: 'small', value: 2 },  // 1次：小分+2
    { count: 2, type: 'big', value: 1 },    // 2次：大分+1
    { count: 3, type: 'big', value: 2 }     // 3次：大分+2
  ]
}

/**
 * 绝地反击 Buff 配置
 * 条件：第6轮结束时，第1名与第4名大分差 >= 3
 * 效果：第4名掷骰子，对应场次大分×1.5
 */
const COMEBACK = {
  id: 'comeback',
  name: '绝地反击',
  checkAfterRound: 6,  // 第6轮后检查
  minRankGap: 3,  // 1-4名最小分差
  matchMultiplier: 1.5  // 大分倍率
}

export default {
  id: 's2',
  name: 'S2赛季规则',
  description: '包含绝对压制、绝地反击Buff',

  /**
   * 计算选手的"绝对压制"触发次数
   * @param {string} playerId - 选手ID
   * @param {Array} matches - 比赛列表
   * @param {Function} getGamesByMatch - 获取比赛局数的函数
   * @returns {number} 触发次数
   */
  calcDominationCount(playerId, matches, getGamesByMatch) {
    let count = 0
    const completedMatches = matches.filter(m => m.status === STATUS.COMPLETED)

    completedMatches.forEach(match => {
      const isTeamA = match.teamA?.includes(playerId)
      const isTeamB = match.teamB?.includes(playerId)
      if (!isTeamA && !isTeamB) return

      const games = getGamesByMatch(match.id)
      games.forEach(g => {
        if (g.status !== STATUS.COMPLETED) return
        const myScore = isTeamA ? g.scoreA : g.scoreB
        const opponentScore = isTeamA ? g.scoreB : g.scoreA
        const diff = myScore - opponentScore

        // 净胜分 >= 12 且我方获胜
        if (diff >= ABSOLUTE_DOMINATION.minPointDiff) {
          count++
        }
      })
    })

    return count
  },

  /**
   * 根据触发次数获取奖励
   * @param {number} count - 触发次数
   * @returns {Object} { bonusBigScore, bonusSmallScore }
   */
  getDominationReward(count) {
    if (count <= 0) return { bonusBigScore: 0, bonusSmallScore: 0 }

    // 取最高档奖励（不累计）
    let reward = null
    for (const r of ABSOLUTE_DOMINATION.rewards) {
      if (count >= r.count) {
        reward = r
      }
    }

    if (!reward) return { bonusBigScore: 0, bonusSmallScore: 0 }

    return {
      bonusBigScore: reward.type === 'big' ? reward.value : 0,
      bonusSmallScore: reward.type === 'small' ? reward.value : 0
    }
  },

  /**
   * 计算选手最终积分
   */
  calcPlayerScore(playerId, matches, getGamesByMatch, context) {
    const completedMatches = matches.filter(m => m.status === STATUS.COMPLETED)
    const { rounds = [], season = {} } = context

    let bigScore = 0
    let smallScore = 0
    let totalPoints = 0

    completedMatches.forEach(match => {
      const isTeamA = match.teamA?.includes(playerId)
      const isTeamB = match.teamB?.includes(playerId)
      if (!isTeamA && !isTeamB) return

      // 大分：赢一场+1
      if (isTeamA && match.winner === 'a') bigScore++
      if (isTeamB && match.winner === 'b') bigScore++

      // 小分和总得分
      const games = getGamesByMatch(match.id)
      games.forEach(g => {
        if (g.status !== STATUS.COMPLETED) return
        if (isTeamA) {
          if (g.winner === 'a') smallScore++
          totalPoints += g.scoreA || 0
        } else {
          if (g.winner === 'b') smallScore++
          totalPoints += g.scoreB || 0
        }
      })
    })

    // 计算绝对压制 Buff
    const completedRounds = rounds.filter(r => r.status === STATUS.COMPLETED).length
    let bonusBigScore = 0
    let bonusSmallScore = 0
    let dominationCount = 0

    // 第7轮结束后才结算
    if (completedRounds >= ABSOLUTE_DOMINATION.settleAfterRound) {
      dominationCount = this.calcDominationCount(playerId, matches, getGamesByMatch)
      const reward = this.getDominationReward(dominationCount)
      bonusBigScore = reward.bonusBigScore
      bonusSmallScore = reward.bonusSmallScore
    }

    // 检查绝地反击（需要从 season 的 comebackData 中获取）
    const comebackBonus = this.getComebackBonus(playerId, season, context)
    bonusBigScore += comebackBonus

    return {
      bigScore,
      smallScore,
      totalPoints,
      bonusBigScore,
      bonusSmallScore,
      finalBigScore: bigScore + bonusBigScore,
      finalSmallScore: smallScore + bonusSmallScore,
      dominationCount
    }
  },

  /**
   * 获取绝地反击加成
   * 需要从赛季数据中获取骰子结果
   */
  getComebackBonus(playerId, season, context) {
    // comebackData 结构: { triggered: boolean, targetPlayerId: string, diceResult: number, matchIndex: number, bonus: number }
    const comebackData = season?.comebackData
    if (!comebackData || !comebackData.triggered) return 0
    if (comebackData.targetPlayerId !== playerId) return 0

    return comebackData.bonus || 0
  },

  /**
   * 计算排名
   */
  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context) {
    const rankings = participants.map(pId => {
      const player = getPlayerById(pId)
      const scores = this.calcPlayerScore(pId, matches, getGamesByMatch, context)
      const { wins, losses } = this.calcWinLoss(pId, matches)
      const buffs = this.getPlayerBuffs(pId, matches, getGamesByMatch, context)

      return {
        ...player,
        ...scores,
        wins,
        losses,
        buffs
      }
    })

    // 按最终大分排序
    return rankings.sort((a, b) => b.finalBigScore - a.finalBigScore)
  },

  /**
   * 计算胜负场数
   */
  calcWinLoss(playerId, matches) {
    let wins = 0, losses = 0
    matches.forEach(match => {
      if (match.status !== STATUS.COMPLETED) return
      const isTeamA = match.teamA?.includes(playerId)
      const isTeamB = match.teamB?.includes(playerId)
      if (isTeamA) {
        if (match.winner === 'a') wins++
        else losses++
      }
      if (isTeamB) {
        if (match.winner === 'b') wins++
        else losses++
      }
    })
    return { wins, losses }
  },

  /**
   * 获取选手Buff状态
   */
  getPlayerBuffs(playerId, matches, getGamesByMatch, context) {
    const buffs = []
    const { rounds = [], season = {} } = context
    const completedRounds = rounds.filter(r => r.status === STATUS.COMPLETED).length

    // 绝对压制
    const dominationCount = this.calcDominationCount(playerId, matches, getGamesByMatch)
    if (dominationCount > 0) {
      const reward = this.getDominationReward(dominationCount)
      const settled = completedRounds >= ABSOLUTE_DOMINATION.settleAfterRound
      buffs.push({
        id: 'absolute_domination',
        name: '绝对压制',
        count: dominationCount,
        reward: settled ? reward : null,
        settled,
        description: `已触发${dominationCount}次${settled ? '，已结算' : '，第7轮后结算'}`
      })
    }

    // 绝地反击
    const comebackData = season?.comebackData
    if (comebackData && comebackData.triggered && comebackData.targetPlayerId === playerId) {
      buffs.push({
        id: 'comeback',
        name: '绝地反击',
        diceResult: comebackData.diceResult,
        matchIndex: comebackData.matchIndex,
        bonus: comebackData.bonus,
        settled: true,
        description: `掷骰子${comebackData.diceResult}，第${comebackData.matchIndex}场大分+${comebackData.bonus}`
      })
    }

    return buffs
  },

  /**
   * 获取赛季Buff结算状态
   */
  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    const completedRounds = rounds.filter(r => r.status === STATUS.COMPLETED).length
    const { participants = [], getPlayerById, season = {} } = context

    const buffs = []

    // 绝对压制状态
    const dominationSettled = completedRounds >= ABSOLUTE_DOMINATION.settleAfterRound
    buffs.push({
      id: 'absolute_domination',
      name: '绝对压制',
      condition: `小局净胜分≥${ABSOLUTE_DOMINATION.minPointDiff}`,
      rewards: ABSOLUTE_DOMINATION.rewards.map(r =>
        `${r.count}次: ${r.type === 'big' ? '大分' : '小分'}+${r.value}`
      ).join(' / '),
      settleAt: `第${ABSOLUTE_DOMINATION.settleAfterRound}轮后`,
      settled: dominationSettled,
      currentRound: completedRounds
    })

    // 绝地反击状态
    const comebackCheckable = completedRounds >= COMEBACK.checkAfterRound
    let comebackTriggered = false
    let comebackMessage = ''
    let rank4Player = null
    let rank1Player = null

    if (comebackCheckable && participants.length >= 4) {
      // 计算第6轮结束时的排名
      const tempRankings = this.calcRankings(participants, matches, getGamesByMatch, getPlayerById, context)
      if (tempRankings.length >= 4) {
        const rank1Score = tempRankings[0].bigScore
        const rank4Score = tempRankings[3].bigScore
        const gap = rank1Score - rank4Score
        comebackTriggered = gap >= COMEBACK.minRankGap
        comebackMessage = comebackTriggered
          ? `第1名(${rank1Score}分)与第4名(${rank4Score}分)分差${gap}分，已触发`
          : `第1名(${rank1Score}分)与第4名(${rank4Score}分)分差${gap}分，未触发(需≥${COMEBACK.minRankGap})`

        // 记录第4名和第1名选手信息
        rank4Player = tempRankings[3]
        rank1Player = tempRankings[0]
      }
    }

    const comebackData = season?.comebackData
    buffs.push({
      id: 'comeback',
      name: '绝地反击',
      condition: `第${COMEBACK.checkAfterRound}轮后1-4名分差≥${COMEBACK.minRankGap}`,
      effect: `第4名掷骰子，对应场次大分×${COMEBACK.matchMultiplier}`,
      checkable: comebackCheckable,
      triggered: comebackTriggered,
      settled: comebackData?.triggered || false,
      message: comebackMessage,
      diceResult: comebackData?.diceResult,
      bonus: comebackData?.bonus,
      rank4Player,
      rank1Player
    })

    return {
      buffs,
      dominationSettled,
      comebackCheckable,
      comebackTriggered
    }
  },

  /**
   * 计算绝地反击的加成
   * 用于手动录入骰子结果后计算
   * @param {string} playerId - 第4名选手ID
   * @param {number} diceResult - 骰子结果（1-6）
   * @param {Array} matches - 比赛列表
   * @param {Function} getGamesByMatch - 获取比赛小局的函数
   * @returns {Object} { matchIndex, originalScore, bonus }
   */
  calcComebackBonus(playerId, diceResult, matches, getGamesByMatch) {
    // 获取该选手的所有比赛，按顺序排列
    const playerMatches = matches
      .filter(m => m.status === STATUS.COMPLETED &&
        (m.teamA?.includes(playerId) || m.teamB?.includes(playerId)))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

    const matchIndex = diceResult  // 骰子结果对应第几场
    if (matchIndex > playerMatches.length) {
      return { matchIndex, originalScore: 0, bonus: 0, error: '场次不存在' }
    }

    const targetMatch = playerMatches[matchIndex - 1]
    if (!targetMatch) {
      return { matchIndex, originalScore: 0, bonus: 0, error: '场次不存在' }
    }

    // 计算该场的大分（赢得的小局数，BO3比赛可以是0/1/2）
    const isTeamA = targetMatch.teamA?.includes(playerId)
    let originalScore = 0

    if (getGamesByMatch) {
      const games = getGamesByMatch(targetMatch.id)
      games.forEach(g => {
        if (g.status !== STATUS.COMPLETED) return
        // 统计该选手赢得的小局数
        if (isTeamA && g.winner === 'a') originalScore++
        if (!isTeamA && g.winner === 'b') originalScore++
      })
    }

    // 大分 × 1.5，向上取整
    const newScore = Math.ceil(originalScore * COMEBACK.matchMultiplier)
    const bonus = newScore - originalScore

    return {
      matchIndex,
      matchId: targetMatch.id,
      originalScore,
      newScore,
      bonus
    }
  }
}
