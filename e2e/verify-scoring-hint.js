const { chromium } = require('playwright')

(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  await page.goto('http://localhost:8090/matches', { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(1000)

  // 找记分按钮或进行中卡片
  const scoreBtn = await page.$('text=记分')
  if (scoreBtn) await scoreBtn.click()
  else {
    const card = await page.$('.liquid-card')
    if (card) await card.click()
  }
  await page.waitForTimeout(1000)

  if (!page.url().includes('/scoring/')) {
    console.log('未进入记分页, URL:', page.url())
    await browser.close()
    return
  }

  const inputs = await page.$$('input[type="number"]')
  if (inputs.length < 2) {
    console.log('未找到输入框')
    await browser.close()
    return
  }

  // 输入非法比分 23:20
  await inputs[0].fill('23')
  await inputs[1].fill('20')
  await page.waitForTimeout(600)

  // 获取页面中所有 <p> 标签的文本
  const allTexts = await page.$$eval('p', els => els.map(e => e.textContent.trim()).filter(Boolean))
  console.log('页面中所有 <p> 文本:')
  allTexts.forEach(t => console.log('  -', t.substring(0, 60)))

  // 专门找验证提示
  const hintEl = await page.$('p.min-h-\\[1\\.25rem\\]')
  if (hintEl) {
    const text = await hintEl.textContent()
    const color = await hintEl.evaluate(el => getComputedStyle(el).color)
    console.log('\n验证提示:', text)
    console.log('提示颜色:', color)
  } else {
    console.log('\n未找到验证提示元素 (p.min-h-[1.25rem])')
  }

  // 检查边框
  const borderColor = await inputs[0].evaluate(el => {
    const p = el.closest('[class*="rounded-2xl"]')
    return p ? getComputedStyle(p).borderColor : null
  })
  console.log('输入框边框:', borderColor)

  await browser.close()
})()
