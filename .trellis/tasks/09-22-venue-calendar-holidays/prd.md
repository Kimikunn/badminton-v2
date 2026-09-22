# 订场日历显示节假日（节日名 + 休/班角标）

## Goal

在订场日历（`BookingCalendar.vue`）与单日面板（`DaySheet.vue`）上显示中国法定节假日与调休补班：**节日名 + 休/班标记**。数据用 `chinese-days` 离线包；**纯展示**，不改任何订场/监控/推送逻辑。

## Background（已核实事实）

- 日历由 `client/src/components/venue/BookingCalendar.vue` 自研渲染（月网格 + 订场圆点 + 监控徽标 + 不可用 X）；单日详情在 `client/src/components/venue/DaySheet.vue`，其 `Sheet :title` 只接日期字符串（`client/src/components/ui/Sheet.vue`），节日信息只能放内容区。
- `chinese-days@1.5.9`（MIT、离线、活跃维护）：`getDayDetail('YYYY-MM-DD')` → `{ date, work, name }`。
  - 法定假日：`work=false`，`name='Mid-autumn Festival,中秋,1'`；调休补班日：`work=true`，`name='National Day,国庆节,3'`；普通日：`name='Tuesday'`（无逗号）。
  - **判定必须用 `name.includes(',')`**；`isHoliday()` 周末也返回 true，不可用于标记。
  - 数据覆盖 2004–2026；2027+ 返回普通星期名（不误报，只是无标记）。
  - 体积 ~20KB（gzip ~7KB），Vite 5 构建实测通过。详见 `research/chinese-days-api.md`。
- 现有格子已较满：360px 宽下单格约 43px，含日期数字 + 订场圆点 + 9px 监控徽标；节日标记必须沿用现有设计 token 且不溢出。

## Requirements

- **R1 日历格子**：节日/补班日显示 `休/班` 标记 + 节日中文名（如「休 中秋」「班 国庆节」）。休 = 法定放假（`danger` 色系），班 = 调休补班（中性 `fg-muted` 色系）；普通日期与普通周末不加任何标记。
- **R2 单日面板**：DaySheet 打开节日/补班当天时，在内容区顶部显示同样的信息（`休/班` chip + 节日名 + 「法定假日 / 调休补班」说明）。
- **R3 风格与适配**：使用现有 Tailwind 设计 token（浅/深色模式、contrast spec 通过）；360×640 与 390×844 不溢出、不遮挡（节日 + 监控同时出现时也不能互相压盖）。
- **R4 纯展示**：不修改订场/监控/放票/推送逻辑；不改服务端、无接口与数据结构变更。
- **R5 离线**：节日数据随前端 bundle 内置，无网络请求；升级依赖即可获得后续年份数据。

## Acceptance Criteria

- [x] **AC1**（e2e，固定时钟 2026-10-01）日历十月：`[data-date="2026-10-01"]` 显示「国庆节」与「休」；`[data-date="2026-10-10"]` 显示「班」；`[data-date="2026-10-08"]`（普通日）无节日标记。
  - 证据：`e2e/holidays.spec.js` 16 passed（4 用例 × 4 project）；断言已收紧到 `.holiday-tag` 内部。
- [x] **AC2**（e2e）点击 2026-10-01 格子 → DaySheet 顶部显示「国庆节 · 法定假日」与「休」chip；补班日显示「调休补班」与「班」。
  - 证据：同上；chip 断言用 `.holiday-chip`。
- [x] **AC3** `cd client && npm run build` 通过；`npx playwright test` 全绿（新增 `e2e/holidays.spec.js` + 既有 smoke/contrast 无回归）。
  - 证据：build exit 0；全量 **60 passed / 24 skipped / 0 failed**（skip 为既有 env 门控用例）。
- [x] **AC4** 360×640、390×844、浅/深色截图检查：格子内容不溢出、节日标记与监控徽标不重叠；`e2e/contrast.spec.js` 通过。
  - 证据：DOM rect 量测 48 格 0 重叠 / 0 溢出 / 0 截断（含 10-01 count=2 最挤格）；DaySheet 说明文字对比度由 2.2:1 修至 5.45–6.87:1（≥ WCAG AA）；contrast.spec 全绿。
- [x] **AC5** 超出数据范围的日期（如 2027-01-05）不显示任何节日标记。
  - 证据：e2e 通过；另验证 2027-01 全月 31 格 `.holiday-tag` 计数为 0。

## Known Limitations

- 节假日数据覆盖 2004–2026；2027 年起需随 `chinese-days` 升级获得（升级依赖即生效，无需改代码）。
- 数据只含法定节假日/调休；传统节日（如重阳、七夕）不在标记范围。

## Out of Scope

- 农历/节气显示（用户明确未选）。
- 订场/放票/监控逻辑变化、推送文案变化。
- 服务端改动（数据完全在客户端）。

## 决策记录

- 展示程度：**节日名 + 休/班角标**（同时用于日历与 DaySheet）——2026-09-22 用户确认。
- 参与逻辑：**纯展示**——用户确认。
- 数据方案：**chinese-days 离线 npm 包**（不换日历 UI 组件库）——用户确认。
