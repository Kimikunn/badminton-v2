import { test, expect } from '@playwright/test'

/**
 * S6 上篇（1-4 轮）王选流程端到端验证
 * 覆盖：UI 创建 S6 预设赛季 → 第 1 轮强制王选（投骰 / 并列重投 / 选形态黛青）
 * → 创建轮次生成比赛 → 进入含王的比赛记分页，黛青形态下王所在方 2:0 开局（服务端写入）
 * 附加：第 2 轮月白王（API 固定骰点）→ 抵抗局 UI —— 提示条、「月白 · 抵抗」胜方选择卡、
 * 未选胜方/胜方不足 21 分不可结束、21:29 分低者获胜（服务端接受）
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 npx playwright test e2e/s6-top-phase.spec.js --project=light
 */

function adminHeaders() {
  const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
  return adminToken ? { 'x-admin-token': adminToken } : {}
}

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

test.describe('S6 top phase (王选)', () => {
  test('king selection, round creation and daiqing opening score', async ({ page, request, baseURL }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE, 'season creation is not expected in this environment')
    test.setTimeout(90000)

    const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
    if (adminToken) {
      await page.addInitScript((token) => {
        window.localStorage.setItem('badclub:adminToken', token)
      }, adminToken)
    }

    let seasonId = ''
    let kingName = ''

    await test.step('reset test data and unlock the S6 preset', async () => {
      const resetRes = await request.post(`${baseURL}/api/admin/reset-db`, { headers: adminHeaders() })
      expect(resetRes.ok()).toBeTruthy()
      await ensureS6IsNextPreset(request, baseURL)
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

      await expect(page.getByText(/已创建 S6-王权之争/)).toBeVisible()

      // 视图默认停留在之前的赛季，切到新建的 S6 标签
      await page.getByRole('button', { name: /S6-王权之争/ }).click()
    })

    await test.step('king selection sheet handles dice rolls and ties', async () => {
      await page.getByRole('button', { name: '+ 创建第 1 轮' }).click()
      await expect(page.getByRole('heading', { name: '第 1 轮 · 王选' })).toBeVisible()

      // 投骰是随机的：出现并列时点击「重投并列者」清空并列者骰子并补投，直到产生唯一的王
      const rerollButton = page.getByRole('button', { name: '重投并列者' })
      for (let attempt = 0; attempt < 10; attempt++) {
        const rollButtons = page.getByRole('button', { name: '投骰', exact: true })
        while (await rollButtons.count() > 0) {
          await rollButtons.first().click()
        }
        if (await rerollButton.count() === 0) break
        await rerollButton.click()
      }

      const kingLine = page.getByText('本轮的王：')
      await expect(kingLine).toBeVisible()
      kingName = (await kingLine.textContent()).replace('本轮的王：', '').trim()
      expect(kingName).toBeTruthy()

      // 王所在的行高亮（accent 边框 + 底色）
      const kingRow = page.locator('div.border-accent.bg-accent-subtle', { hasText: kingName })
      await expect(kingRow).toBeVisible()
    })

    await test.step('select daiqing form and submit king selection', async () => {
      await page.getByRole('button', { name: /黛青/ }).click()

      const rollActionPromise = page.waitForResponse(response => response.url().includes('/actions/s6_king_roll'))
      const formActionPromise = page.waitForResponse(response => response.url().includes('/actions/s6_king_form'))
      await page.getByRole('button', { name: '确认王选' }).click()
      expect((await rollActionPromise).ok()).toBeTruthy()
      expect((await formActionPromise).ok()).toBeTruthy()

      // 服务端已持久化第 1 轮的王与形态
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const king = (await seasonRes.json()).data?.comebackData?.s6?.topKings?.['1']
      expect(king?.kingId).toBeTruthy()
      expect(king?.form).toBe('daiqing')

      // 王选提交后自动打开创建轮次面板
      await expect(page.getByRole('heading', { name: '创建下一轮' })).toBeVisible()
    })

    await test.step('create round 1 and verify matches are generated', async () => {
      const roundResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/rounds') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '确认', exact: true }).click()
      expect((await roundResponsePromise).ok()).toBeTruthy()

      await expect(page.getByText('第 1 轮已创建')).toBeVisible()
      // 4 人双打一轮 3 场
      await expect(page.getByText(/ vs /)).toHaveCount(3)
    })

    await test.step('king side starts the game 2:0 under daiqing form', async () => {
      // 每场都包含全部 4 名参赛者，直接进第一场（唯一可开始的场次）
      await page.getByRole('button', { name: '开始' }).first().click()
      await expect(page).toHaveURL(/\/scoring\//)

      // 记分页展示黛青形态规则提示
      await expect(page.getByText('黛青形态：王所在方每局 2:0 开局')).toBeVisible()

      // 服务端在局进入进行中时写入开局分：王所在方 2，对方 0
      await expect(page.getByRole('spinbutton')).toHaveCount(2)
      const readScores = () => page.evaluate(() =>
        [...document.querySelectorAll('input.score-input')].map(input => ({
          value: input.value,
          names: [...input.closest('div.flex-1').querySelectorAll('span')].map(s => s.textContent)
        }))
      )
      await expect.poll(async () => {
        const sides = await readScores()
        return sides.find(s => s.names.includes(kingName))?.value
      }).toBe('2')

      const sides = await readScores()
      expect(sides.find(s => !s.names.includes(kingName))?.value).toBe('0')
    })

    await test.step('fast-forward round 1 and rig round 2 with a yuebai king via API', async () => {
      // 打完第 1 轮全部 3 场（teamA 2-0；start 幂等，逐局写绝对比分后结束）
      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round1 = ((await roundsRes.json()).data || []).find(r => r.roundNo === 1)
      const matchesRes = await request.get(`${baseURL}/api/matches?seasonId=${seasonId}`)
      const round1Matches = ((await matchesRes.json()).data || []).filter(m => m.roundId === round1.id)
      expect(round1Matches).toHaveLength(3)
      for (const match of round1Matches) {
        await request.post(`${baseURL}/api/matches/${match.id}/start`, { headers: adminHeaders() })
        for (let i = 0; i < 2; i++) {
          const gamesRes = await request.get(`${baseURL}/api/matches/${match.id}/games`)
          const current = ((await gamesRes.json()).data || []).find(g => g.status === 'in_progress')
          expect(current).toBeTruthy()
          await request.put(`${baseURL}/api/games/${current.id}/score`, { headers: adminHeaders(), data: { scoreA: 21, scoreB: 10 } })
          const endRes = await request.post(`${baseURL}/api/games/${current.id}/end`, { headers: adminHeaders(), data: {} })
          expect(endRes.ok()).toBeTruthy()
        }
      }

      // 第 2 轮王选：固定骰点 1/2/3/6 → 王 = 种子 D 位选手，形态月白
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const participants = (await seasonRes.json()).data?.participants || []
      const sorted = [...participants].sort()
      const dice = [1, 2, 3, 6]
      const rollRes = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/s6_king_roll`, {
        headers: adminHeaders(),
        data: { roundNo: 2, rolls: sorted.map((pid, i) => ({ playerId: pid, dice: dice[i] })) }
      })
      expect(rollRes.ok()).toBeTruthy()
      const formRes = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/s6_king_form`, {
        headers: adminHeaders(),
        data: { roundNo: 2, form: 'yuebai' }
      })
      expect(formRes.ok()).toBeTruthy()

      const roundRes = await request.post(`${baseURL}/api/rounds`, {
        headers: adminHeaders(),
        data: { seasonId, roundNo: 2 }
      })
      expect(roundRes.status()).toBe(201)
      expect((await roundRes.json()).data?.matches || []).toHaveLength(3)
    })

    await test.step('yuebai king games require explicit winner selection (resistance)', async () => {
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const participants = (await seasonRes.json()).data?.participants || []
      const playersRes = await request.get(`${baseURL}/api/players`)
      const players = (await playersRes.json()).data || []
      const name = id => players.find(p => p.id === id)?.name || id
      // 第 2 轮 M1 固定对阵：teamA=participants[0..1]，teamB=participants[2..3]
      const teamALabel = `${name(participants[0])}/${name(participants[1])}`
      const teamBLabel = `${name(participants[2])}/${name(participants[3])}`

      await page.goto('/matches', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()
      await page.getByRole('button', { name: '开始' }).first().click()
      await expect(page).toHaveURL(/\/scoring\//)

      // 月白新文案提示条 + 抵抗局胜方选择卡
      await expect(page.getByText(/月白形态：对方先到 15 分后王获得抵抗/)).toBeVisible()
      await expect(page.getByText('月白 · 抵抗')).toBeVisible()
      const inputs = page.getByRole('spinbutton')
      await expect(inputs).toHaveCount(2)

      // 未选胜方不可结束
      await inputs.nth(0).fill('21')
      await inputs.nth(1).fill('19')
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText('抵抗局需要选择胜方').first()).toBeVisible()
      await expect(page.getByText('确认结束本局？')).toHaveCount(0)

      // 胜方不足 21 分不可结束（选 A 方但 A 只有 20 分）
      await inputs.nth(0).fill('20')
      await inputs.nth(1).fill('22')
      await page.getByRole('button', { name: teamALabel, exact: true }).first().click()
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText(/抵抗局胜方需至少达到21分/).first()).toBeVisible()
      await expect(page.getByText('确认结束本局？')).toHaveCount(0)

      // 分低者获胜：21:29 选 A 方（A 保持选中），服务端接受
      await inputs.nth(0).fill('21')
      await inputs.nth(1).fill('29')
      const endPromise = page.waitForResponse(response =>
        response.url().includes('/end') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText('确认结束本局？')).toBeVisible()
      await expect(page.getByText(teamALabel).last()).toBeVisible()
      await page.getByRole('button', { name: '确认', exact: true }).click()
      expect((await endPromise).ok()).toBeTruthy()

      // G1 以 21:29、A 方获胜落库
      await expect(page.getByText('21:29')).toBeVisible()
      await expect(page.getByText('1:0', { exact: true })).toBeVisible()
    })

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
