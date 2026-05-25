/**
 * Badminton scoring validation
 *
 * A game ends when:
 * - One side reaches the target score and leads by ≥ 2
 * - After deuce, first to lead by 2 wins until the point cap
 * - Standard games use target 21 / cap 30
 * - S5 mutation rounds use target 15 / cap 21
 */
const { MATCH_FORMAT, WINNER_SIDE } = require('../constants');

function canEndGame(scoreA, scoreB, options = {}) {
  const targetScore = Number(options.targetScore || 21)
  const maxScore = targetScore === 15 ? 21 : 30

  if (scoreA === scoreB) {
    return { canEnd: false, winner: null, reason: '比分不能相等' }
  }

  const winner = scoreA > scoreB ? WINNER_SIDE.A : WINNER_SIDE.B
  const wScore = winner === WINNER_SIDE.A ? scoreA : scoreB
  const lScore = winner === WINNER_SIDE.A ? scoreB : scoreA
  const diff = wScore - lScore

  // Point cap: standard games cap at 30; S5 mutation rounds cap at 21.
  if (wScore >= maxScore) {
    if (diff > 1 && wScore === maxScore && lScore <= maxScore - 2) {
      // Could the game have ended one point earlier?
      if (lScore <= maxScore - 3) {
        return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，领先${diff}分时比赛应已在${maxScore - 1}:${lScore}结束` }
      }
      return { canEnd: true, winner, reason: '' }
    }
    if (wScore === maxScore && lScore === maxScore - 1) {
      return { canEnd: true, winner, reason: '' }
    }
    if (wScore > maxScore) {
      return { canEnd: false, winner: null, reason: `最高${maxScore}分封顶` }
    }
  }

  // Before cap: validate that the game would have naturally ended
  if (wScore >= targetScore) {
    if (diff >= 2) {
      // Check if the game should have ended earlier
      // The final score must be the first point where target and 2-point lead are both met.
      if (lScore >= targetScore - 1) {
        // Both ≥ 20, deuce territory
        if (diff === 2) {
          return { canEnd: true, winner, reason: '' }
        }
        return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，领先${diff}分，应提前在${lScore+2}:${lScore}结束` }
      } else {
        // Loser below deuce, winner should have won at target score.
        if (wScore === targetScore && diff >= 2) {
          return { canEnd: true, winner, reason: '' }
        }
        return { canEnd: false, winner: null, reason: `比分不合理：${wScore}:${lScore}，应在${targetScore}:${lScore}时结束` }
      }
    } else {
      // wScore ≥ 21 but diff < 2 → still playing
      return { canEnd: false, winner: null, reason: `领先不足2分（差${diff}分），需继续比赛` }
    }
  }

  return { canEnd: false, winner: null, reason: `需达到${targetScore}分且领先2分（当前最高${wScore}分）` }
}

function checkMatchComplete(completedGames, gameCount, matchFormat) {
  let winsA = 0, winsB = 0
  for (const g of completedGames) {
    if (g.winner === WINNER_SIDE.A) winsA++
    if (g.winner === WINNER_SIDE.B) winsB++
  }

  const totalGames = gameCount || 3
  const format = matchFormat || (totalGames === 7 ? MATCH_FORMAT.PA7 : totalGames === 1 ? MATCH_FORMAT.BO1 : MATCH_FORMAT.BO3)

  if (format === MATCH_FORMAT.PA7) {
    if (completedGames.length >= totalGames) return { isComplete: true, winner: winsA > winsB ? WINNER_SIDE.A : WINNER_SIDE.B }
    return { isComplete: false, winner: null }
  }

  const winsNeeded = Math.ceil(totalGames / 2)
  if (winsA >= winsNeeded) return { isComplete: true, winner: WINNER_SIDE.A }
  if (winsB >= winsNeeded) return { isComplete: true, winner: WINNER_SIDE.B }
  if (completedGames.length >= totalGames) return { isComplete: true, winner: winsA > winsB ? WINNER_SIDE.A : WINNER_SIDE.B }
  return { isComplete: false, winner: null }
}

module.exports = { canEndGame, checkMatchComplete }
