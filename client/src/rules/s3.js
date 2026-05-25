/**
 * S3赛季规则
 * 包含：超能饮料、绝对压制2.0、关键先生、绝地反击2.0 Buff
 */

import { STATUS } from '@/constants'

/**
 * 绝对压制2.0 Buff 配置
 * 条件：小局净胜分 >= 10 且对手得分 < 12
 * 奖励：累计不循环 1→暂停/2→小分+1/3→大分+1
 * 第7轮结束后结算
 */
const DOMINATION_V2 = {
  id: 'domination_v2',
  name: '绝对压制2.0',
  minPointDiff: 10,
  maxOpponentScore: 11, // 对手得分 < 12，即 <= 11
  settleAfterRound: 7,
  // 顺序奖励（不循环）：position 1=暂停, 2=小分+1, 3=大分+1
  rewardSequence: [
    { type: 'pause', value: 0, label: '30秒暂停权' },
    { type: 'small', value: 1, label: '小分+1' },
    { type: 'big', value: 1, label: '大分+1' }
  ]
}

/**
 * 关键先生 Buff 配置
 * 条件：Deuce获胜（比分≥22:20）
 * 奖励：累计不循环 1→小分+1/2→大分+1/3→大分+1/4→骰子
 * 第7轮结束后结算
 */
const CLUTCH = {
  id: 'clutch',
  name: '关键先生',
  minDeuceScore: 22, // 赢方得分>=22
  minDeuceLoserScore: 20, // 输方得分>=20
  settleAfterRound: 7,
  // 顺序奖励（不循环）
  rewardSequence: [
    { type: 'small', value: 1, label: '小分+1' },
    { type: 'big', value: 1, label: '大分+1' },
    { type: 'big', value: 1, label: '大分+1' },
    { type: 'dice', value: 0, label: '掷骰子' }
  ],
  diceMultiplier: 1.5
}

/**
 * 绝地反击2.0 Buff 配置
 * 第5轮+3/第6轮+2/第7轮+1（仅提示，不修改实际分数）
 */
const COMEBACK_V2 = {
  id: 'comeback_v2',
  name: '绝地反击2.0',
  rounds: [
    { roundNo: 5, bonus: 3 },
    { roundNo: 6, bonus: 2 },
    { roundNo: 7, bonus: 1 }
  ]
}

/**
 * 超能饮料 Buff 配置
 * 每轮掷骰子，1或6激活
 */
const DRINK = {
  id: 'drink',
  name: '超能饮料',
  activeDiceValues: [1, 6] // 掷到1或6激活
}

