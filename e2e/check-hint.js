const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  await page.goto('http://localhost:8090/matches', { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(1000)

  const scoreBtn = await page.$('text=记分')
  if (scoreBtn) await scoreBtn.click()
  else {
    const card = await page.$('.liquid-card')
    if (card) await card.click()
  }
  await page.waitForTimeout(1000)

  if (!page.url().includes('/scoring/')) {
    console.log('未进入记分页:', page.url())
    await browser.close()
    return
  }

  const inputs = await page.$$('input[type="number"]')
  if (inputs.length < 2) {
    console.log('未找到输入框')
    await browser.close()
    return
  }

  await inputs[0].fill('23')
  await inputs[1].fill('20')
  await page.waitForTimeout(600)

  const allP = await page.$$eval('p', els => els.map(e => e.textContent.trim()).filter(Boolean))
  console.log('页面 <p> 文本:')
  allP.forEach(t => console.log(' ', t.substring(0, 55)))

  const hint = await page.$('p.min-h\\[1\\.25rem\\]')
  console.log('提示元素存在:', !!hint)

  if (hint) {
    console.log('提示内容:', await hint.textContent())
    console.log('提示颜色:', await hint.evaluate(el => getComputedStyle(el).color))
  }

  await page.screenshot({ path: '/tmp/scoring-hint-check.png', fullPage: false })
  console.log('截图: /tmp/scoring-hint-check.png')

  await browser.close()
})()
