# 订场屏 Apple Sports 风格实现（venue redesign r1）

## Goal

按 `design-system.md` §10–§12 契约 + `venue-sketch-final.png` 草图，把订场屏
（VenueView 及其子组件）换肤为 Apple Sports 风格。**交互行为与 ADR 0003 契约
零变更**；深色优先、严格走 token；e2e 回归全绿。

## Requirements

### R1 范围与基线
- 只动订场屏：`client/src/views/VenueView.vue` + `client/src/components/venue/*`
  （BookingCalendar / DaySheet / CalendarInfoBar / VenueWatchSettingsSheet，
  必要时新增组件）；**禁改其它屏与布局壳**（§1 布局契约不动）
- 交互行为基线：`09-25-mobile-design-system/baseline/interactions.md` +
  现有订场 e2e spec，逐项不缺失

### R2 五视图目标形态（= 草图五帧）
1. **列表**：轮换卡置顶（扁平卡 + 左缘 3px 订场绿，无渐变描边）；分组 header
   （--text-xs / 600 / text-muted，正常中文无字距）；记录行（头像+主辅文+价格
   tabular+静默删除钮）；"更早的记录"默认收起；底部唯一绿色 CTA（无图标）
2. **日历**：BookingCalendar 卡片化（--color-surface 底）；ADR 0003 契约原样：
   自绘单月不滚动、‹›切月、今天/订场绿淡底/不可用红淡底、监控双色条（深蓝=监控中/
   浅蓝=待放票，段序=BADGE_PRIORITY）、图例、月区间（今天月+6 / 最早记录月）
3. **DaySheet**：信息结构不变（节假日 chip / 订场行+编辑删除 / 监控列表 /
   标记不可用）；操作图标 Pencil(accent) / Trash(danger) 常驻（操作上下文惯例）
4. **新增订场表单**：字段不变（场地/起止/费用自动匹配/备注）；inset grouped
   形态（一张卡、label 左灰/值右白、发丝分隔、组下灰脚注）；复用 Sheet.vue
5. **设置 Sheet**：右上 ⚙ 圆形图标钮 → Sheet：场地信息管理（行操作
   Pencil/Trash）+ 监控设置入口（chevron 行）；低频管理不进扫读区

### R3 风格契约（硬约束）
- **深色优先，严禁写死深色值**：全部颜色走语义 token（--color-surface /
  --color-success / --color-danger / --color-accent / --color-text-* 等）；
  无对应 token → 本任务内新增（只加不改名）
- 奇数 px 归栅：间距 10/11/13 → --space-2(8)/--space-3(12)；字号 → --text-xs(12)
  /--text-sm(14)；圆角 → --radius-md(12) 档
- 图标全部 lucide-vue-next 组件；**Trash2 → Trash**（现有 DaySheet.vue 用法要换）；
  ≤14px 图标 stroke-width 2.4–2.5；禁 emoji/文本字形
- 对齐双轨：屏缘轨 --space-3（大标题/分组 header/CTA/卡边距同轨）+ 内容轨
  --space-3（卡内）+ 价格 tabular-nums
- 页内"列表/日历"tab 升级大字形态：--text-lg；inactive muted/600，active 主色/800
- 一屏一主操作；阴影仅浮层（悬浮 CTA 轻投影、Sheet/Toast）

### R4 PWA 适配
- 删除一律二次确认（ConfirmSheet.vue），反馈走 Toast，禁 confirm()
- 触控目标 ≥44px、`:active` 反馈（hover 仅增强）、safe-bottom（§3 §4）

## Acceptance Criteria

- [ ] 五视图视觉 = `venue-sketch-final.png`（深色），逐帧人工过目
- [ ] 本次 diff 内可追溯性：无新增硬编码 oklch/hex/奇数 px（§12-A/B）
- [ ] 订场屏范围内 Trash2 引用清零，全部为 Trash；无 emoji/文本字形图标
- [ ] ADR 0003 日历契约回归：切月/填色/双色条/图例/月区间 e2e 断言全绿
- [ ] 订场相关 e2e spec 全绿：`PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test`
- [ ] 交互基线逐项不缺失（展开收起 / DaySheet 入口 / 新增记录 / 监控管理 /
      设置 Sheet 场地增删改）
- [ ] 深色截图人工过目（light 截图留待浅色批量任务，见 Out of Scope）
- [ ] 部署流程照旧：`npm run build:test` → 测试容器 build/up

## Out of Scope
- 其它三屏改版（一屏一任务）
- 浅色模式批量适配（后续任务：tokens.css `:root` 换浅色方案 + 辉光/淡底/阴影微调）
- 左滑删除手势（后续增强；本期=常驻静默删除钮 + confirm）

## References
- 草图：`.trellis/tasks/09-25-mobile-design-system/baseline/refs/venue-sketch-final.png`
- 风格拆解：同目录 `apple-sports-breakdown.md`（原则/交互逻辑出处）
- 规范：`.trellis/spec/frontend/design-system.md` §0 / §2 / §3 / §10 / §11 / §12
- 契约：ADR 0003（订场日历）；tokens.css（唯一色值来源）