export default {
  id: 's3',
  name: 'S3赛季规则',
  description: '包含超能饮料、绝对压制2.0、关键先生、绝地反击2.0 Buff',

  /**
   * 计算绝对压制2.0触发次数
   * 条件：净胜>=10且对手<12分
   */
  calcDominationV2Count(playerId, matches, getGamesByMatch) {
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

        if (diff >= DOMINATION_V2.minPointDiff && opponentScore <= DOMINATION_V2.maxOpponentScore) {
          count++
        }
      })
    })

    return count
  },

  /**
   * 根据触发次数获取绝对压制2.0奖励（累计不循环）
   * 1→暂停/2→小分+1/3→大分+1，超出不再追加
   */
  getDominationV2Reward(count) {
    if (count <= 0) return { bonusBigScore: 0, bonusSmallScore: 0, pauseCount: 0 }

    let bonusBigScore = 0
    let bonusSmallScore = 0
    let pauseCount = 0
    const sequence = DOMINATION_V2.rewardSequence
    const effectiveCount = Math.min(count, sequence.length)

    for (let i = 1; i <= effectiveCount; i++) {
      const reward = sequence[i - 1]
      if (reward.type === 'big') bonusBigScore += reward.value
      else if (reward.type === 'small') bonusSmallScore += reward.value
      else if (reward.type === 'pause') pauseCount++
    }

    return { bonusBigScore, bonusSmallScore, pauseCount }
  },

  /**
   * 计算关键先生触发次数
   * 条件：deuce获胜（赢方>=22,输方>=20）
   */
  calcClutchCount(playerId, matches, getGamesByMatch) {
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

        // deuce获胜：我方>=22, 对方>=20, 且我方>对方
        if (myScore >= CLUTCH.minDeuceScore && opponentScore >= CLUTCH.minDeuceLoserScore && myScore > opponentScore) {
          count++
        }
      })
    })

    return count
  },

  /**
   * 获取关键先生奖励（累计不循环）
   * 1→小分+1/2→大分+1/3→大分+1/4→骰子
   */
  getClutchReward(count, comebackData) {
    if (count <= 0) return { bonusBigScore: 0, bonusSmallScore: 0, diceCount: 0 }

    let bonusBigScore = 0
    let bonusSmallScore = 0
    let diceCount = 0
    const sequence = CLUTCH.rewardSequence
    const effectiveCount = Math.min(count, sequence.length)
    const validDiceTriggerIndexes = new Set()

    for (let i = 1; i <= effectiveCount; i++) {
      const reward = sequence[i - 1]
      if (reward.type === 'big') bonusBigScore += reward.value
      else if (reward.type === 'small') bonusSmallScore += reward.value
      else if (reward.type === 'dice') {
        diceCount++
        validDiceTriggerIndexes.add(i)
      }
    }

    // 加上骰子已结算的额外大分加成
    if (comebackData?.clutchDice) {
      comebackData.clutchDice.forEach(d => {
        if (validDiceTriggerIndexes.has(d.triggerIndex)) {
          bonusBigScore += d.bonus || 0
        }
      })
    }

    return { bonusBigScore, bonusSmallScore, diceCount }
  },

  /**
   * 计算关键先生骰子加成
   * 骰子1-6对应第1-6轮，该轮大分×1.5向上取整
   */
  calcClutchDiceBonus(playerId, diceResult, matches, getGamesByMatch, rounds) {
    // 找到对应轮次
    const targetRound = rounds.find(r => r.roundNo === diceResult)
    if (!targetRound) {
      return { roundNo: diceResult, originalScore: 0, newScore: 0, bonus: 0, error: '轮次不存在' }
    }

    // 计算该轮大分（赢的场数）
    const roundMatches = matches.filter(m =>
      m.roundId === targetRound.id && m.status === STATUS.COMPLETED
    )

    let originalScore = 0
    roundMatches.forEach(match => {
      const isTeamA = match.teamA?.includes(playerId)
      const isTeamB = match.teamB?.includes(playerId)
      if (!isTeamA && !isTeamB) return
      if (isTeamA && match.winner === 'a') originalScore++
      if (isTeamB && match.winner === 'b') originalScore++
    })

    const newScore = Math.ceil(originalScore * CLUTCH.diceMultiplier)
    const bonus = newScore - originalScore

    return {
      roundNo: diceResult,
      roundId: targetRound.id,
      originalScore,
      newScore,
      bonus
    }
  },

  /**
   * 计算截至某轮的排名（用于绝地反击2.0）
   */
  getRankingsAtRound(participants, matches, getGamesByMatch, getPlayerById, rounds, upToRoundNo) {
    // 筛选截至指定轮次的比赛
    const targetRounds = rounds.filter(r => r.roundNo <= upToRoundNo)
    const targetRoundIds = new Set(targetRounds.map(r => r.id))
    const filteredMatches = matches.filter(m => targetRoundIds.has(m.roundId))

    const rankings = participants.map(pId => {
      const player = getPlayerById(pId)
      let bigScore = 0
      filteredMatches.forEach(match => {
        if (match.status !== STATUS.COMPLETED) return
        const isTeamA = match.teamA?.includes(pId)
        const isTeamB = match.teamB?.includes(pId)
        if (isTeamA && match.winner === 'a') bigScore++
        if (isTeamB && match.winner === 'b') bigScore++
      })
      return { ...player, bigScore }
    })

    return rankings.sort((a, b) => b.bigScore - a.bigScore)
  },

  /**
   * 获取绝地反击2.0状态
   * 返回各轮的激活状态和加分提示
   */
  getComebackV2Status(participants, matches, getGamesByMatch, getPlayerById, rounds) {
    const completedRounds = rounds.filter(r => r.status === STATUS.COMPLETED)
    const completedRoundNos = completedRounds.map(r => r.roundNo)
    const result = []

    for (const config of COMEBACK_V2.rounds) {
      const prevRoundNo = config.roundNo - 1

      // 需要前一轮已完成才能判断
      if (!completedRoundNos.includes(prevRoundNo) && config.roundNo !== 5) {
        continue
      }

      // 第5轮：需要第4轮完成；第6轮：需要第5轮完成；第7轮：需要第6轮完成
      if (config.roundNo === 5 && !completedRoundNos.includes(4)) continue
      if (config.roundNo === 6 && !completedRoundNos.includes(5)) continue
      if (config.roundNo === 7 && !completedRoundNos.includes(6)) continue

      // 计算截至前一轮的排名
      const rankingsAtPrev = this.getRankingsAtRound(
        participants, matches, getGamesByMatch, getPlayerById, rounds, prevRoundNo
      )

      if (rankingsAtPrev.length < 4) continue

      // 找第4名（可能并列）
      const rank4Score = rankingsAtPrev[3].bigScore
      const rank4Players = rankingsAtPrev.filter(r => r.bigScore === rank4Score && rankingsAtPrev.indexOf(r) >= 3)

      // 检查延续条件：第6轮需要第5轮第4名至少赢1场，第7轮需要第6轮第4名至少赢1场
      let continued = true
      if (config.roundNo === 6) {
        // 检查第5轮第4名是否赢了至少1场
        const prevStatus = this._checkRoundWins(result, 5, matches, rounds)
        if (!prevStatus) continued = false
      }
      if (config.roundNo === 7) {
        const prevStatus = this._checkRoundWins(result, 6, matches, rounds)
        if (!prevStatus) continued = false
      }

      if (!continued) continue

      result.push({
        roundNo: config.roundNo,
        bonus: config.bonus,
        rank4Players: rank4Players.map(p => ({ id: p.id, name: p.name })),
        active: true
      })
    }

    return result
  },

  /**
   * 检查某轮第4名是否赢了至少1场
   */
  _checkRoundWins(comebackStatus, roundNo, matches, rounds) {
    const status = comebackStatus.find(s => s.roundNo === roundNo)
    if (!status || !status.active) return false

    const targetRound = rounds.find(r => r.roundNo === roundNo)
    if (!targetRound) return false

    const roundMatches = matches.filter(m =>
      m.roundId === targetRound.id && m.status === STATUS.COMPLETED
    )

    // 第4名的任一选手赢了至少1场
    for (const player of status.rank4Players) {
      for (const match of roundMatches) {
        const isTeamA = match.teamA?.includes(player.id)
        const isTeamB = match.teamB?.includes(player.id)
        if ((isTeamA && match.winner === 'a') || (isTeamB && match.winner === 'b')) {
          return true
        }
      }
    }
    return false
  },

  /**
   * 获取超能饮料状态
   */
  getDrinkStatus(roundNo, comebackData) {
    const drinkRounds = comebackData?.drinkRounds || {}
    const roundData = drinkRounds[String(roundNo)]
    if (!roundData) return null
    return {
      dice: roundData.dice,
      activated: roundData.activated || false,
      tied: roundData.tied || false,
      carryOver: roundData.carryOver || false
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

      if (isTeamA && match.winner === 'a') bigScore++
      if (isTeamB && match.winner === 'b') bigScore++

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

    // 第7轮结束后结算绝对压制2.0和关键先生
    const completedRounds = rounds.filter(r => r.status === STATUS.COMPLETED).length
    let bonusBigScore = 0
    let bonusSmallScore = 0
    let dominationV2Count = 0
    let clutchCount = 0

    if (completedRounds >= DOMINATION_V2.settleAfterRound) {
      dominationV2Count = this.calcDominationV2Count(playerId, matches, getGamesByMatch)
      const domReward = this.getDominationV2Reward(dominationV2Count)
      bonusBigScore += domReward.bonusBigScore
      bonusSmallScore += domReward.bonusSmallScore

      clutchCount = this.calcClutchCount(playerId, matches, getGamesByMatch)
      const comebackData = season?.comebackData
      const clutchReward = this.getClutchReward(clutchCount, comebackData)
      bonusBigScore += clutchReward.bonusBigScore
      bonusSmallScore += clutchReward.bonusSmallScore
    }

    return {
      bigScore,
      smallScore,
      totalPoints,
      bonusBigScore,
      bonusSmallScore,
      finalBigScore: bigScore + bonusBigScore,
      finalSmallScore: smallScore + bonusSmallScore,
      dominationV2Count,
      clutchCount
    }
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
    const comebackData = season?.comebackData

    // 绝对压制2.0
    const domCount = this.calcDominationV2Count(playerId, matches, getGamesByMatch)
    if (domCount > 0) {
      const reward = this.getDominationV2Reward(domCount)
      const settled = completedRounds >= DOMINATION_V2.settleAfterRound
      buffs.push({
        id: 'domination_v2',
        name: '压制2.0',
        count: domCount,
        reward: settled ? reward : null,
        settled,
        description: `已触发${domCount}次${settled ? '，已结算' : '，第7轮后结算'}`
      })
    }

    // 关键先生
    const clutchCount = this.calcClutchCount(playerId, matches, getGamesByMatch)
    if (clutchCount > 0) {
      const reward = this.getClutchReward(clutchCount, comebackData)
      const settled = completedRounds >= CLUTCH.settleAfterRound
      buffs.push({
        id: 'clutch',
        name: '关键先生',
        count: clutchCount,
        reward: settled ? reward : null,
        settled,
        description: `已触发${clutchCount}次${settled ? '，已结算' : '，第7轮后结算'}`
      })
    }

    // 关键先生骰子加成
    if (comebackData?.clutchDice) {
      comebackData.clutchDice.forEach(d => {
        if (d.playerId === playerId) {
          buffs.push({
            id: 'clutch_dice',
            name: '关键骰子',
            diceResult: d.diceResult,
            roundNo: d.roundNo,
            bonus: d.bonus,
            settled: true,
            description: `骰子${d.diceResult}，第${d.roundNo}轮大分+${d.bonus}`
          })
        }
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
    const comebackData = season?.comebackData

    const buffs = []

    // 超能饮料状态
    buffs.push({
      id: 'drink',
      name: '超能饮料',
      condition: '每轮掷骰子，1或6激活',
      effect: '3/4名为1/2名购买运动饮料',
      settled: false,
      interactive: true,
      drinkRounds: comebackData?.drinkRounds || {}
    })

    // 绝对压制2.0状态
    const domSettled = completedRounds >= DOMINATION_V2.settleAfterRound
    buffs.push({
      id: 'domination_v2',
      name: '绝对压制2.0',
      condition: `小局净胜分≥${DOMINATION_V2.minPointDiff}且对手<12分`,
      rewards: '累计不循环：暂停→小分+1→大分+1',
      settleAt: `第${DOMINATION_V2.settleAfterRound}轮后`,
      settled: domSettled,
      currentRound: completedRounds
    })

    // 关键先生状态
    const clutchSettled = completedRounds >= CLUTCH.settleAfterRound
    // 检查是否有待掷骰子的选手
    const pendingClutchDice = []
    if (clutchSettled) {
      participants.forEach(pId => {
        const count = this.calcClutchCount(pId, matches, getGamesByMatch)
        const sequence = CLUTCH.rewardSequence
        const effectiveCount = Math.min(count, sequence.length)
        // 不循环时仅检查顺序奖励内的骰子位置（当前为第4次触发）
        for (let i = 1; i <= effectiveCount; i++) {
          const reward = sequence[i - 1]
          if (reward.type === 'dice') {
            // 检查是否已掷
            const alreadyRolled = comebackData?.clutchDice?.some(
              d => d.playerId === pId && d.triggerIndex === i
            )
            if (!alreadyRolled) {
              const player = getPlayerById(pId)
              pendingClutchDice.push({
                playerId: pId,
                playerName: player?.name || pId,
                triggerIndex: i
              })
            }
          }
        }
      })
    }

    buffs.push({
      id: 'clutch',
      name: '关键先生',
      condition: 'Deuce获胜（≥22:20）',
      rewards: '累计不循环：小分+1→大分+1→大分+1→骰子',
      settleAt: `第${CLUTCH.settleAfterRound}轮后`,
      settled: clutchSettled && pendingClutchDice.length === 0,
      currentRound: completedRounds,
      interactive: true,
      pendingClutchDice,
      clutchDiceResults: comebackData?.clutchDice || []
    })

    // 绝地反击2.0状态
    const comebackV2Status = completedRounds >= 4
      ? this.getComebackV2Status(participants, matches, getGamesByMatch, getPlayerById, rounds)
      : []

    buffs.push({
      id: 'comeback_v2',
      name: '绝地反击2.0',
      condition: '第5/6/7轮第4名开局加分',
      effect: '第5轮+3/第6轮+2/第7轮+1（仅提示）',
      settled: false,
      interactive: true,
      comebackV2Status
    })

    return {
      buffs,
      domSettled,
      clutchSettled
    }
  }
}
