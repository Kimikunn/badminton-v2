import { test, expect } from '@playwright/test'

test.describe('Season management', () => {
  test('shows season creation button when the feature flag is enabled', async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE, 'season creation is not expected in this environment')

    await page.goto('/matches', { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: '+ 创建赛季' }).click()

    await expect(page.getByText('创建预设赛季')).toBeVisible()
    await expect(page.getByRole('button', { name: /S1 · 标准赛季/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /S5 · 异变秩序/ })).toBeVisible()
  })

  test('hides season creation button when the feature flag is disabled', async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_EXPECT_SEASON_CREATE_HIDDEN, 'season creation hidden-state check is not expected in this environment')

    await page.goto('/matches', { waitUntil: 'networkidle' })

    await expect(page.getByRole('button', { name: '+ 创建赛季' })).toHaveCount(0)
    await expect(page.getByText('创建预设赛季')).toHaveCount(0)
  })

  test('keeps flask tools reset-only and creates preset season from match hub in test environment', async ({ page, request, baseURL }) => {
    test.skip(!process.env.PLAYWRIGHT_ENABLE_SEASON_MANAGEMENT_WRITE, 'season creation write test only runs against the isolated test environment')

    const adminToken = process.env.PLAYWRIGHT_ADMIN_TOKEN || ''
    if (adminToken) {
      await page.addInitScript((token) => {
        window.localStorage.setItem('badclub:adminToken', token)
      }, adminToken)
    }

    let createdSeasonId = ''

    await test.step('flask panel is reset-only', async () => {
      await page.goto('/', { waitUntil: 'networkidle' })
      await page.getByTitle('测试工具').click()

      await expect(page.getByText('恢复生产数据').first()).toBeVisible()
      await expect(page.getByText('创建预设赛季')).toHaveCount(0)
    })

    await test.step('open season creation from match hub', async () => {
      await page.goto('/matches', { waitUntil: 'networkidle' })

      await page.getByRole('button', { name: '+ 创建赛季' }).click()

      await expect(page.getByText('创建预设赛季')).toBeVisible()
      await page.getByRole('button', { name: /S1 · 标准赛季/ }).click()

      await expect(page.getByText('确认创建赛季')).toBeVisible()
      await expect(page.getByText('参赛成员（固定 4 人）')).toBeVisible()
      await expect(page.getByText('三局两胜')).toBeVisible()
      await expect(page.getByText('7 轮', { exact: true })).toBeVisible()
    })

    await test.step('create season through the business UI and clean it up through the API', async () => {
      const createResponsePromise = page.waitForResponse(response =>
        response.url().includes('/api/seasons') && response.request().method() === 'POST'
      )

      await page.getByRole('button', { name: '确认创建' }).click()
      const createResponse = await createResponsePromise
      expect(createResponse.ok()).toBeTruthy()

      const payload = await createResponse.json()
      createdSeasonId = payload.data?.id
      expect(createdSeasonId).toBeTruthy()
      expect(payload.data?.participants).toHaveLength(4)
      expect(payload.data?.ruleId).toBe('standard')

      await expect(page).toHaveURL(/\/matches$/)
      await expect(page.getByText(/已创建：/)).toBeVisible()
    })

    await test.step('delete created season to keep test data stable', async () => {
      const headers = adminToken ? { 'x-admin-token': adminToken } : {}
      const deleteResponse = await request.delete(`${baseURL}/api/seasons/${createdSeasonId}`, { headers })
      expect(deleteResponse.ok()).toBeTruthy()
    })
  })
})
