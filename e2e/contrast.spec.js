import { test, expect } from '@playwright/test'

/**
 * Contrast check — verifies text readability in both light and dark modes
 * Run: npx playwright test e2e/contrast.spec.js
 *
 * Flags elements where text lightness is within 0.3 of background lightness
 */

test.describe('Contrast checks', () => {
  test('no low-contrast text in season rankings', async ({ page }, testInfo) => {
    const mode = testInfo.project.name
    let issues = 0

    await page.goto('/rankings')
    await page.waitForTimeout(3000)

    // Click through each season tab
    const tabs = page.locator('.tab, .tabs button')
    const tabCount = await tabs.count()

    for (let t = 0; t < tabCount; t++) {
      await tabs.nth(t).click()
      await page.waitForTimeout(1000)

      const seasonLabel = (await tabs.nth(t).textContent())?.trim()

      // Check all text elements inside ranking panels
      const names = page.locator('.name, .rank-name, .winner-name, .combo-player, .seed-name, .detail, .buff-desc')
      const count = await names.count()

      for (let i = 0; i < count; i++) {
        const el = names.nth(i)
        if (!(await el.isVisible())) continue

        const data = await el.evaluate(e => {
          const color = getComputedStyle(e).color
          let cur = e
          let bg = null
          while (cur && cur !== document.documentElement) {
            const bgc = getComputedStyle(cur).backgroundColor
            if (bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') { bg = bgc; break }
            cur = cur.parentElement
          }
          if (!bg) bg = getComputedStyle(document.documentElement).backgroundColor
          return { color, bg, text: e.textContent?.trim()?.substring(0, 15) }
        })

        const cL = extractLightness(data.color)
        const bL = extractLightness(data.bg)
        if (cL !== null && bL !== null) {
          const diff = Math.abs(cL - bL)
          if (diff < 0.3) {
            console.log(`❌ [${mode}] S${t} "${data.text}" L_diff=${diff.toFixed(2)} color=${data.color} bg=${data.bg}`)
            issues++
          }
        }
      }
    }

    expect(issues, `Found ${issues} low-contrast elements in ${mode} mode`).toBe(0)
  })
})

function extractLightness(str) {
  const oklch = str.match(/oklch\(\s*([\d.]+)/)
  if (oklch) return parseFloat(oklch[1])
  const rgb = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) {
    const r = parseInt(rgb[1]) / 255, g = parseInt(rgb[2]) / 255, b = parseInt(rgb[3]) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  return null
}
