import { test, expect } from '@playwright/test'

/**
 * S6 下篇（5-7 轮）组合赛 + 灵魂契合端到端验证
 * 覆盖：
 * - API 快进上篇 1-4 轮（王选 s6_king_roll/s6_king_form + 建轮 + BO3 完赛）
 * - UI 灵魂契合 Sheet：逐组合投 1/2 次、暂存提交、总点数/阶层自适应断言、
 *   重投令牌（凯旋/贯穿碎片）、按解锁阶层选奖（禁用原因）、门控后创建第 5 轮
 * - 第 5 轮只生成一场 PA7（bestOf 7 / matchFormat pa7），随机对阵被拒绝
 * - API 负面校验：锁阶选奖 422、重复选奖 422、轮次创建后 soul_roll 422
 * - PA7 完赛后组合星尘榜星尘数（手工核算：AB 14 / CD 10）与宝库库存展示
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 npx playwright test e2e/s6-combo-phase.spec.js --project=light
 */

function adminHeaders() {
  const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
  return adminToken ? { 'x-admin-token': adminToken } : {}
}

// 注意：本规格在 Service Worker 激活状态下运行（/api/seasons 为 StaleWhileRevalidate），
// 灵魂契合提交后 Sheet 的即时更新依赖 recordAction 直接 upsert POST 响应中的赛季数据，
// 是对该修复的回归验证，不要屏蔽 SW。

