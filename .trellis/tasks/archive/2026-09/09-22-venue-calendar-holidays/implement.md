# Implement — 订场日历节假日显示

> 顺序执行；每步的验证命令必须跑。文件路径相对仓库根。
> **执行状态：Step 1–6 完成（2026-09-22）；Step 7 生产部署未做（待确认）。**

## Step 1 — 依赖 ✅

- [x] `cd client && npm install chinese-days` → `package.json`（`dependencies` 增加 `"chinese-days": "^1.5.9"`）与 `package-lock.json` 同步更新
- [x] 验证：`npm ls chinese-days` 输出 1.5.9；`npm run build` 通过

## Step 2 — 工具模块 ✅

- [x] 新建 `client/src/utils/holiday.js`：`holidayFor(dateKey)` → `null | { name, type: 'holiday'|'workday' }`
  - 规则：`getDayDetail(dateKey).name.includes(',')` 才命中；`split(',')[1]` 取中文名；`detail.work ? 'workday' : 'holiday'`
  - JSDoc 写清语义、判定依据与超范围行为

## Step 3 — 日历格子（`client/src/components/venue/BookingCalendar.vue`）✅

- [x] import `holidayFor`；`days` computed 增加 `holiday: holidayFor(key)`
- [x] `data-date` 属性；节日 tag（`休/班` + 名字，休=`text-danger`、班=`text-fg-muted`）；`.holiday-tag` 样式
- [x] **偏差（check 后修复）**：节日 + 监控条数角标同格时，给日期数字加 `order-first` 让 tag 落到角标下沿之下（原实现只隐藏圆点，实测 tag 与角标重叠 ~9×9px）
- [x] **偏差（check 后修复）**：隐藏圆点的条件加 `&& !cell.isPast`——过去日不渲染 pill/角标，圆点必须保留

## Step 4 — 单日面板（`client/src/components/venue/DaySheet.vue`）✅

- [x] `const holiday = computed(() => holidayFor(props.date))`
- [x] 内容区顶部节日行：`.holiday-chip` + 节日名 + 「法定假日 / 调休补班」
- [x] **偏差（check 后修复）**：说明文字 `text-fg-muted` → `text-fg-secondary`（淡红底实测 2.2:1，低于项目对比度规则；修复后 5.45–6.87:1）
- [x] chip 加 `.holiday-chip` 类，作为 e2e 稳定定位锚点

## Step 5 — e2e ✅

- [x] `e2e/holidays.spec.js`：4 用例（国庆 休 / 补班 班 / 普通日无标记 / 超范围无标记 + DaySheet 两种）
  - 固定时钟 `page.clock.install({ time: 2026-10-01T12:00:00+08:00 })`，clock 方案稳定无需退化
  - 断言已收紧到 `.holiday-tag` / `.holiday-chip` 内部（原 `toContainText('休')` 会被「调休补班」自身命中）
- [x] 验证：`PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test e2e/holidays.spec.js` → **16 passed**

## Step 6 — 全量验证 + 视觉门禁（AC4）✅

- [x] `cd client && npm run build` / `npm run build:test` 均通过
- [x] `PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test` → **60 passed / 24 skipped / 0 failed**
- [x] 视觉/几何门禁：独立 Playwright 脚本（/tmp，未入库）在 360/390 × light/dark 固定时钟量测 48 个含内容格子 → **tag↔角标 0 重叠、tag↔pill 0 重叠、0 溢出、0 截断**；3× 放大截图人工确认最挤格（10-01：数字 / 休国庆节 / 等待 三行不压盖）
- [x] `server/runtime/` mtime 未被测试污染；无 `tmp-*`、`dist*`、`test-results/`、`screenshots/` 入库

## Step 7 — 部署（若确认上线）⏸

- [ ] `cd client && npm run build` → `docker compose build && docker compose up -d`（**未做，待用户确认**）
- [ ] 真机打开 PWA 日历：十月显示「国庆节」与「班」；DaySheet 正常

## Rollback points

- Step 1 后：`git checkout -- client/package.json client/package-lock.json` + `npm ci`
- Step 2–4 后：删除 `client/src/utils/holiday.js`，`git checkout -- client/src/components/venue/BookingCalendar.vue client/src/components/venue/DaySheet.vue`
- Step 5 后：删除 `e2e/holidays.spec.js`
- 全部为前端新增/接线，无数据迁移；回滚即还原
