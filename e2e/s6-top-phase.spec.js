import { test, expect } from '@playwright/test'

/**
 * S6 上篇（1-4 轮）王选流程端到端验证
 * 覆盖：UI 创建 S6 预设赛季 → 一次性王选 Sheet（投骰定第 1-4 轮王序、同点组内重投、
 * 王序校验）→ 第 1 轮形态（黛青）→ 创建轮次 → 黛青形态下王所在方 2:0 开局（服务端写入）。
 * 第 2 轮走形态-only Sheet（王取自王序）→ 月白抵抗局 UI：提示条、「月白 · 抵抗」胜方选择卡、
 * 未选胜方/胜方不足 21 分不可结束、21:29 分低者获胜（服务端接受）。
 * 第 1 轮 API 快进按剧本让王垫底 → 排名页断言王权顺延文案（王第四名，顺延第三名 X 提供饮料）
 * 及排名列表 DOM 顺序与独立口径（大分→小分→得分）完全一致（三人大分/小分并列、得分区分）。
 * API 负面：非排列王序 422、重复王选 422、未选形态建第 2 轮 422。
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

// 投掷序列逐次降序比较（与客户端 compareKingRolls 同口径：重投只决定同点组内顺序）
function compareRolls(x, y) {
  const len = Math.max(x.rolls.length, y.rolls.length)
  for (let i = 0; i < len; i++) {
    const diff = (y.rolls[i] || 0) - (x.rolls[i] || 0)
    if (diff) return diff
  }
  return 0
}

// 王序行文本形如「第 1 轮的王：王铮昊6（重投 4 2）」，解析出轮次/名字/投掷序列
function parseOrderRow(text) {
  const m = text.match(/第 (\d) 轮的王：([^0-9]+?)([0-9].*)?$/)
  expect(m, `王序行可解析: ${text}`).toBeTruthy()
  return {
    round: Number(m[1]),
    name: m[2].trim(),
    rolls: (m[3] || '').match(/\d/g).map(Number)
  }
}

test.describe('S6 top phase (王选)', () => {
  test('one-time king order, daiqing opening score and yuebai resistance game', async ({ page, request, baseURL }) => {
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
    let kingName = '' // 第 1 轮的王（UI 投掷产生，随机）
    let r2KingName = '' // 第 2 轮的王（取自王序）
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

      await expect(page.getByText(/已创建 S6-王权之争/)).toBeVisible()

      // 视图默认停留在之前的赛季，切到新建的 S6 标签
      await page.getByRole('button', { name: /S6-王权之争/ }).click()
    })

    await test.step('negative: malformed king order is rejected', async () => {
      const [a, b, c] = [...players.map(p => p.id)].sort()
      const res = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/s6_king_roll`, {
        headers: adminHeaders(),
        data: {
          order: [
            { playerId: a, dice: 6 },
            { playerId: a, dice: 5 }, // 重复选手 → 非排列
            { playerId: b, dice: 4 },
            { playerId: c, dice: 3 }
          ]
        }
      })
      expect(res.status()).toBe(422)
    })

    await test.step('king selection sheet rolls a full order with group re-rolls', async () => {
      await page.getByRole('button', { name: '+ 创建第 1 轮' }).click()
      await expect(page.getByRole('heading', { name: '王选 · 定第 1-4 轮王序' })).toBeVisible()

      // 投骰是随机的：轮询点击「投骰/重投」按钮直到王序出现（按钮点击对非待投选手
      // 是客户端 no-op，轮询天然规避渲染竞态）；过程中采样并列横幅（同点组存在期间一直可见）
      let sawTieBanner = false
      await expect.poll(async () => {
        const rollButton = page.getByRole('button', { name: /^(投骰|重投)$/ }).first()
        if (await rollButton.count() > 0) await rollButton.click()
        if (await page.getByText(/同点并列：.*组内重投/).count() > 0) sawTieBanner = true
        return page.getByText('第 1 轮的王：').count()
      }, { timeout: 15000, intervals: [100] }).toBe(1)

      // 王序列表：4 行，轮次 1-4 顺次排列
      const orderBox = page.locator('div.bg-accent-subtle', { hasText: '第 1 轮的王：' })
      await expect(orderBox).toBeVisible()
      const rows = (await orderBox.locator(':scope > div').allTextContents()).map(parseOrderRow)
      expect(rows).toHaveLength(4)
      expect(rows.map(r => r.round)).toEqual([1, 2, 3, 4])

      // 王序正确性：与投掷序列逐次降序一致，且首投点数全局非递增（重投不做全局重排）
      const expectedOrder = [...rows].sort(compareRolls).map(r => r.name)
      expect(rows.map(r => r.name)).toEqual(expectedOrder)
      for (let i = 0; i < rows.length - 1; i++) {
        expect(rows[i].rolls[0]).toBeGreaterThanOrEqual(rows[i + 1].rolls[0])
      }

      // 出现过重投 ⟺ 过程中出现过并列横幅
      expect(rows.some(r => r.rolls.length > 1)).toBe(sawTieBanner)

      kingName = rows[0].name
      r2KingName = rows[1].name
    })

    await test.step('select daiqing form and submit king selection', async () => {
      await page.getByRole('button', { name: /黛青/ }).click()

      const rollActionPromise = page.waitForResponse(response => response.url().includes('/actions/s6_king_roll'))
      const formActionPromise = page.waitForResponse(response => response.url().includes('/actions/s6_king_form'))
      await page.getByRole('button', { name: '确认王选' }).click()
      expect((await rollActionPromise).ok()).toBeTruthy()
      expect((await formActionPromise).ok()).toBeTruthy()

      // 服务端已持久化一次性王序与第 1 轮形态
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const s6 = (await seasonRes.json()).data?.comebackData?.s6
      expect(s6?.kingOrder).toHaveLength(4)
      expect(s6.kingOrder.map(e => playerName(e.playerId))[0]).toBe(kingName)
      expect(s6.topKings?.['1']?.form).toBe('daiqing')

      // 王选提交后自动打开创建轮次面板
      await expect(page.getByRole('heading', { name: '创建下一轮' })).toBeVisible()
    })

    await test.step('negative: king selection cannot be submitted twice', async () => {
      const sorted = [...players.map(p => p.id)].sort()
      const res = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/s6_king_roll`, {
        headers: adminHeaders(),
        data: { order: sorted.map((pid, i) => ({ playerId: pid, dice: 6 - i })) }
      })
      expect(res.status()).toBe(422)
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

    await test.step('fast-forward round 1 via API (king scripted last to trigger the 顺延 rule)', async () => {
      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round1 = ((await roundsRes.json()).data || []).find(r => r.roundNo === 1)
      const matchesRes = await request.get(`${baseURL}/api/matches?seasonId=${seasonId}`)
      const round1Matches = ((await matchesRes.json()).data || []).filter(m => m.roundId === round1.id)
      expect(round1Matches).toHaveLength(3)
      const kingId = players.find(p => p.name === kingName)?.id
      expect(kingId).toBeTruthy()
      // 王所在方每场 0:2 落败 → 王 0 胜垫底；负方得分逐场递增（5/9/13），
      // 其余三人互为王搭档各一次 → 总得分互异，第三名（顺延提供人）唯一确定
      for (const [matchIndex, match] of round1Matches.entries()) {
        const kingOnA = match.teamA.includes(kingId)
        const loserScore = 5 + matchIndex * 4
        // start 幂等；逐局写绝对比分后结束
        await request.post(`${baseURL}/api/matches/${match.id}/start`, { headers: adminHeaders() })
        for (let i = 0; i < 2; i++) {
          const gamesRes = await request.get(`${baseURL}/api/matches/${match.id}/games`)
          const current = ((await gamesRes.json()).data || []).find(g => g.status === 'in_progress')
          expect(current).toBeTruthy()
          const score = kingOnA ? { scoreA: loserScore, scoreB: 21 } : { scoreA: 21, scoreB: loserScore }
          await request.put(`${baseURL}/api/games/${current.id}/score`, { headers: adminHeaders(), data: score })
          const endRes = await request.post(`${baseURL}/api/games/${current.id}/end`, { headers: adminHeaders(), data: {} })
          expect(endRes.ok()).toBeTruthy()
        }
      }
    })

    await test.step('rankings page shows the round-1 王权 provider (king last, 顺延第三名)', async () => {
      // 独立口径复核轮内排名：大分 → 小分 → 得分（仅第 1 轮已完赛比赛）
      const roundsRes = await request.get(`${baseURL}/api/rounds?seasonId=${seasonId}`)
      const round1 = ((await roundsRes.json()).data || []).find(r => r.roundNo === 1)
      const matchesRes = await request.get(`${baseURL}/api/matches?seasonId=${seasonId}`)
      const round1Matches = ((await matchesRes.json()).data || []).filter(m => m.roundId === round1.id)
      const stats = new Map(players.map(p => [p.id, { big: 0, small: 0, total: 0 }]))
      for (const match of round1Matches) {
        const gamesRes = await request.get(`${baseURL}/api/matches/${match.id}/games`)
        const games = ((await gamesRes.json()).data || []).filter(g => g.status === 'completed')
        for (const pid of [...match.teamA, ...match.teamB]) {
          const side = match.teamA.includes(pid) ? 'a' : 'b'
          const s = stats.get(pid)
          if (match.winner === side) s.big++
          for (const g of games) {
            if (g.winner === side) s.small++
            s.total += side === 'a' ? (g.scoreA || 0) : (g.scoreB || 0)
          }
        }
      }
      const standings = players
        .map(p => ({ id: p.id, name: p.name, ...stats.get(p.id) }))
        .sort((a, b) => (b.big - a.big) || (b.small - a.small) || (b.total - a.total))
      // 剧本结果：王垫底（第四名），提供人顺延为第三名
      expect(standings[3].name).toBe(kingName)
      const providerName = standings[2].name

      // 剧本构造排序回归场景：其余三人大分（各 2 胜）与小分（各 4 局）全部并列，
      // 仅靠得分（负场 5/9/13 分）区分名次 —— 大分→小分→进球数 的比较器必须生效
      expect(standings.map(s => s.big)).toEqual([2, 2, 2, 0])
      expect(standings.slice(0, 3).every(s => s.small === 4)).toBe(true)
      expect(new Set(standings.map(s => s.total)).size).toBe(4)

      await page.goto(`/rankings?season=${seasonId}`, { waitUntil: 'networkidle' })
      await expect(page.getByText(`王权：王第四名，顺延第三名 ${providerName} 提供饮料`)).toBeVisible()

      // 排名列表的 DOM 顺序与独立口径完全一致（S1Rankings 默认「胜场大分」tab，
      // 继承 calcRankings 的大分→小分→进球数顺序；仅排名区内的选手名行参与比较）
      const rankingSection = page.locator('div.flex.flex-col.gap-5', { has: page.getByRole('button', { name: '胜场大分' }) })
      const nameCells = rankingSection.locator('div.flex.flex-col.gap-2 > div span.block.text-sm.font-semibold.truncate')
      await expect(nameCells).toHaveCount(4)
      const domOrder = (await nameCells.allTextContents()).map(s => s.trim())
      expect(domOrder).toEqual(standings.map(s => s.name))
    })

    await test.step('negative: creating round 2 without a king form is rejected', async () => {
      const res = await request.post(`${baseURL}/api/rounds`, {
        headers: adminHeaders(),
        data: { seasonId, roundNo: 2 }
      })
      expect(res.status()).toBe(422)
      expect((await res.json()).error?.message).toContain('请先为本轮的王选择形态')
    })

    await test.step('round 2 uses the form-only sheet with the king from the order', async () => {
      await page.goto('/matches', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()

      await page.getByRole('button', { name: '+ 创建第 2 轮' }).click()
      await expect(page.getByRole('heading', { name: '第 2 轮 · 王形态' })).toBeVisible()
      // 本轮的王取自一次性王序（UI 投掷产生的第 2 位）
      await expect(page.getByText(`本轮的王：${r2KingName}`)).toBeVisible()

      await page.getByRole('button', { name: /月白/ }).click()
      const formActionPromise = page.waitForResponse(response => response.url().includes('/actions/s6_king_form'))
      await page.getByRole('button', { name: '确认形态' }).click()
      expect((await formActionPromise).ok()).toBeTruthy()

      // 形态提交后自动打开创建轮次面板
      await expect(page.getByRole('heading', { name: '创建下一轮' })).toBeVisible()
      const roundResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/rounds') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '确认', exact: true }).click()
      expect((await roundResponsePromise).ok()).toBeTruthy()
      await expect(page.getByText('第 2 轮已创建')).toBeVisible()
    })

    await test.step('yuebai king games require explicit winner selection (resistance)', async () => {
      // 每场都包含全部 4 名参赛者（含王），直接进第一场
      await page.getByRole('button', { name: '开始' }).first().click()
      await expect(page).toHaveURL(/\/scoring\//)

      // 月白新文案提示条 + 抵抗局胜方选择卡
      await expect(page.getByText(/月白形态：对方先到 15 分后王获得抵抗/)).toBeVisible()
      await expect(page.getByText('月白 · 抵抗')).toBeVisible()
      const inputs = page.getByRole('spinbutton')
      await expect(inputs).toHaveCount(2)

      // 胜方选择按钮（text 即队伍名，A 方在前）
      const choiceButtons = page.locator('button.rule-choice')
      await expect(choiceButtons).toHaveCount(2)
      const teamALabel = (await choiceButtons.nth(0).textContent()).trim()

      // 未选胜方不可结束
      await inputs.nth(0).fill('21')
      await inputs.nth(1).fill('19')
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText('抵抗局需要选择胜方').first()).toBeVisible()
      await expect(page.getByText('确认结束本局？')).toHaveCount(0)

      // 胜方不足 21 分不可结束（选 A 方但 A 只有 20 分）
      await inputs.nth(0).fill('20')
      await inputs.nth(1).fill('22')
      await choiceButtons.nth(0).click()
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText(/抵抗局胜方需至少达到21分/).first()).toBeVisible()
      await expect(page.getByText('确认结束本局？')).toHaveCount(0)

      // 分低者获胜：21:29 选 A 方（保持选中），服务端接受
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
