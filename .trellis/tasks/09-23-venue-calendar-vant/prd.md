# 订场日历换用 Vant Calendar（组件化骨架 + 保留领域标记）

> 状态：已完成（2026-09-23），生产部署待用户确认。

## Goal

用成熟的 **Vant 4 Calendar** 替换自研月历骨架（网格/星期/标题/导航/触控全部交给组件库），把我们的领域标记（休/班、不可用 X、订场圆点、监控状态胶囊）放进它的逐日定制位。数据与业务逻辑不变（chinese-days / DaySheet / 监控 / 订场）。

## Background（已核实事实）

- 自研日历的"丑"根因：360px 下 36px 格子要塞 5 种标记；Vant 行高默认 **64px**，标记有呼吸空间。
- Vant 4.10.2：2026-08 发布、月下载 42.8 万、中文内建；`poppable=false` 内嵌；`formatter` 逐日定制（type/className）；`#top-info`/`#bottom-info` 插槽（作用域=日对象）；事件 `select` / `clickDisabledDate` / `monthShow`。全部 API 已在源码级验证（见 `research/vant-calendar.md`）。
- 预检：`vant + vue@3.5 + vite@5` 构建成功；新增体积 JS ~22KB + CSS ~35KB gzip。
- 既有资产保留：`chinese-days` 数据、`utils/holiday.js`（holidayFor/NAME_MAP/HOLIDAY_TYPE_MARKS/LABELS）、`HolidayBadge.vue`（DaySheet 与日历共用）、`DaySheet.vue`、图例行与月摘要文案。

## Requirements

- **R1 骨架**：`BookingCalendar.vue` 重写为 Vant Calendar 包装：内嵌（`poppable=false`）、单月多选关（single）、无确认栏；中文标题/星期由 Vant 提供。
- **R2 逐日标记**（formatter + 插槽）：
  - 休/班 → `#top-info` 插槽渲染 `HolidayBadge`（xs）；
  - 监控状态 → `#bottom-info` 插槽渲染状态胶囊（沿用 MONITOR_PILL_CLASS 配色与文案）；
  - 订场圆点 → 无监控时在 `#bottom-info` 渲染圆点行；
  - 不可用 → `type: 'disabled'` + `className: 'day-unavail'`（红底 + X，CSS 实现），点击仍打开 DaySheet；
  - 今天 → `className: 'day-today'`，accent 色环标记；过去日 → `className: 'day-past'` 淡化。
- **R3 交互**：点日期 → `select-day`（过去日忽略）；点不可用日 → 同样 `select-day`（DaySheet 内可取消标记，行为与现状一致）。
- **R4 月摘要**：`@monthShow` 更新当前可见月 → 复用现有「休 <日期> <名称> · 班 <日期>」计算，摘要永远对应屏幕上的月份。
- **R5 主题**：浅/深色用 `.dark` 作用域覆盖 `--van-calendar-*` 变量，映射项目 token；日历背景透明（坐在现有 Card 上）。
- **R6 接口不变**：props（records / unavailableDateSet / monitorStatusByDate）与 emits（select-day）保持，`VenueView.vue` 与 `DaySheet.vue` 零改动。
- **R7 清理**：删除 `DayCell.vue`（被 Vant 替代）；`HolidayBadge` 保留。

## Acceptance Criteria

- [x] **AC1**（e2e，固定时钟 2026-10-01）十月网格：1–7 显示「休」、10 显示「班」；点 10-01 → DaySheet 出现「国庆节/法定假日」；点 10-10 → 「班/调休补班」。
  - 证据：`e2e/holidays.spec.js` **20 passed**（T1/T1b × 4 project）。
- [x] **AC2** 不可用日：disabled + 红 X 样式；点击仍打开 DaySheet（用测试库中的不可用日验证）。
  - 证据：e2e T2（时钟 09-22，点 09-16 不可用日 → DaySheet「已标记为不可用」）；8 配置审计每个 `.day-unavail` 均有可见 X + 红底。
- [x] **AC3** 360px 下监控胶囊「已暂停」完整显示、不越出格子。
  - 证据：8 配置审计：pill inside=true、truncated=false（e2e T2 有断言）。
- [x] **AC4** 月摘要与可见月一致（10 月显示「休 1–7 国庆节 · 班 10」，滚动/切换后更新）。
  - 证据：e2e T3/T4（滚到 11 月/2027-01 摘要消失）+ 独立 scroll-back 往返验证；IntersectionObserver 跟踪可见月。
- [x] **AC5** `cd client && npm run build` 通过；`npx playwright test` 全绿；360/390 × 浅/深色截图无溢出、无重叠。
  - 证据：build 12.3s exit 0；全量 **64 passed / 24 skipped / 0 failed**；8 配置审计 0 溢出 0 越界 0 报错；深色月份水印已关闭（`:show-mark="false"`，check 发现的 1.43:1 对比度问题）。
- [x] **AC6** 代码库：`DayCell.vue` 已删；Vant 按需引入；无遗留自研格子样式；无 console.log。
  - 证据：`git rm DayCell.vue`；grep 无 DayCell/day-block/day-num-fixed 残留；产物无 vant 无关组件；console.log 干净。

## Out of Scope

- 后端、接口、数据模型（零改动）。
- DaySheet 样式与监控/订场业务逻辑。
- 多选/范围选择、日历作为弹层（popup）形态。

## 决策记录

- 组件：**Vant 4 Calendar**（用户 2026-09-23 选定；备选 v-calendar/vue-cal 因停更/形态不符被否，见 research）。
- 视觉：采用 Vant 默认排版（64px 行高、圆形选中态语言），不再沿用自研的 8px 角标/36px 方块方案（用户判定"太丑"）。
- 流程：建 Trellis 任务走完整规划（用户确认）。
