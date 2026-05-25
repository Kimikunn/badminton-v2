const { chromium } = require('playwright')

async function screenshot(page, name) {
  await page.screenshot({ path: `/tmp/scoring-${name}.png`, fullPage: false })
  console.log(`  📸 /tmp/scoring-${name}.png`)
}

(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  // 用测试环境 :8090
  const BASE = 'http://localhost:8090'

  console.log('=== 1. 进入比赛列表，找到进行中比赛 ===')
  await page.goto(`${BASE}/matches`, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(1000)

  // 找第一个"进行中"或创建一场比赛
  const inProgress = await page.$('text=进行中')
  if (inProgress) {
    await inProgress.click()
    await page.waitForTimeout(800)
  } else {
    console.log('  无进行中比赛，尝试点击第一场比赛')
    const firstCard = await page.$('.liquid-card')
    if (firstCard) await firstCard.click()
    await page.waitForTimeout(800)
  }

  // 如果当前不在 /scoring/ 路径，尝试找"记分"按钮
  if (!page.url().includes('/scoring/')) {
    const scoreBtn = await page.$('text=记分')
    if (scoreBtn) {
      await scoreBtn.click()
      await page.waitForTimeout(800)
    }
  }

  console.log('  当前URL:', page.url())

  // 如果没进入记分页，截图当前页面后退出
  if (!page.url().includes('/scoring/')) {
    await screenshot(page, 'current-page')
    console.log('  ⚠️ 未能进入记分页，截图保存')
    await browser.close()
    return
  }

  // 等待输入框出现
  await page.waitForSelector('input[type="number"]', { timeout: 5000 })

  console.log('\n=== 2. 输入非法比分: 23:20（应提前结束）===')
  const inputs = await page.$$('input[type="number"]')
  if (inputs.length >= 2) {
    await inputs[0].fill('23')
    await inputs[1].fill('20')
    await page.waitForTimeout(500)
    await screenshot(page, 'invalid-23-20')

    // 检查边框颜色
    const borderColor = await inputs[0].evaluate(el => {
      const parent = el.closest('.rounded-2xl')
      return parent ? getComputedStyle(parent).borderColor : null
    })
    console.log('  边框颜色:', borderColor)

    // 检查提示文字
    const hint = await page.$eval('.text\\[var\\(--color-danger\\)\\]', el => el.textContent).catch(() => null)
    console.log('  提示文字:', hint)
  }

  console.log('\n=== 3. 输入合法比分: 21:19 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('21')
    await inputs[1].fill('19')
    await page.waitForTimeout(500)
    await screenshot(page, 'valid-21-19')

    const borderColor = await inputs[0].evaluate(el => {
      const parent = el.closest('.rounded-2xl')
      return parent ? getComputedStyle(parent).borderColor : null
    })
    console.log('  边框颜色:', borderColor)
  }

  console.log('\n=== 4. 输入 deuce: 22:20 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('22')
    await inputs[1].fill('20')
    await page.waitForTimeout(500)
    await screenshot(page, 'valid-22-20')
  }

  console.log('\n=== 5. 输入未达21分: 18:16 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('18')
    await inputs[1].fill('16')
    await page.waitForTimeout(500)
    await screenshot(page, 'invalid-18-16')
  }

  console.log('\n=== 6. 输入领先不足: 21:20 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('21')
    await inputs[1].fill('20')
    await page.waitForTimeout(500)
    await screenshot(page, 'invalid-21-20')
  }

  console.log('\n=== 7. 输入封顶: 30:29 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('30')
    await inputs[1].fill('29')
    await page.waitForTimeout(500)
    await screenshot(page, 'valid-30-29')
  }

  console.log('\n=== 8. 输入合法封顶: 30:28 ===')
  if (inputs.length >= 2) {
    await inputs[0].fill('30')
    await inputs[1].fill('28')
    await page.waitForTimeout(500)
    await screenshot(page, 'valid-30-28')
  }

  await browser.close()
  console.log('\n✅ 全部截图完成')
})()
