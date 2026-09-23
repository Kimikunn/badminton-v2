# Implement — 订场日历换用 Vant Calendar

> 顺序执行；每步验证命令必须跑。文件路径相对仓库根。
> **执行状态：Step 1–7 完成（2026-09-23）。**

## Step 1 — 依赖 ✅

- [x] `cd client && npm install vant` → `package.json`/`package-lock.json` 增加 `vant@^4.10.2`
- [x] 验证：`npm ls vant` 4.10.2；`npm run build` 通过

## Step 2 — 摘要逻辑下沉 ✅

- [x] `client/src/utils/holiday.js` 新增 `monthHolidaySummary(year, month)`（休在前班在后、连续同节日合并）；独立脚本与旧内联算法 2004–2027 全 288 个月等价比对 **0 mismatch**

## Step 3 — BookingCalendar.vue 重写（Vant 包装）✅

- [x] Vant 配置、formatter（disabled/className + meta 透传）、三个插槽（`#text` data-date、`#top-info` 休班/X、`#bottom-info` 胶囊/圆点）、onSelect 守卫 + `reset(null)`、IntersectionObserver 跟踪可见月
- [x] 图例行 + `.holiday-summary`（调 `monthHolidaySummary(currentMonth)`）
- [x] 主题变量映射（light/dark）、`.day-unavail/.day-past/.day-today`、胶囊、X 样式
- [x] **check 后修复**：`:show-mark="false"`（Vant 的 showMark 是月份背景水印，深色下压住日期对比度 1.43:1）；`.day-x` opacity 0.55→0.7（过 L 差≥0.3）；`.holiday-mark` 限宽居中（消除与条数角标的盒重叠误报）

## Step 4 — 删除 DayCell.vue ✅

- [x] `git rm client/src/components/venue/DayCell.vue`
- [x] grep 无 DayCell/day-block/day-num-fixed/holiday-mark 残留（HolidayBadge 类名除外）

## Step 5 — e2e 重写 ✅

- [x] `e2e/holidays.spec.js`：T1（10-01：休/班/摘要/DaySheet）、T1b（补班日 DaySheet）、T2（09-22：中秋标记 + 不可用日 + 胶囊几何）、T3（滚到 11 月无标记）、T4（滚到 2027-01 无标记）
- [x] 验证：**20 passed**（5 用例 × 4 project）

## Step 6 — 部署测试环境 + 全量验证 ✅

- [x] `npm run build:test` + `docker compose -p badmintontest ... build/up`
- [x] `PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test` → **64 passed / 24 skipped / 0 failed**
- [x] 几何审计（8 配置）：0 越界、0 截断、0 溢出、0 报错；最挤格（10-01「休+2+1+等待」、09-25「休+25+已暂停」）DOM rect 与 3× 像素带验证分离
- [x] 对比度抽查：今天 accent 4.98:1、胶囊 3.49:1、X 修复后 L 差 0.576

## Step 7 — 清理与收口 ✅

- [x] 临时验证脚本（.tmp-*）全部删除；console.log 干净；`git status` 只含本任务文件 + 既有 token 任务改动；`server/runtime/` mtime 未变

## 与 design.md 的偏差（均已评估接受）

1. `show-title=false` + 固定 478px 高度：一月一屏、滚动换月；月份区块标题保留（无重复感）；check 评估「合理」。
2. `default-date=null` + select 后 `reset(null)`：本日历是「打开面板」不是「选日期」，无残留选中态、同日可重复点开（比 design 的 allow-same-day 更干净）。
3. `min-date`=本月 1 号、`max-date`=+6 月末：7 个月窗口（订场窗口 4 天，足够）；当月过去日渲染为 `.day-past` 而非 Vant disabled。
4. 今天标记 = accent 色环（`.day-today .day-number`），不用 Vant 的 mark（那是月份水印）。
5. 不可用日点击行为：旧自研代码不上抛，新版按 PRD AC2 上抛打开 DaySheet（有意变更，用户已见效果）。

## Rollback points

- Step 1 后：`git checkout -- client/package.json client/package-lock.json`
- Step 3 后：`git checkout -- client/src/components/venue/BookingCalendar.vue client/src/utils/holiday.js`
- Step 4 后：`git checkout a8230af -- client/src/components/venue/DayCell.vue`
- 全部为前端替换，无数据迁移；回滚即还原