// 让 S6 成为「下一个可创建赛季」：清掉已存在的 S6，并确保 S5 已完成
async function ensureS6IsNextPreset(request, baseURL) {
  const headers = adminHeaders()
  const listRes = await request.get(`${baseURL}/api/seasons`)
  const seasons = (await listRes.json()).data || []

  const existingS6 = seasons.find(s => s.ruleId === 's6')
  if (existingS6) {
    const del = await request.delete(`${baseURL}/api/seasons/${existingS6.id}`, { headers })
    expect(del.ok()).toBeTruthy()
  }

  const s5 = seasons.find(s => s.ruleId === 's5')
  if (s5 && s5.status !== 'completed') {
    const put = await request.put(`${baseURL}/api/seasons/${s5.id}`, { headers, data: { status: 'completed' } })
    expect(put.ok()).toBeTruthy()
  }
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

// 总点数 → 解锁阶层（与服务端 getUnlockTier 一致）
function expectedTier(total) {
  if (total === 13) return 'chosen'
  if (total >= 10) return 3
  if (total >= 7) return 2
  if (total >= 3) return 1
  return null
}

const TIER_LABELS = { chosen: '天选', 3: '第三阶', 2: '第二阶', 1: '第一阶', null: '未解锁' }

// 卡片网格中卡片按钮的可访问名以卡片名开头（「高级暂停卡」需先于「暂停卡」匹配则用 ^ 锚定）
const CARD_PICK_ORDER = ['暂停卡', '名刀', '阻碍', '进击', '高级暂停卡', '存储器', '时空裂隙', '星尘卡', '爆破']

test.describe('S6 combo phase (灵魂契合)', () => {
  test('soul bond flow, PA7 round creation and combo stardust', async ({ page, request, baseURL }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE, 'season creation is not expected in this environment')
    test.setTimeout(120000)

    const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
    if (adminToken) {
      await page.addInitScript((token) => {
        window.localStorage.setItem('badclub:adminToken', token)
      }, adminToken)
    }

    let seasonId = ''
    let players = []
    const playerName = (id) => players.find(p => p.id === id)?.name || id

    await test.step('reset test data and unlock the S6 preset', async () => {
      const resetRes = await request.post(`${baseURL}/api/admin/reset-db`, { headers: adminHeaders() })
      expect(resetRes.ok()).toBeTruthy()
      await ensureS6IsNextPreset(request, baseURL)

      const playersRes = await request.get(`${baseURL}/api/players`)
      players = (await playersRes.json()).data || []
      expect(players.length).toBe(4)
    })

    await test.step('create the S6 preset season through the business UI', async () => {
      await page.goto('/matches', { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: '+ 创建赛季' }).click()
      await expect(page.getByRole('heading', { name: '创建赛季' })).toBeVisible()
      await expect(page.getByText('S6 · 王权之争')).toBeVisible()

      const createResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/seasons') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '确认创建' }).click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok()).toBeTruthy()

      const payload = await createResponse.json()
      seasonId = payload.data?.id
      expect(seasonId).toBeTruthy()
      expect(payload.data?.ruleId).toBe('s6')
      expect(payload.data?.participants).toHaveLength(4)
    })

    await test.step('fast-forward top phase rounds 1-4 via API', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      for (let roundNo = 1; roundNo <= 4; roundNo++) {
        // 固定骰点 1/2/3/6 → 唯一最高点为 D；形态选绯红（无开局分，避免干扰计分）
        await postAction(request, baseURL, seasonId, 's6_king_roll', {
          roundNo,
          rolls: [
            { playerId: a, dice: 1 },
            { playerId: b, dice: 2 },
            { playerId: c, dice: 3 },
            { playerId: d, dice: 6 }
          ]
        })
        await postAction(request, baseURL, seasonId, 's6_king_form', { roundNo, form: 'feihong' })

        const roundRes = await request.post(`${baseURL}/api/rounds`, {
          headers: adminHeaders(),
          data: { seasonId, roundNo }
        })
        expect(roundRes.status()).toBe(201)
        const roundPayload = await roundRes.json()
        const matches = roundPayload.data?.matches || []
        expect(matches).toHaveLength(3)

        // 每场 teamA 2-0 获胜 → 上篇胜场：A 3 胜，B/C/D 各 1 胜（凯旋前二 = A、B）
        for (const match of matches) {
          await finishMatch(request, baseURL, match.id, ['a', 'a'])
        }
      }

      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const rounds = (await roundsRes.json()).data || []
      expect(rounds).toHaveLength(4)
      expect(rounds.every(r => r.status === 'completed')).toBeTruthy()
    })

    await test.step('soul bond sheet rolls both combos with adaptive tier assertions', async () => {
      await page.goto('/matches', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()

      await page.getByRole('button', { name: '+ 创建第 5 轮' }).click()
      await expect(page.getByRole('heading', { name: '第 5 轮 · 灵魂契合' })).toBeVisible()

      // 门控：两个组合未完成前创建按钮不可用
      await expect(page.getByRole('button', { name: '创建第 5 轮', exact: true })).toBeDisabled()

      const [a, b, c, d] = [...players.map(p => p.id)].sort()
      const combos = [
        { label: 'AB', members: [a, b] },
        { label: 'CD', members: [c, d] }
      ]

      for (const combo of combos) {
        await page.getByRole('button', { name: new RegExp(`${combo.label}组合`) }).click()

        // 双方依次投掷：A/C 投 1 次，B/D 投 2 次（覆盖「第二次为准」路径）
        for (const [index, playerId] of combo.members.entries()) {
          const rollButton = page.getByRole('button', { name: index === 0 ? '投 1 次' : '投 2 次' }).first()
          await rollButton.click()
          await expect(page.getByRole('button', { name: '提交投掷' })).toBeVisible()
          if (index === 1) {
            await expect(page.getByText('第二次为准', { exact: true })).toBeVisible()
          }

          const rollResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s6_soul_roll'))
          await page.getByRole('button', { name: '提交投掷' }).click()
          expect((await rollResponsePromise).ok()).toBeTruthy()
          // recordAction 成功后会强制刷新赛季数据（异步），等 UI 反映已投掷再操作下一位，
          // 否则块内按钮回退成「投 1/2 次」会导致对同一人重复提交
          await expect(page.getByText('已投掷')).toHaveCount(index + 1)
        }

        // 双方均已投掷
        await expect(page.getByText('已投掷')).toHaveCount(2)

        // 总点数与阶层（UI 骰子随机 → 读取展示值并推导期望阶层）
        const resultRow = page.locator('div.bg-accent-subtle', { hasText: '总点数' })
        await expect(resultRow).toBeVisible()
        const totalText = await resultRow.textContent()
        const total = Number(totalText.match(/总点数\s*(\d+)/)?.[1])
        expect(total).toBeGreaterThanOrEqual(2)
        expect(total).toBeLessThanOrEqual(13)
        const tier = expectedTier(total)
        await expect(resultRow.getByText(TIER_LABELS[tier], { exact: true })).toBeVisible()

        // 重投令牌（选奖前展示）：上篇前二（A、B）各 1 次凯旋；S5 贯穿碎片 p3=4 → C 有 1 次
        if (combo.label === 'AB') {
          await expect(page.getByRole('button', { name: /凯旋重投（剩 1 次）/ })).toHaveCount(2)
        } else {
          await expect(page.getByRole('button', { name: /贯穿碎片重投（剩 1 次）/ })).toHaveCount(1)
        }

        if (!tier) {
          // 总点数 2：未解锁，无需选奖即完成
          await expect(page.getByText('未解锁宝库奖励，无需选奖')).toBeVisible()
          await expect(page.getByText(/选奖/)).toHaveCount(0)
        } else {
          if (tier === 'chosen') {
            await expect(page.getByText(/天选达成！/)).toBeVisible()
          }

          // 锁阶断言（按实际解锁阶层自适应）
          const firstPickSection = page.locator('div.bg-canvas', { hasText: `${playerName(combo.members[0])} 选奖` })
          const tierCap = tier === 'chosen' ? 3 : tier
          if (tierCap < 3) {
            const lockedTier3 = firstPickSection.getByRole('button', { name: /^时空裂隙/ })
            await expect(lockedTier3).toBeDisabled()
            await expect(lockedTier3).toContainText('未解锁第三阶（10-12）')
          }
          if (tierCap < 2) {
            const lockedTier2 = firstPickSection.getByRole('button', { name: /^高级暂停卡/ })
            await expect(lockedTier2).toBeDisabled()
            await expect(lockedTier2).toContainText('未解锁第二阶（7-9）')
          }

          // 逐选手选奖：点各自选奖区第一张可用卡，直到次数用完（同点后投者 2 次自适应）
          for (const playerId of combo.members) {
            const section = page.locator('div.bg-canvas', { hasText: `${playerName(playerId)} 选奖` })
            await expect(section).toBeVisible()
            for (let guard = 0; guard < 3; guard++) {
              let clicked = false
              for (const cardName of CARD_PICK_ORDER) {
                const cardButton = section.getByRole('button', { name: new RegExp(`^${cardName}`) })
                if (await cardButton.count() > 0 && await cardButton.first().isEnabled()) {
                  const pickResponsePromise = page.waitForResponse(response => response.url().includes('/actions/s6_soul_pick'))
                  await cardButton.first().click()
                  expect((await pickResponsePromise).ok()).toBeTruthy()
                  // 等赛季数据刷新、卡片进入「已被选择」禁用态后再继续，避免重复提交
                  await expect(section.getByText(`已选「${cardName}」`)).toBeVisible()
                  clicked = true
                  break
                }
              }
              if (!clicked) break
            }
            // 该选手次数用完后所有卡片均不可点
            await expect(section.getByText('次数已用完').first()).toBeVisible()
          }
        }

        // 组合完成后分段控件打勾
        await expect(page.getByRole('button', { name: new RegExp(`${combo.label}组合 ✓`) })).toBeVisible()
      }
    })

    await test.step('gate opens and round 5 creates exactly one PA7 match', async () => {
      await page.getByRole('button', { name: '创建第 5 轮', exact: true }).click()
      await expect(page.getByRole('heading', { name: '创建下一轮' })).toBeVisible()

      // 组合轮固定对阵，不提供随机
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

      await expect(page.getByText('第 5 轮已创建')).toBeVisible()
      // 当前轮卡片仅一场（可开始的比赛只有一场）
      await expect(page.getByRole('button', { name: '开始' })).toHaveCount(1)
      const liveRow = page.locator('div', { has: page.getByRole('button', { name: '开始' }) }).last()
      await expect(liveRow.getByText(/ vs /)).toHaveCount(1)

      // 开局后服务端生成 7 局
      const startRes = await request.post(`${baseURL}/api/matches/${matches[0].id}/start`, { headers: adminHeaders() })
      expect(startRes.ok()).toBeTruthy()
      const gamesRes = await request.get(`${baseURL}/api/matches/${matches[0].id}/games`)
      expect(((await gamesRes.json()).data || [])).toHaveLength(7)
    })

    await test.step('negative API checks reject invalid soul actions', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      // 轮次创建后不可再灵魂投掷
      const lateRoll = await postAction(request, baseURL, seasonId, 's6_soul_roll', {
        roundNo: 5, comboLabel: 'AB', playerId: a, rollChoice: 1, dice: [3]
      }, false)
      expect(lateRoll.status()).toBe(422)

      // 第 6 轮 AC 组合：1 + 2 = 3 → 仅解锁第一阶
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 6, comboLabel: 'AC', playerId: a, rollChoice: 1, dice: [1] })
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 6, comboLabel: 'AC', playerId: c, rollChoice: 1, dice: [2] })

      // 锁阶选奖 → 422
      const lockedPick = await postAction(request, baseURL, seasonId, 's6_soul_pick', {
        roundNo: 6, comboLabel: 'AC', playerId: a, cardId: 'blast'
      }, false)
      expect(lockedPick.status()).toBe(422)

      // 正常选奖后，同组合重复选同一奖励 → 422
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 6, comboLabel: 'AC', playerId: a, cardId: 'pause' })
      const duplicatePick = await postAction(request, baseURL, seasonId, 's6_soul_pick', {
        roundNo: 6, comboLabel: 'AC', playerId: c, cardId: 'pause'
      }, false)
      expect(duplicatePick.status()).toBe(422)
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 6, comboLabel: 'AC', playerId: c, cardId: 'blade' })

      // 补齐第 6 轮 BD 组合（3 + 4 = 7 → 第二阶），用于后续随机对阵校验
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 6, comboLabel: 'BD', playerId: b, rollChoice: 1, dice: [3] })
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 6, comboLabel: 'BD', playerId: d, rollChoice: 1, dice: [4] })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 6, comboLabel: 'BD', playerId: b, cardId: 'storage' })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 6, comboLabel: 'BD', playerId: d, cardId: 'pause_plus' })
    })

    await test.step('finish the PA7 match via API with scripted winners', async () => {
      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round5 = ((await roundsRes.json()).data || []).find(r => r.roundNo === 5)
      expect(round5).toBeTruthy()

      const matchesRes = await request.get(`${baseURL}/api/matches?seasonId=${seasonId}`)
      const matches = ((await matchesRes.json()).data || []).filter(m => m.roundId === round5.id)
      expect(matches).toHaveLength(1)

      // AB(a) 4-3 CD(b)：a 三连胜开局，b 两连胜，a 终结后 b 拿下决胜局
      await finishMatch(request, baseURL, matches[0].id, ['a', 'a', 'a', 'b', 'b', 'a', 'b'])

      const roundsAfter = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round5After = ((await roundsAfter.json()).data || []).find(r => r.roundNo === 5)
      expect(round5After.status).toBe('completed')
    })

    await test.step('combo rounds reject random pairings', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()
      const res = await request.post(`${baseURL}/api/rounds`, {
        headers: adminHeaders(),
        data: { seasonId, roundNo: 6, pairings: [{ teamA: [a, c], teamB: [b, d] }] }
      })
      expect(res.status()).toBe(422)
      expect((await res.json()).error?.message).toContain('不支持随机对阵')
    })

    await test.step('rankings page shows soul bond, treasury and combo stardust', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      // /api/seasons 已改 NetworkFirst（vite.config.js api-matchdata 组），
      // 跨页面跳转的首次加载即返回最新赛季数据，无需再重载
      await page.goto('/rankings', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()

      // 灵魂契合面板：两个组合的总点数行
      await expect(page.getByRole('heading', { name: '灵魂契合' })).toBeVisible()
      await expect(page.getByText(`${playerName(a)} / ${playerName(b)}`).first()).toBeVisible()
      await expect(page.getByText(`${playerName(c)} / ${playerName(d)}`).first()).toBeVisible()

      // 王之宝库面板：UI 选奖（每组合首张可用卡为暂停卡）+ API 选奖（存储器）入库
      await expect(page.getByRole('heading', { name: '王之宝库' })).toBeVisible()
      await expect(page.getByText('暂停卡 ×3').first()).toBeVisible()
      await expect(page.getByText('存储器 ×2')).toBeVisible()

      // 组合星尘榜：手工核算 AB(a) = 小分 8 + 连胜 2 + 终结 3 = ✦13；CD(b) = 6 + 1 + 3 = ✦10
      await expect(page.getByRole('heading', { name: '组合星尘' })).toBeVisible()
      await expect(page.getByText('✦13')).toBeVisible()
      await expect(page.getByText('✦10')).toBeVisible()
      await expect(page.getByText(/小分 8 · 连胜 \+2 · 终结 \+3/)).toBeVisible()
      await expect(page.getByText(/小分 6 · 连胜 \+1 · 终结 \+3/)).toBeVisible()
    })

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
