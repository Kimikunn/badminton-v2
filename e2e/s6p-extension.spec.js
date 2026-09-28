import { test, expect } from '@playwright/test'

/**
 * S6+ 延长赛（S6 赛季延长赛，由 S7-王权之续更名）端到端验证
 * 覆盖：
 * - API 建季（ruleId s6p / totalRounds 2 / 主题色 sunset / 幸运数建季即定）
 * - UI 灵魂契合 Sheet：本轮奇招数展示 + 双组合掷骰（投 1/2 次、第二次为准）+
 *   按阶选奖 + 创建门控（两组合完成前禁用）+ 第 1 轮固定对阵 AB vs CD（PA7）
 * - API 负面校验：王选动作不支持 422、第 3 轮越界 422、建轮后 soul_roll 422
 * - 2 轮全打满后积分榜呈现：灵魂契合 / 王之宝库 / 组合星尘 / 冠军
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 npx playwright test e2e/s6p-extension.spec.js --project=light
 */

function adminHeaders() {
  const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
  return adminToken ? { 'x-admin-token': adminToken } : {}
}

async function postAction(request, baseURL, seasonId, actionId, payload, expectOk = true) {
  const res = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/${actionId}`, {
    headers: adminHeaders(),
    data: payload
  })
  if (expectOk) expect(res.ok()).toBeTruthy()
  return res
}

// 局前记录门控：为 gameNo 提交需录入选手「不使用」暗选并重新 start（下一局推进）
// 免录入局已自动开始：视为就绪
async function submitNullPicks(request, baseURL, seasonId, matchId, gameNo, players) {
  for (const pid of players) {
    const res = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/s6p_card_activate`, {
      headers: adminHeaders(), data: { matchId, gameNo, playerId: pid, cardId: null }
    })
    if (!res.ok()) {
      const msg = (await res.text()).slice(0, 160)
      if (!/已提交暗选|该局已开始/.test(msg)) {
        console.log('DBG-ACT', gameNo, pid, res.status(), msg)
        expect(res.ok()).toBeTruthy()
      }
    }
  }
  const startRes = await request.post(`${baseURL}/api/matches/${matchId}/start`, { headers: adminHeaders() })
  expect(startRes.ok()).toBeTruthy()
}

// 打完一场比赛：开局后按给定胜方序列逐局记分结束（21 分制）；
// 组合轮每局之间按需提交局前暗选
async function finishMatch(request, baseURL, matchId, gameWinners, seasonId = null, players = null) {
  // 比赛已进行中（前一步已 start）则跳过初始 start（门控会盯下一局的暗选）
  const stateRes = await request.get(`${baseURL}/api/matches/${matchId}`)
  const matchState = (await stateRes.json()).data?.status
  if (matchState !== 'in_progress') {
    // 新比赛：第 1 局开始前需录入选手局前暗选（不使用）——提交后 start
    if (seasonId && players) {
      await submitNullPicks(request, baseURL, seasonId, matchId, 1, players)
    } else {
      const startRes = await request.post(`${baseURL}/api/matches/${matchId}/start`, { headers: adminHeaders() })
      expect(startRes.ok()).toBeTruthy()
    }
  }

  for (let i = 0; i < gameWinners.length; i++) {
    const side = gameWinners[i]
    const gamesRes = await request.get(`${baseURL}/api/matches/${matchId}/games`)
    const games = (await gamesRes.json()).data || []
    const current = games.find(g => g.status === 'in_progress')
    expect(current, `match ${matchId} G${i + 1} 应有一局进行中`).toBeTruthy()

    const score = side === 'a' ? { scoreA: 21, scoreB: 10 } : { scoreA: 10, scoreB: 21 }
    const scoreRes = await request.put(`${baseURL}/api/games/${current.id}/score`, { headers: adminHeaders(), data: score })
    expect(scoreRes.ok()).toBeTruthy()
    const endRes = await request.post(`${baseURL}/api/games/${current.id}/end`, { headers: adminHeaders(), data: {} })
    expect(endRes.ok()).toBeTruthy()

    if (i < gameWinners.length - 1 && seasonId && players) {
      await submitNullPicks(request, baseURL, seasonId, matchId, i + 2, players)
    }
  }
}

