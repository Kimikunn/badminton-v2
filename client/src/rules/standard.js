/**
 * 标准规则（S1及默认）
 * 基础计分方式：大分=胜场数，小分=赢局数
 */

import { STATUS } from '@/constants'

export default {
  id: 'standard',
  name: '标准规则',
  description: '按胜场数(大分)排名，无特殊Buff',

  /**
   * 计算选手最终积分
   * @param {string} playerId - 选手ID
   * @param {Array} matches - 比赛列表
   * @param {Function} getGamesByMatch - 获取比赛局数的函数
   * @param {Object} context - 上下文（包含 season, rounds 等）
   * @returns {Object} { bigScore, smallScore, totalPoints, bonusBigScore, bonusSmallScore }
   */
  calcPlayerScore(playerId, matches, getGamesByMatch, context) {
    const completedMatches = matches.filter(m => m.status === STATUS.COMPLETED)

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

    return {
      bigScore,
      smallScore,
      totalPoints,
      bonusBigScore: 0,  // 标准规则无加成
      bonusSmallScore: 0,
      finalBigScore: bigScore,
      finalSmallScore: smallScore
    }
  },

  /**
   * 计算排名
   * @param {Array} participants - 参赛选手ID列表
   * @param {Array} matches - 比赛列表
   * @param {Function} getGamesByMatch - 获取比赛局数的函数
   * @param {Function} getPlayerById - 获取选手信息的函数
   * @param {Object} context - 上下文
   * @returns {Array} 排名列表
   */
  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context) {
    const rankings = participants.map(pId => {
      const player = getPlayerById(pId)
      const scores = this.calcPlayerScore(pId, matches, getGamesByMatch, context)
      const { wins, losses } = this.calcWinLoss(pId, matches)

      return {
        ...player,
        ...scores,
        wins,
        losses,
        buffs: []  // 标准规则无Buff
      }
    })

    // 按大分排序
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
   * 获取选手Buff状态（标准规则无Buff）
   */
  getPlayerBuffs(playerId, matches, getGamesByMatch, context) {
    return []
  },

  /**
   * 获取赛季Buff结算状态（标准规则无Buff）
   */
  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context) {
    return {
      buffs: [],
      settled: false,
      message: '标准规则无特殊Buff'
    }
  }
}
