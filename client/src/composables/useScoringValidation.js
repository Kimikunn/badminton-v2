import { ref, computed } from 'vue'

/**
 * useScoringValidation — 羽毛球比分验证
 *
 * 规则与后端 scoringService.canEndGame 完全一致：
 * - 先达到目标分且领先2分者胜
 * - 平分后需领先2分
 * - 标准局 21/30；S5 异变局 15/21
 * - 防止"应提前结束"的非法比分（如 23:20）
 *
 * Usage:
 *   const { errorMessage, isValid, validation, validateGameScore, clearValidation } = useScoringValidation()
 *   validateGameScore(21, 19) // → { canEnd: true, winner: 'a', reason: '' }
 */
export function useScoringValidation() {
  const errorMessage = ref('')
  const isValid = computed(() => !errorMessage.value)

  const validation = ref({
    canEnd: false,
    winner: null,
    reason: ''
  })

  /**
   * 验证单局比分是否可结束
   * @param {number|string} scoreA
   * @param {number|string} scoreB
   * @returns {{canEnd: boolean, winner: 'a'|'b'|null, reason: string}}
   */
  function validateGameScore(scoreA, scoreB, options = {}) {
    const a = Number(scoreA) || 0
    const b = Number(scoreB) || 0

    const result = canEndGame(a, b, options)
    validation.value = result
    errorMessage.value = result.canEnd ? '' : result.reason
    return result
  }

  function clearValidation() {
    errorMessage.value = ''
    validation.value = { canEnd: false, winner: null, reason: '' }
  }

  return {
    errorMessage,
    isValid,
    validation,
    validateGameScore,
    clearValidation
  }
}

/**
 * 纯函数：能否结束本局（与后端 canEndGame 逻辑一致）
 *
 * @param {number} scoreA
 * @param {number} scoreB
 * @returns {{canEnd: boolean, winner: 'a'|'b'|null, reason: string}}
 */
function canEndGame(scoreA, scoreB, options = {}) {
  const targetScore = Number(options.targetScore || 21)
  const maxScore = targetScore === 15 ? 21 : 30

  if (options.scoringMode === 'resistance') {
    return canEndResistanceGame(scoreA, scoreB, {
      targetScore,
      maxScore,
      winnerOverride: options.winnerOverride
    })
  }

  // 基础范围检查
  if (scoreA < 0 || scoreB < 0) {
    return { canEnd: false, winner: null, reason: '比分不能为负数' }
  }
  if (scoreA > maxScore || scoreB > maxScore) {
    return { canEnd: false, winner: null, reason: `最高${maxScore}分封顶` }
  }

  if (scoreA === scoreB) {
    return { canEnd: false, winner: null, reason: '比分不能相等' }
  }

  const winner = scoreA > scoreB ? 'a' : 'b'
  const wScore = winner === 'a' ? scoreA : scoreB
  const lScore = winner === 'a' ? scoreB : scoreA
  const diff = wScore - lScore

  // 分数封顶：标准21分制封顶30，S5异变15分制封顶21
  if (wScore >= maxScore) {
    if (wScore === maxScore && lScore >= maxScore - 2) {
      return { canEnd: true, winner, reason: '' }
    }
    if (wScore === maxScore && lScore <= maxScore - 3) {
      return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，应在${maxScore - 1}:${lScore}时结束` }
    }
    if (wScore > maxScore) {
      return { canEnd: false, winner: null, reason: `最高${maxScore}分封顶` }
    }
  }

  // 常规目标分逻辑
  if (wScore >= targetScore) {
    if (diff >= 2) {
      if (lScore >= targetScore - 1) {
        // Deuce 区域：必须恰好领先2分
        if (diff === 2) {
          return { canEnd: true, winner, reason: '' }
        }
        // 领先超过2分：应提前结束
        return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，应提前在${lScore + 2}:${lScore}结束` }
      } else {
        // 输家未进入 deuce：winner 应在目标分时结束
        if (wScore === targetScore && diff >= 2) {
          return { canEnd: true, winner, reason: '' }
        }
        return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，应在${targetScore}:${lScore}时结束` }
      }
    } else {
      // 达到目标分但领先不足2分
      return { canEnd: false, winner: null, reason: `领先不足2分（差${diff}分），需继续比赛` }
    }
  }

  // 双方都未达到目标分
  return { canEnd: false, winner: null, reason: `需达到${targetScore}分且领先2分（当前最高${wScore}分）` }
}

function canEndResistanceGame(scoreA, scoreB, options = {}) {
  const targetScore = Number(options.targetScore || 21)
  const maxScore = Number(options.maxScore || 30)
  const winner = options.winnerOverride

  if (scoreA < 0 || scoreB < 0) {
    return { canEnd: false, winner: null, reason: '比分不能为负数' }
  }
  if (scoreA > maxScore || scoreB > maxScore) {
    return { canEnd: false, winner: null, reason: `最高${maxScore}分封顶` }
  }
  if (scoreA === scoreB) {
    return { canEnd: false, winner: null, reason: '比分不能相等' }
  }
  if (!['a', 'b'].includes(winner)) {
    return { canEnd: false, winner: null, reason: '抵抗局需要选择胜方' }
  }

  const winnerScore = winner === 'a' ? scoreA : scoreB
  if (winnerScore < targetScore) {
    return { canEnd: false, winner: null, reason: `抵抗局胜方需至少达到${targetScore}分` }
  }

  return { canEnd: true, winner, reason: '' }
}
