# Design — 订场日历换用 Vant Calendar

> 前端单点替换：`BookingCalendar.vue` 重写为 Vant Calendar 包装；删除 `DayCell.vue`；`VenueView`/`DaySheet`/后端零改动。所有 API 结论见 `research/vant-calendar.md`。

## 1. 依赖与引入

```bash
cd client && npm install vant   # → ^4.10.2
```
仅在 `BookingCalendar.vue` 引入（按需树摇）：
```js
import { Calendar } from 'vant'
import 'vant/lib/calendar/style/index'
```
预检已验证（vue@3.5 + vite@5）：构建通过；新增 JS ~22KB gzip + CSS ~35KB gzip（含 popup 样式，PWA 可接受）。

## 2. BookingCalendar.vue（重写）

- **接口不变**：props `records / unavailableDateSet / monitorStatusByDate`；emits `select-day`（YYYY-MM-DD）。
- **Vant 配置**：`poppable=false`（内嵌）、`type="single"`、`:show-confirm="false"`、`:show-subtitle="false"`、`:show-mark="true"`（今天红点，颜色用 CSS 变量改成 accent）、`:allow-same-day="true"`（同一天重复点击始终触发 select，避免 unselect 周期）、`:first-day-of-week="1"`（周一开头）、`:default-date="today"`、`:row-height="64"`、`:formatter="formatter"`。
- **formatter(item)**（只做两件事，保持廉价）：
  - `unavailableDateSet.has(key)` → `type='disabled'` + `className='day-unavail'`；
  - 否则 `className = [今天? 'day-today', 过去? 'day-past']` 拼接。
- **插槽**：
  - `#text="item"` → `<span :data-date="key">{{ item.text }}</span>`：给每个数字加 `data-date`（e2e 稳定锚点；Vant 日格子本身没有 data 属性），同时作为样式钩子。
  - `#top-info="item"`：休/班 → `<HolidayBadge :type size="xs" />`；不可用 → `<X :size="12" class="day-x" />`；其它天 → 空（保持每个格子等高，Vant 的 top-info 有固定高度）。
  - `#bottom-info="item"`：有监控 → 状态胶囊（`MONITOR_PILL_CLASS` + `MONITOR_CELL_LABELS`，沿用现配色）；无监控有订场 → 圆点行；否则空。
- **事件**：
  - `@select="onSelect"` 与 `@click-disabled-date="onSelect"` 共用：`key < todayKey` → 忽略；否则 `emit('select-day', key)`（不可用日仍开 DaySheet，与现状一致）。
  - 月摘要不依赖 `@monthShow`（源码确认它只对"首次进入视口"触发，回滚时不再发）：改用 **IntersectionObserver 监听 `.van-calendar__month` 区块**，取与日历视口交集比例最大的月份更新 `currentMonth`。
- **月摘要**：把 run 分组逻辑从组件里抽到 `utils/holiday.js` → `monthHolidaySummary(year, month)`（复用 `holidayFor`/`HOLIDAY_TYPE_MARKS`，休在前班在后）；组件按 `currentMonth` 调用。初始值 = 今天所在月。
- **图例行**（有订场/不可用/当月时长）保留在日历下方，文案与现有一致。

## 3. 主题与样式（BookingCalendar 的 scoped style + :deep + .dark）

- 包装类 `.venue-calendar` 上设置 Vant 变量，日历背景透明（坐在现有 Card 上）：
  - light：`--van-calendar-background: transparent`、标题/星期/数字颜色 → `--color-fg/fg-secondary/fg-muted`、`--van-calendar-month-mark-color: var(--color-accent)`、disabled 数字 → `oklch(0.55 0.22 25 / 0.4)`（沿用旧 X 数字色）。
  - dark：`.dark .venue-calendar { ... }` 映射 dark token 对应值。
- 状态样式：
  - `.day-unavail`：`background: var(--color-danger-subtle); border-radius: 8px;`（红方块语义保留）；X 用 danger 色。
  - `.day-past`：`opacity: 0.45`（整格淡化）。
  - `.day-today`：暂用 Vant 自带红点（mark，已换 accent 色）；如需强调再给数字加环（`#text` 插槽的 span 上 `box-shadow`），实现时看截图定，不要自作主张加。
  - `.monitor-pill`：胶囊样式沿用（9px 字 + 状态配色）；64px 格子内 3 字标签必然放得下，**但仍保留「不截断/不越界」e2e 断言**。
- 隐藏 `.van-calendar__month-title`（月份区块小标题与吸顶标题重复）——实现时先保留，截图确认重复感后再删（一行 CSS，风险低，可回退）。

## 4. e2e 重写（e2e/holidays.spec.js）

- 每个测试自行 `page.clock.install`（不再共用 beforeEach，因为需要不同"今天"）：
  - **T1（今天=2026-10-01）**：`[data-date="2026-10-01"]` 所在 `.van-calendar__day` 含「休」；`[data-date="2026-10-10"]` 含「班」；点 10-01 → DaySheet「国庆节/法定假日」；`.holiday-summary` 含「休 1–7 国庆节 · 班 10」（初始可见月=10 月，确定性断言）。
  - **T2（今天=2026-09-22）**：9 月视图含 `[data-date="2026-09-25"]`「休」；若测试库有不可用日 → 点它 → DaySheet「已标记为不可用」（无数据则 `test.skip`）；`monitor-pill` 通用断言：可见胶囊全部「不截断且不越出日格子」。
  - **T3（AC5 替代）**：滚动到 11 月（2026-11 无任何节日）→ 该月区块内无 `HolidayBadge` 且摘要行消失；滚动方案用 `scrollTo` + `waitFor` 实现，若在 CI 级 flaky 则降级为「仅验证初始月摘要 + 依赖 holidayFor 超范围语义」（已在 research 记录），并在报告说明。
- 全量回归：`PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test`（smoke/contrast/其它 spec 不受影响，但必须跑）。

## 5. 删除与清理

- 删除 `client/src/components/venue/DayCell.vue`（含其全部格子样式）。
- `HolidayBadge.vue`、`utils/holiday.js` 保留（DaySheet 仍用）。
- 确认无残留 `.day-block/.day-number/.holiday-mark` 样式引用、无 console.log。

## 6. 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| Vant 默认样式与 token 冲突（红色系、圆形选中） | 变量映射（§3）；选中态不启用（点开 DaySheet，不选日期） |
| `monthShow` 只发一次导致摘要不更新 | 不用它；IntersectionObserver 方案（§2） |
| 懒渲染 + 滚动导致 e2e 不稳 | 主断言都在初始可见月；滚动类断言可降级并记录 |
| CSS 体积 +35KB gzip | 接受（PWA precache 现有 2.1MB）；记录在案 |
| 预检通过但真机渲染差异 | 360/390 × 浅/深色截图 + 3× 放大逐格人工确认 |

**回滚**：`git checkout -- client/src/components/venue/BookingCalendar.vue e2e/holidays.spec.js client/src/utils/holiday.js client/package.json client/package-lock.json` + 恢复 `DayCell.vue`（`git checkout 2d73386 -- client/src/components/venue/DayCell.vue`）。
