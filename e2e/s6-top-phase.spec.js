import { test, expect } from '@playwright/test'

/**
 * S6 上篇（1-4 轮）王选流程端到端验证
 * 覆盖：UI 创建 S6 预设赛季 → 第 1 轮强制王选（投骰 / 并列重投 / 选形态黛青）
 * → 创建轮次生成比赛 → 进入含王的比赛记分页，黛青形态下王所在方 2:0 开局（服务端写入）
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

    await test.step('delete created season to keep test data stable', async () => {
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${seasonId}`, { headers: adminHeaders() })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