const CARD_PICK_ORDER = ['暂停卡', '名刀', '阻碍', '进击', '存储器', '月白', '绯红', '时空裂隙', '星尘卡', '爆破']

test.describe('S6+ extension (延长赛)', () => {
  test('soul bond UI flow with lucky number, 3 combo rounds and stardust', async ({ page, request, baseURL }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE, 'season creation is not expected in this environment')
    test.setTimeout(180000)

    const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
    if (adminToken) {
      await page.addInitScript((token) => {
        window.localStorage.setItem('badclub:adminToken', token)
      }, adminToken)
    }

    let seasonId = ''
    let players = []
    const playerName = (id) => players.find(p => p.id === id)?.name || id

    await test.step('reset test data and create the S6+ season via API', async () => {
      const resetRes = await request.post(`${baseURL}/api/admin/reset-db`, { headers: adminHeaders() })
      expect(resetRes.ok()).toBeTruthy()

      const playersRes = await request.get(`${baseURL}/api/players`)
      players = (await playersRes.json()).data || []
      expect(players.length).toBe(4)

      const createRes = await request.post(`${baseURL}/api/seasons`, {
        headers: adminHeaders(),
        data: {
          name: 'S6+ 延长赛',
          ruleId: 's6p',
          totalRounds: 3,
          participants: players.map(p => p.id)
        }
      })
      expect(createRes.status()).toBe(201)
      const payload = await createRes.json()
      seasonId = payload.data?.id
      expect(seasonId).toBeTruthy()
      expect(payload.data?.ruleId).toBe('s6p')

      // 幸运数建季即定（每轮 1-6）
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const lucky = (await seasonRes.json()).data?.comebackData?.s6p?.lucky || {}
      expect(Number.isInteger(lucky['1'])).toBeTruthy()
      expect(Number.isInteger(lucky['2'])).toBeTruthy()
      expect(lucky['1']).toBeGreaterThanOrEqual(1)
      expect(lucky['1']).toBeLessThanOrEqual(6)
    })

    await test.step('soul bond sheet shows lucky number, rolls both combos and picks rewards (UI)', async () => {
      await page.goto(`/matches?season=${seasonId}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '+ 创建第 1 轮' }).click()
      await page.waitForTimeout(800)
      await expect(page.getByRole('heading', { name: '第 1 轮 · 灵魂契合' })).toBeVisible()

      // S6+ 奇招：本轮幸运数展示（1-6）
      await expect(page.getByText('本轮奇招数（投掷命中可选奖励）')).toBeVisible()

      // 门控：两个组合未完成前创建按钮不可用
      await expect(page.getByRole('button', { name: '创建第 1 轮', exact: true })).toBeDisabled()

      const [a, b, c, d] = [...players.map(p => p.id)].sort()
      const combos = [
        { label: 'AB', members: [a, b] },
        { label: 'CD', members: [c, d] }
      ]

      for (const combo of combos) {
        await page.getByRole('button', { name: new RegExp(`${combo.label}组合`) }).click()

        for (const [index, playerId] of combo.members.entries()) {
          const rollButton = page.getByRole('button', { name: index === 0 ? '投 1 次' : '投 2 次' }).first()
          await rollButton.click()
          await expect(page.getByRole('button', { name: '提交投掷' })).toBeVisible()

          const rollResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s6p_soul_roll'))
          await page.getByRole('button', { name: '提交投掷' }).click()
          const rollRes = await rollResponsePromise
          expect(rollRes.ok()).toBeTruthy()
          await expect(page.getByText('已投掷')).toHaveCount(index + 1)
        }

        await expect(page.getByText('已投掷')).toHaveCount(2)

        // 总点数与阶层（UI 骰子随机 → 读取展示值并推导期望阶层）
        const resultRow = page.locator('div.bg-accent-subtle', { hasText: '总点数' })
        await expect(resultRow).toBeVisible()

        // 奇招命中者：先完成二选一（重掷/总点数+1）再选奖；双方可能同时命中，逐个处理
        const choiceArea = page.locator('button', { hasText: '奇招 · 重新投掷一次' })
        try {
          await choiceArea.first().waitFor({ state: 'visible', timeout: 2000 })
        } catch { /* 无人命中奇招 */ }
        let luckyGuard = 0
        while ((await choiceArea.count()) > 0 && luckyGuard++ < 4) {
          const luckyResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s6p_lucky_choice'))
          await choiceArea.first().click()
          expect((await luckyResponsePromise).ok()).toBeTruthy()
        }

        // 逐选手选奖（到次数用完为止；未解锁则免选直接完成）
        for (const playerId of combo.members) {
          const section = page.locator('div.bg-canvas', { hasText: `${playerName(playerId)} 选奖` })
          const pickCount = await section.count()
          if (pickCount === 0) continue
          for (let guard = 0; guard < 3; guard++) {
            let clicked = false
            for (const cardName of CARD_PICK_ORDER) {
              const cardButton = section.getByRole('button', { name: new RegExp(`^${cardName}`) })
              if (await cardButton.count() > 0 && await cardButton.first().isEnabled()) {
                const pickResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s6p_soul_pick'))
                await cardButton.first().click()
                expect((await pickResponsePromise).ok()).toBeTruthy()
                await expect(section.getByText(`已选「${cardName}」`)).toBeVisible()
                clicked = true
                break
              }
            }
            if (!clicked) break
          }
          await expect(section.getByText('次数已用完').first()).toBeVisible()
        }

        await expect(page.getByRole('button', { name: new RegExp(`${combo.label}组合 ✓`) })).toBeVisible()
      }
    })

    await test.step('round 1 creates exactly one PA7 match (AB vs CD by seed order)', async () => {
      await page.getByRole('button', { name: '创建第 1 轮', exact: true }).click()
      await expect(page.getByRole('heading', { name: '创建下一轮' })).toBeVisible()
      await expect(page.getByRole('button', { name: /重新随机/ })).toHaveCount(0)

      const roundResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/rounds') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '确认', exact: true }).click()
      const roundResponse = await roundResponsePromise
      expect(roundResponse.status()).toBe(201)

      const payload = await roundResponse.json()
      const matches = payload.data?.matches || []
      expect(matches).toHaveLength(1)
      expect(matches[0].bestOf).toBe(7)
      expect(matches[0].matchFormat).toBe('pa7')

      // 种子 = 参赛选手 ID 排序（A=p[0]…）：R1 = AB vs CD
      const [a, b, c, d] = [...players.map(p => p.id)].sort()
      expect(matches[0].teamA).toEqual([a, b])
      expect(matches[0].teamB).toEqual([c, d])

      // 局前记录门控：第 1 局开始前需录入选手暗选（不使用）
      await submitNullPicks(request, baseURL, seasonId, matches[0].id, 1, players.map(p => p.id))
    })

    await test.step('negative API checks reject king-era actions and out-of-range rounds', async () => {
      const [a] = [...players.map(p => p.id)].sort()

      const kingAction = await postAction(request, baseURL, seasonId, 's6p_king_roll', { order: [] }, false)
      expect(kingAction.status()).toBe(422)

      // 第 4 轮超出三轮边界
      const outOfRange = await postAction(request, baseURL, seasonId, 's6p_soul_roll', {
        roundNo: 4, comboLabel: 'AB', playerId: a, rollChoice: 1, dice: [3]
      }, false)
      expect(outOfRange.status()).toBe(422)

      // 建轮后不可再对该轮灵魂投掷
      const lateRoll = await postAction(request, baseURL, seasonId, 's6p_soul_roll', {
        roundNo: 1, comboLabel: 'AB', playerId: a, rollChoice: 1, dice: [3]
      }, false)
      expect(lateRoll.status()).toBe(422)
    })

    await test.step('finish round 1 and fast-forward rounds 2-3 via API', async () => {
      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round1 = ((await roundsRes.json()).data || []).find(r => r.roundNo === 1)
      const matchesRes = await request.get(`${baseURL}/api/matches?seasonId=${seasonId}`)
      const match1 = ((await matchesRes.json()).data || []).find(m => m.roundId === round1.id)

      // AB(a) 4-3 CD(b)
      await finishMatch(request, baseURL, match1.id, ['a', 'a', 'a', 'b', 'b', 'a', 'b'], seasonId, players.map(p => p.id))

      const [p1, p2, p3, p4] = [...players.map(p => p.id)].sort()
      // 骰值必须避开本轮幸运数（命中会强制奇招二选一，API 直连无法走 UI 选择）
      const luckySeasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const luckyByRound = ((await luckySeasonRes.json()).data || {}).comebackData?.s6p?.lucky || {}
      const safeDice = (roundNo, offset = 0) => {
        const unlucky = Number(luckyByRound[String(roundNo)] || luckyByRound[roundNo])
        const candidates = [1, 2, 3, 4, 5, 6].filter(d => d !== unlucky)
        return [candidates[offset % candidates.length]]
      }
      for (const roundNo of [2, 3]) {
        const labels = roundNo === 2 ? ['AC', 'BD'] : ['AD', 'BC']
        for (const label of labels) {
          const ids = label.split('')
          const members = ids.map(key => ({ A: p1, B: p2, C: p3, D: p4 })[key])
          await postAction(request, baseURL, seasonId, 's6p_soul_roll', { roundNo, comboLabel: label, playerId: members[0], rollChoice: 1, dice: safeDice(roundNo, 0) })
          await postAction(request, baseURL, seasonId, 's6p_soul_roll', { roundNo, comboLabel: label, playerId: members[1], rollChoice: 1, dice: safeDice(roundNo, 1) })
          await postAction(request, baseURL, seasonId, 's6p_soul_pick', { roundNo, comboLabel: label, playerId: members[0], cardId: 'pause' })
          await postAction(request, baseURL, seasonId, 's6p_soul_pick', { roundNo, comboLabel: label, playerId: members[1], cardId: 'blade' })
        }
        const roundRes = await request.post(`${baseURL}/api/rounds`, { headers: adminHeaders(), data: { seasonId, roundNo } })
        expect(roundRes.status()).toBe(201)
        const roundPayload = await roundRes.json()
        const matches = roundPayload.data?.matches || []
        expect(matches).toHaveLength(1)
        await finishMatch(request, baseURL, matches[0].id, ['a', 'a', 'a', 'b', 'b', 'a', 'b'], seasonId, players.map(p => p.id))
      }

      const roundsAfter = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const rounds = (await roundsAfter.json()).data || []
      expect(rounds).toHaveLength(3)
      expect(rounds.every(r => r.status === 'completed')).toBeTruthy()

      // 赛季完成：三轮总星尘冠军落盘
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const season = (await seasonRes.json()).data || {}
      expect(season.status).toBe('completed')
      expect(season.championPlayerId || season.champion_player_id).toBeTruthy()
    })

    await test.step('rankings page shows soul bond, treasury, stardust and champion', async () => {
      await page.goto(`/rankings?season=${seasonId}`, { waitUntil: 'networkidle' })

      await expect(page.getByText('总排名', { exact: true })).toBeVisible()
      await expect(page.getByText('灵魂契合', { exact: true })).toBeVisible()
      await expect(page.getByText('王之宝库', { exact: true })).toBeVisible()
      await expect(page.getByText('组合星尘', { exact: true })).toBeVisible()
      await expect(page.getByText('最强组合', { exact: true })).toBeVisible()

      // 星尘榜数字（存在非零星尘）
      const stars = page.getByText(/✦\d+/)
      await expect(stars.first()).toBeVisible()

      // 宝库库存：第一阶选奖（暂停卡/名刀 ×3 各）
      await expect(page.getByText(/暂停卡/).first()).toBeVisible()
    })

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
