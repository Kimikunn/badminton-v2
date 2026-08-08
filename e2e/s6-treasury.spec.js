import { test, expect } from '@playwright/test'

/**
 * S6 下篇切片三：王之宝库卡片执行端到端验证
 *
 * 脚本化设计（全部骰点经 API 固定，仅 UI 独有的流程走页面；暗选为逐人提交、仅限本人选到的卡）：
 * - 灵魂契合：AB 掷 5/5 → 同点 11（第三阶，后投者 p2 两选）→ p1 爆破、p2 时空裂隙+存储器
 *             CD 掷 2/2（p4 先投、p3 后投）→ 同点 5（第一阶，后投者 p3 两选）→ p3 阻碍+进击、
 *             p4 名刀（随时卡 → p4 成为「没有可启用局前卡」的选手，覆盖空态文案）
 * - PA7 比赛（A=AB vs B=CD）逐局：
 *   G1 p1 暗选爆破（余人不使用，4 人集齐才亮出/可开始）→ B 胜 9:11（爆破 11 分制校验）
 *   G2 p2 暗选时空裂隙 → B 胜 19:21（局中 B 方用名刀）
 *   G3 p3 暗选阻碍 → A 胜 21:18（A 终结 B 两连胜但被阻碍压住 +3）
 *   G4 p2 暗选存储器 → A 胜 21:15（赛后录 4 分 → G5 A 4:0 开局）
 *   G5 p3 暗选进击 → B 胜 19:21（A 的 19 含存储器 4 分开局；进击复制连胜）
 *   回溯：时空裂隙回溯 1 局 → G5 重回进行中（保留 19:21，进击暗选继承）→ 重打同分
 *   G6 B 胜 16:21；G7 B 胜 19:21 → CD 5-2 获胜
 * - 星尘手工核算（client/src/rules/s6.js applyTreasurySettlement 口径）：
 *   修正序列 [b,b,a(阻碍 noBreaker),a,b,b(进击 dup),b,b]
 *   AB(a)：小分 2×2=4，连胜 G3-4 len2=+1，G3 终结被阻碍压住、无其他终结 → ✦5
 *          （未修正口径为 4+1+3=8，阻碍效果可见）
 *   CD(b)：小分 5×2=10，连胜 G1-2=+1、G5(dup)-G7 len4=+4，G5 终结 A 两连胜 +3 → ✦18
 *          （未修正口径为 10+1+2+3=16，进击复制使 len3→len4 多 +2）
 *
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 npx playwright test e2e/s6-treasury.spec.js --project=light
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

async function postAction(request, baseURL, seasonId, actionId, payload, expectOk = true) {
  const res = await request.post(`${baseURL}/api/seasons/${seasonId}/actions/${actionId}`, {
    headers: adminHeaders(),
    data: payload
  })
  if (expectOk) expect(res.ok()).toBeTruthy()
  return res
}

// /api/seasons 已改 NetworkFirst（client/vite.config.js api-matchdata 组），
// 页面加载与 endGame 后的 seasonsStore.init({force:true}) 均返回最新数据，
// 此前的 SWR 缓存绕行（goto 后 reload / 双重 reload）已移除。

test.describe('S6 treasury (王之宝库)', () => {
  test('card activations, storage carry, rift and settlement adjustments', async ({ page, request, baseURL }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE, 'season creation is not expected in this environment')
    test.setTimeout(180000)

    const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
    if (adminToken) {
      await page.addInitScript((token) => {
        window.localStorage.setItem('badclub:adminToken', token)
      }, adminToken)
    }

    let seasonId = ''
    let matchId = ''
    let players = []
    const playerName = (id) => players.find(p => p.id === id)?.name || id
    // 第 5 轮 PA7 对阵固定为 teamA=[A,B] teamB=[C,D]（种子=选手 ID 排序），
    // 暗选条目按 teamA → teamB 顺序渲染，已提交者按钮消失，故永远点第一个「录入暗选」
    const matchPlayerOrder = () => [...players.map(p => p.id)].sort()

    // 逐人提交一局暗选：cardByPlayer 为该局的用卡分配（缺省选手提交「不使用」），
    // 仅限本人选到的卡（服务端 422 校验归属）
    async function submitSecrets(gameNo, cardByPlayer = {}) {
      await expect(page.getByText(`G${gameNo} 局前暗选`)).toBeVisible()
      for (const pid of matchPlayerOrder()) {
        const cardName = cardByPlayer[pid] || null
        await page.getByRole('button', { name: '录入暗选' }).first().click()
        await expect(page.getByRole('heading', { name: `G${gameNo} 暗选 · ${playerName(pid)}` })).toBeVisible()
        const activatePromise = page.waitForResponse(response => response.url().includes('/actions/s6_card_activate'))
        await page.getByRole('button', { name: cardName ? new RegExp(`^${cardName}`) : /^不使用/ }).click()
        expect((await activatePromise).ok()).toBeTruthy()
        // Sheet 关闭有 leave 动画，期间选项按钮仍在 DOM，等其移除再点下一位
        await expect(page.getByRole('heading', { name: /暗选 ·/ })).toHaveCount(0)
      }
      await expect(page.getByText('已亮出')).toBeVisible()
    }

    // 结束当前局（填分 → 结束本局 → 确认）。
    // 暗选卡标题 = 当前局 + 1，所以结束 Gk 后卡片变为「G(k+2) 局前暗选」，
    // nextSecretGameNo 传 k+2；G6 结束后无卡片（无第 8 局）传 null。
    async function endCurrentGame(scoreA, scoreB, nextSecretGameNo) {
      const inputs = page.getByRole('spinbutton')
      await inputs.nth(0).fill(String(scoreA))
      await inputs.nth(1).fill(String(scoreB))
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText('确认结束本局？')).toBeVisible()
      const endPromise = page.waitForResponse(response =>
        response.url().includes('/end') && response.request().method() === 'POST'
      )
      await page.getByRole('button', { name: '确认', exact: true }).click()
      expect((await endPromise).ok()).toBeTruthy()
      if (nextSecretGameNo) {
        await expect(page.getByText(`G${nextSecretGameNo} 局前暗选`)).toBeVisible()
      }
    }

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
    })

    await test.step('fast-forward top phase rounds 1-4 via API', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      for (let roundNo = 1; roundNo <= 4; roundNo++) {
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
        const matches = (await roundRes.json()).data?.matches || []
        expect(matches).toHaveLength(3)

        for (const match of matches) {
          const startRes = await request.post(`${baseURL}/api/matches/${match.id}/start`, { headers: adminHeaders() })
          expect(startRes.ok()).toBeTruthy()
          for (const score of [{ scoreA: 21, scoreB: 10 }, { scoreA: 21, scoreB: 10 }]) {
            const gamesRes = await request.get(`${baseURL}/api/matches/${match.id}/games`)
            const current = ((await gamesRes.json()).data || []).find(g => g.status === 'in_progress')
            expect(current).toBeTruthy()
            await request.put(`${baseURL}/api/games/${current.id}/score`, { headers: adminHeaders(), data: score })
            const endRes = await request.post(`${baseURL}/api/games/${current.id}/end`, { headers: adminHeaders(), data: {} })
            expect(endRes.ok()).toBeTruthy()
          }
        }
      }
    })

    await test.step('rig soul bonds and picks via API, then create round 5', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      // AB：5/5 同点 → 总点数 11 解锁第三阶，后投者（B 位）两选
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 5, comboLabel: 'AB', playerId: a, rollChoice: 1, dice: [5] })
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 5, comboLabel: 'AB', playerId: b, rollChoice: 1, dice: [5] })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'AB', playerId: a, cardId: 'blast' })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'AB', playerId: b, cardId: 'rift' })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'AB', playerId: b, cardId: 'storage' })

      // CD：2/2 同点 → 总点数 5 解锁第一阶；D 先投、C 后投 → 后投者 C 位两选
      // （D 位只选随时卡名刀 → 成为「没有可启用局前卡」的选手，覆盖空态文案）
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 5, comboLabel: 'CD', playerId: d, rollChoice: 1, dice: [2] })
      await postAction(request, baseURL, seasonId, 's6_soul_roll', { roundNo: 5, comboLabel: 'CD', playerId: c, rollChoice: 1, dice: [2] })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'CD', playerId: c, cardId: 'block' })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'CD', playerId: c, cardId: 'charge' })
      await postAction(request, baseURL, seasonId, 's6_soul_pick', { roundNo: 5, comboLabel: 'CD', playerId: d, cardId: 'blade' })

      const roundRes = await request.post(`${baseURL}/api/rounds`, {
        headers: adminHeaders(),
        data: { seasonId, roundNo: 5 }
      })
      expect(roundRes.status()).toBe(201)
      const matches = (await roundRes.json()).data?.matches || []
      expect(matches).toHaveLength(1)
      expect(matches[0].matchFormat).toBe('pa7')
      matchId = matches[0].id
    })

    await test.step('negative: rift without any activation is rejected', async () => {
      const res = await postAction(request, baseURL, seasonId, 's6_rift', { matchId, games: 1 }, false)
      expect(res.status()).toBe(422)
    })

    await test.step('negative: activating a card owned by another player is rejected', async () => {
      // 存储器是 B 位选手选到的卡，A 位选手暗选它 → 422 该选手未获得此卡
      const [a, b] = [...players.map(p => p.id)].sort()
      const res = await postAction(request, baseURL, seasonId, 's6_card_activate', {
        matchId, gameNo: 1, playerId: a, cardId: 'storage'
      }, false)
      expect(res.status()).toBe(422)
      expect((await res.json()).error?.message).toContain('该选手未获得此卡')
    })

    await test.step('G1 per-player secret picks gate match start, then blast game validates 11-point target', async () => {
      const [a, b, c, d] = [...players.map(p => p.id)].sort()

      await page.goto('/matches', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()
      await page.getByRole('button', { name: '开始' }).click()
      await expect(page).toHaveURL(/\/scoring\//)

      // S6 组合赛不自动开局：G1 四人暗选集齐前开始按钮不可用
      const startButton = page.getByRole('button', { name: '请先完成 G1 四人暗选' })
      await expect(startButton).toBeDisabled()

      // p1（A 位）提交爆破：Sheet 只列出本人选到的卡（看不到 B 位的时空裂隙）
      await page.getByRole('button', { name: '录入暗选' }).first().click()
      await expect(page.getByRole('heading', { name: `G1 暗选 · ${playerName(a)}` })).toBeVisible()
      await expect(page.getByRole('button', { name: /^爆破/ })).toBeEnabled()
      await expect(page.getByRole('button', { name: /^时空裂隙/ })).toHaveCount(0)
      let activatePromise = page.waitForResponse(response => response.url().includes('/actions/s6_card_activate'))
      await page.getByRole('button', { name: /^爆破/ }).click()
      expect((await activatePromise).ok()).toBeTruthy()
      // Sheet 关闭有 leave 动画，等其移除后再断言页面文本
      await expect(page.getByRole('heading', { name: /暗选 ·/ })).toHaveCount(0)
      // 亮出前只显示该选手的「已暗选」徽标，不暴露卡名
      await expect(page.getByText('已暗选', { exact: true })).toHaveCount(1)
      await expect(page.getByText('爆破', { exact: true })).toHaveCount(0)
      await expect(startButton).toBeDisabled()

      // p2 提交「不使用」（其 Sheet 列出时空裂隙/存储器）
      await page.getByRole('button', { name: '录入暗选' }).first().click()
      await expect(page.getByRole('heading', { name: `G1 暗选 · ${playerName(b)}` })).toBeVisible()
      await expect(page.getByRole('button', { name: /^时空裂隙/ })).toBeEnabled()
      activatePromise = page.waitForResponse(response => response.url().includes('/actions/s6_card_activate'))
      await page.getByRole('button', { name: /^不使用/ }).click()
      expect((await activatePromise).ok()).toBeTruthy()
      await expect(page.getByRole('heading', { name: /暗选 ·/ })).toHaveCount(0)
      await expect(page.getByText('已暗选', { exact: true })).toHaveCount(2)
      await expect(page.getByText('已亮出')).toHaveCount(0)

      // p3 提交「不使用」
      await page.getByRole('button', { name: '录入暗选' }).first().click()
      await expect(page.getByRole('heading', { name: `G1 暗选 · ${playerName(c)}` })).toBeVisible()
      activatePromise = page.waitForResponse(response => response.url().includes('/actions/s6_card_activate'))
      await page.getByRole('button', { name: /^不使用/ }).click()
      expect((await activatePromise).ok()).toBeTruthy()
      await expect(page.getByRole('heading', { name: /暗选 ·/ })).toHaveCount(0)

      // p4 只选了随时卡 → 空态文案，仍可提交「不使用」；第 4 人提交后全部亮出
      await page.getByRole('button', { name: '录入暗选' }).first().click()
      await expect(page.getByRole('heading', { name: `G1 暗选 · ${playerName(d)}` })).toBeVisible()
      await expect(page.getByText(/该选手没有可启用的局前卡/)).toBeVisible()
      activatePromise = page.waitForResponse(response => response.url().includes('/actions/s6_card_activate'))
      await page.getByRole('button', { name: /^不使用/ }).click()
      expect((await activatePromise).ok()).toBeTruthy()
      await expect(page.getByRole('heading', { name: /暗选 ·/ })).toHaveCount(0)
      await expect(page.getByText('已亮出')).toBeVisible()
      await expect(page.getByText('爆破', { exact: true })).toBeVisible()
      // 集齐后按钮文案切换为「开始比赛」并可用
      await expect(page.getByRole('button', { name: '开始比赛' })).toBeEnabled()

      // 开始比赛 → G1 进行中，爆破提示条出现
      const startPromise = page.waitForResponse(response => response.url().includes('/start') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '开始比赛' }).click()
      expect((await startPromise).ok()).toBeTruthy()
      await expect(page.getByText('爆破：每球得 2 分，先到 11 分结束（封顶 12）')).toBeVisible()

      // 已开始的局不允许暗选（API 负面）
      const lateActivate = await postAction(request, baseURL, seasonId, 's6_card_activate', {
        matchId, gameNo: 1, playerId: a, cardId: null
      }, false)
      expect(lateActivate.status()).toBe(422)

      // G2 暗选（须在 G1 进行中提交）：p2 时空裂隙，其余三人不使用
      await submitSecrets(2, { [b]: '时空裂隙' })

      // 爆破局校验：10:9 不可结束，9:11 可结束
      const inputs = page.getByRole('spinbutton')
      await inputs.nth(0).fill('10')
      await inputs.nth(1).fill('9')
      await page.getByRole('button', { name: '结束本局' }).click()
      await expect(page.getByText('爆破局需先达到11分').first()).toBeVisible()
      await expect(page.getByText('确认结束本局？')).toHaveCount(0)

      await endCurrentGame(9, 11, 3)
    })

    await test.step('G2 blade anytime card, then B wins', async () => {
      // G3 暗选：p3 阻碍，其余三人不使用
      const [, , c] = [...players.map(p => p.id)].sort()
      await submitSecrets(3, { [c]: '阻碍' })

      // 随时卡：B 方使用名刀 → 提示条 + 库存扣减（3 → 2）
      await page.getByRole('button', { name: /^名刀 ×3/ }).click()
      await page.getByRole('button', { name: '使用', exact: true }).click()
      await expect(page.getByText('名刀已启用：下一球对方得分无效')).toBeVisible()
      await expect(page.getByRole('button', { name: /^名刀 ×2/ })).toBeVisible()

      await endCurrentGame(19, 21, 4)
    })

    await test.step('G3 block banner, A wins (breaker suppressed)', async () => {
      await expect(page.getByText(/阻碍：.*启用，对方本局获胜无法获得终结分/)).toBeVisible()

      // G4 暗选：p2 存储器，其余三人不使用
      const [, b] = [...players.map(p => p.id)].sort()
      await submitSecrets(4, { [b]: '存储器' })

      await endCurrentGame(21, 18, 5)
    })

    await test.step('G4 storage game, A wins, then record 4 extra-ball points', async () => {
      await expect(page.getByText(/存储器：.*本局结束后录入额外球得分/)).toBeVisible()

      // G5 暗选：p3 进击，其余三人不使用
      const [, , c] = [...players.map(p => p.id)].sort()
      await submitSecrets(5, { [c]: '进击' })

      await endCurrentGame(21, 15, 6)

      // 负面：胜方额外球得分超过 5 → 422
      const overLimit = await postAction(request, baseURL, seasonId, 's6_storage_record', {
        matchId, gameNo: 4, side: 'a', points: 6
      }, false)
      expect(overLimit.status()).toBe(422)

      // 存储器面板：录入 4 分
      await expect(page.getByText('存储器 · G4')).toBeVisible()
      await page.getByRole('button', { name: '4', exact: true }).click()
      const recordPromise = page.waitForResponse(response => response.url().includes('/actions/s6_storage_record'))
      await page.getByRole('button', { name: '记录得分' }).click()
      expect((await recordPromise).ok()).toBeTruthy()
      await expect(page.getByText('存储器得分已记录')).toBeVisible()
    })

    await test.step('G5 opens 4:0 from storage carry, charge game to B', async () => {
      // G5 已自动进入进行中且服务端直写开局分到局行；reload 一次刷新 games store 后核对记分框
      // （recordAction 只 upsert 赛季数据，不刷新 matches/games，与 SW 缓存无关）
      await page.reload({ waitUntil: 'networkidle' })
      const inputs = page.getByRole('spinbutton')
      await expect(inputs.nth(0)).toHaveValue('4')
      await expect(inputs.nth(1)).toHaveValue('0')

      await expect(page.getByText(/进击：.*本局获胜额外获得一次连胜计数/)).toBeVisible()

      // G6 暗选：双方不使用
      await submitSecrets(6)

      // B 胜：A 的 19 分含存储器 4 分开局
      await endCurrentGame(19, 21, 7)
    })

    await test.step('rift rewinds G5 and the replayed game inherits its activation', async () => {
      await expect(page.getByText('2:3', { exact: true })).toBeVisible()

      // 时空裂隙面板代替普通撤回
      await page.getByRole('button', { name: '回溯 1 局' }).click()
      const riftPromise = page.waitForResponse(response => response.url().includes('/actions/s6_rift'))
      await page.getByRole('button', { name: '回溯', exact: true }).click()
      expect((await riftPromise).ok()).toBeTruthy()
      await expect(page.getByText('已回溯 1 局')).toBeVisible()

      // G5 回到进行中：大分回落、比分保留、进击暗选继承（提示条仍在）
      await expect(page.getByText('2:2', { exact: true })).toBeVisible()
      const inputs = page.getByRole('spinbutton')
      await expect(inputs.nth(0)).toHaveValue('19')
      await expect(inputs.nth(1)).toHaveValue('21')
      await expect(page.getByText(/进击：.*本局获胜额外获得一次连胜计数/)).toBeVisible()

      // 负面：裂隙已消耗 → 422
      const consumed = await postAction(request, baseURL, seasonId, 's6_rift', { matchId, games: 1 }, false)
      expect(consumed.status()).toBe(422)

      // 重打 G5，同分结束
      await endCurrentGame(19, 21, 7)
    })

    await test.step('finish G6 and G7, CD wins the match 5-2', async () => {
      // G7 暗选：双方不使用
      await submitSecrets(7)
      await endCurrentGame(16, 21, null)

      // G7 之后无暗选卡（无第 8 局）
      await expect(page.getByText(/局前暗选/)).toHaveCount(0)
      await endCurrentGame(19, 21, null)

      await expect(page.getByText(`${playerName(players.map(p => p.id).sort()[2])} ${playerName(players.map(p => p.id).sort()[3])} 获胜`)).toBeVisible()
    })

    await test.step('rankings show adjusted stars, treasury counts and activation chips', async () => {
      await page.goto('/rankings', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /S6-王权之争/ }).click()

      // 组合星尘榜（修正后）：AB ✦5（阻碍压住终结）、CD ✦18（进击复制连胜）
      await expect(page.getByRole('heading', { name: '组合星尘' })).toBeVisible()
      await expect(page.getByText('✦5')).toBeVisible()
      await expect(page.getByText('✦18')).toBeVisible()
      await expect(page.getByText(/小分 4 · 连胜 \+1 · 阻碍·终结无效/)).toBeVisible()
      await expect(page.getByText(/小分 10 · 连胜 \+5 · 终结 \+3 · 进击·连胜\+1/)).toBeVisible()

      // 王之宝库：库存即剩余次数（服务端提交即扣减）
      await expect(page.getByRole('heading', { name: '王之宝库' })).toBeVisible()
      await expect(page.getByText('爆破 ×1')).toBeVisible()
      await expect(page.getByText('时空裂隙 ×0')).toBeVisible()
      await expect(page.getByText('存储器 ×1')).toBeVisible()
      await expect(page.getByText('名刀 ×2')).toBeVisible()

      // 激活记录 chips（逐人带选手名，如「G5 王铮昊·进击」）；
      // 面板每组合仅展示最近 6 条（slice(-6)），G1-G4 的卡片记录已滚出列表
      const [a, b, c] = [...players.map(p => p.id)].sort()
      await expect(page.getByText(`G5 ${playerName(c)}·进击`)).toBeVisible()
      await expect(page.getByText('已亮出').first()).toBeVisible()

      // 已消耗/已使用状态经 API 校验（面板滚动窗口外的记录）
      const seasonRes = await request.get(`${baseURL}/api/seasons/${seasonId}`)
      const treasury = (await seasonRes.json()).data?.comebackData?.s6?.treasury || {}
      const abActs = treasury.AB?.activations || []
      const cdActs = treasury.CD?.activations || []
      expect(abActs.find(e => e.cardId === 'rift')?.consumed).toBe(true)
      expect(abActs.find(e => e.cardId === 'storage')?.consumed).toBe(true)
      expect(abActs.find(e => e.cardId === 'blast')?.playerId).toBe(a)
      expect(abActs.find(e => e.cardId === 'storage')?.playerId).toBe(b)
      const bladeUse = cdActs.find(e => e.cardId === 'blade' && e.timing === 'anytime')
      expect(bladeUse?.consumed).toBe(true)
    })

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
