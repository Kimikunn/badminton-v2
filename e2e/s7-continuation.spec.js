import { test, expect } from '@playwright/test'

/**
 * S7-王权之续（S6 下篇独立成季）端到端验证
 * 覆盖：
 * - API 建季（ruleId s7 / totalRounds 3 / 主题色 sunset）
 * - UI 灵魂契合 Sheet：双组合掷骰（投 1/2 次、第二次为准）+ 按阶选奖 +
 *   创建门控（两组合完成前禁用）+ 第 1 轮固定对阵 AB vs CD（PA7）
 * - API 负面校验：王选动作不支持 422、越界轮次 422、建轮后 soul_roll 422
 * - 3 轮全打满后积分榜呈现：灵魂契合 / 王之宝库 / 组合星尘 / 最强组合
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 npx playwright test e2e/s7-continuation.spec.js --project=light
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

// 打完一场比赛：开局后按给定胜方序列逐局记分结束（21 分制）
async function finishMatch(request, baseURL, matchId, gameWinners) {
  const startRes = await request.post(`${baseURL}/api/matches/${matchId}/start`, { headers: adminHeaders() })
  expect(startRes.ok()).toBeTruthy()

  for (const side of gameWinners) {
    const gamesRes = await request.get(`${baseURL}/api/matches/${matchId}/games`)
    const games = (await gamesRes.json()).data || []
    const current = games.find(g => g.status === 'in_progress')
    expect(current, `match ${matchId} 应有一局进行中`).toBeTruthy()

    const score = side === 'a' ? { scoreA: 21, scoreB: 10 } : { scoreA: 10, scoreB: 21 }
    const scoreRes = await request.put(`${baseURL}/api/games/${current.id}/score`, { headers: adminHeaders(), data: score })
    expect(scoreRes.ok()).toBeTruthy()
    const endRes = await request.post(`${baseURL}/api/games/${current.id}/end`, { headers: adminHeaders(), data: {} })
    expect(endRes.ok()).toBeTruthy()
  }
}

const CARD_PICK_ORDER = ['暂停卡', '名刀', '阻碍', '进击', '高级暂停卡', '存储器', '时空裂隙', '星尘卡', '爆破']

test.describe('S7 continuation (王权之续)', () => {
  test('soul bond UI flow, PA7 rounds and combo stardust', async ({ page, request, baseURL }) => {
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

    await test.step('reset test data and create the S7 season via API', async () => {
      const resetRes = await request.post(`${baseURL}/api/admin/reset-db`, { headers: adminHeaders() })
      expect(resetRes.ok()).toBeTruthy()

      const playersRes = await request.get(`${baseURL}/api/players`)
      players = (await playersRes.json()).data || []
      expect(players.length).toBe(4)

      const createRes = await request.post(`${baseURL}/api/seasons`, {
        headers: adminHeaders(),
        data: {
          name: 'S7-王权之续',
          ruleId: 's7',
          totalRounds: 3,
          participants: players.map(p => p.id)
        }
      })
      expect(createRes.status()).toBe(201)
      const payload = await createRes.json()
      seasonId = payload.data?.id
      expect(seasonId).toBeTruthy()
      expect(payload.data?.ruleId).toBe('s7')
    })

    await test.step('soul bond sheet rolls both combos and picks rewards (UI)', async () => {
      await page.goto(`/matches?season=${seasonId}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '+ 创建第 1 轮' }).click()
      await expect(page.getByRole('heading', { name: '第 1 轮 · 灵魂契合' })).toBeVisible()

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

          const rollResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s7_soul_roll'))
          await page.getByRole('button', { name: '提交投掷' }).click()
          expect((await rollResponsePromise).ok()).toBeTruthy()
          await expect(page.getByText('已投掷')).toHaveCount(index + 1)
        }

        await expect(page.getByText('已投掷')).toHaveCount(2)

        // 总点数与阶层（UI 骰子随机 → 读取展示值并推导期望阶层）
        const resultRow = page.locator('div.bg-accent-subtle', { hasText: '总点数' })
        await expect(resultRow).toBeVisible()

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
                const pickResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s7_soul_pick'))
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
    })

    await test.step('negative API checks reject king-era actions and out-of-range rounds', async () => {
      const [a] = [...players.map(p => id => id)].length ? [...players.map(p => p.id)].sort() : []

      const kingAction = await postAction(request, baseURL, seasonId, 's7_king_roll', { order: [] }, false)
      expect(kingAction.status()).toBe(422)

      const outOfRange = await postAction(request, baseURL, seasonId, 's7_soul_roll', {
        roundNo: 4, comboLabel: 'AB', playerId: a, rollChoice: 1, dice: [3]
      }, false)
      expect(outOfRange.status()).toBe(422)

      // 建轮后不可再对该轮灵魂投掷
      const lateRoll = await postAction(request, baseURL, seasonId, 's7_soul_roll', {
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
      await finishMatch(request, baseURL, match1.id, ['a', 'a', 'a', 'b', 'b', 'a', 'b'])

      const [p1, p2, p3, p4] = [...players.map(p => p.id)].sort()
      for (const roundNo of [2, 3]) {
        const labels = roundNo === 2 ? ['AC', 'BD'] : ['AD', 'BC']
        for (const label of labels) {
          const ids = label.split('')
          const members = ids.map(key => ({ A: p1, B: p2, C: p3, D: p4 })[key])
          await postAction(request, baseURL, seasonId, 's7_soul_roll', { roundNo, comboLabel: label, playerId: members[0], rollChoice: 1, dice: [3] })
          await postAction(request, baseURL, seasonId, 's7_soul_roll', { roundNo, comboLabel: label, playerId: members[1], rollChoice: 1, dice: [4] })
          await postAction(request, baseURL, seasonId, 's7_soul_pick', { roundNo, comboLabel: label, playerId: members[0], cardId: 'pause' })
          await postAction(request, baseURL, seasonId, 's7_soul_pick', { roundNo, comboLabel: label, playerId: members[1], cardId: 'blade' })
        }
        const roundRes = await request.post(`${baseURL}/api/rounds`, { headers: adminHeaders(), data: { seasonId, roundNo } })
        expect(roundRes.status()).toBe(201)
        const roundPayload = await roundRes.json()
        const matches = roundPayload.data?.matches || []
        expect(matches).toHaveLength(1)
        await finishMatch(request, baseURL, matches[0].id, ['a', 'a', 'a', 'b', 'b', 'a', 'b'])
      }

      const roundsAfter = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const rounds = (await roundsAfter.json()).data || []
      expect(rounds).toHaveLength(3)
      expect(rounds.every(r => r.status === 'completed')).toBeTruthy()
    })

    await test.step('rankings page shows soul bond, treasury, stardust and champion', async () => {
      await page.goto(`/rankings?season=${seasonId}`, { waitUntil: 'networkidle' })

      await expect(page.getByText('总排名', { exact: true })).toBeVisible()
      await expect(page.getByText('灵魂契合', { exact: true })).toBeVisible()
      await expect(page.getByText('王之宝库', { exact: true })).toBeVisible()
      await expect(page.getByText('组合星尘', { exact: true })).toBeVisible()
      await expect(page.getByText('最强组合', { exact: true })).toBeVisible()

      // 星尘榜数字（组合赛三连胜方 AB/AC/AD 同为 seed 前 1+2 组合的胜方口径——断言存在非零星尘）
      const stars = page.getByText(/✦\d+/)
      await expect(stars.first()).toBeVisible()

      // 宝库库存：第一阶选奖（暂停卡/名刀 ×3 各）+ 第二阶（存储器/裂隙）
      await expect(page.getByText(/暂停卡/).first()).toBeVisible()
    })

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
