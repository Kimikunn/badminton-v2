const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  
  // Test production
  console.log("=== 打开生产环境 :8089 ===");
  await page.goto('http://localhost:8089/', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  // Check if liquid glass classes are in the DOM
  const hasLiquidHeader = await page.$('.liquid-header');
  const hasLiquidTabbar = await page.$('.liquid-tabbar');
  const hasLiquidCard = await page.$$('.liquid-card');
  
  console.log("liquid-header 存在:", !!hasLiquidHeader);
  console.log("liquid-tabbar 存在:", !!hasLiquidTabbar);
  console.log("liquid-card 数量:", hasLiquidCard.length);
  
  // Check if backup button is gone
  const backupLink = await page.$('a[title*="备份"]');
  console.log("备份按钮存在:", !!backupLink);
  
  // Check tab bar styles
  if (hasLiquidTabbar) {
    const styles = await hasLiquidTabbar.evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.background.substring(0, 80), filter: s.backdropFilter, radius: s.borderRadius };
    });
    console.log("TabBar bg:", styles.bg);
    console.log("TabBar filter:", styles.filter);
    console.log("TabBar radius:", styles.radius);
  }
  
  await page.screenshot({ path: '/tmp/ios26-home-prod.png', fullPage: false });
  console.log("截图: /tmp/ios26-home-prod.png");
  
  // Test the match page too
  await page.goto('http://localhost:8089/matches', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  const hasTabBarMatch = await page.$('.liquid-tabbar');
  console.log("matches页 liquid-tabbar:", !!hasTabBarMatch);
  
  await page.screenshot({ path: '/tmp/ios26-matches-prod.png', fullPage: false });
  console.log("截图: /tmp/ios26-matches-prod.png");
  
  await browser.close();
  console.log("\n✅ 完成");
})();
