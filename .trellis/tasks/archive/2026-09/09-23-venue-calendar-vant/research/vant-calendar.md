# Research — Vant 4 Calendar 选型与 API 实测

> 2026-09-23 实测：npm 4.10.2（2026-08-31 发布，活跃维护；月下载 42.8 万），解包源码 + /tmp 预检构建验证。

## 候选对比（全部 npm 实测）

| 组件 | 月下载 | 最后发布 | Vue 3 | 结论 |
|---|---|---|---|---|
| **Vant 4 Calendar** | 42.8万 | **2026-08** | ✅（peer vue ^3.0） | **选用**：移动端最成熟、中文内建、逐日定制齐全 |
| v-calendar 3.1.2 | 88万（多来自 Vue2 老版） | 2023-10 停更 | ⚠️ peer ^3.2（本项目 3.5） | 不用：3 年未发版 |
| vue-cal 4.10 | 16万 | 2026-05 | ✅ | 不用：事件导向，塞不下 X/休班/监控徽标 |
| @fullcalendar/vue 6 | 14万 | 2026-06 | ✅ | 不用：月视图是事件列表，重 |

## Vant Calendar 关键 API（源码级确认）

- **内嵌**：`poppable=false` → 渲染内联日历（标题栏 + 可滚动多月网格）。
- **逐日定制**：`formatter(item: CalendarDayItem)` 返回同结构：
  `{ date, text, type, topInfo, bottomInfo, className }`；
  - `type: 'disabled'` → 灰色、`tabindex` 移除、点击走 `clickDisabledDate` 事件（不触发 select）；
  - `className` 直接挂在日格子根元素 `div[role=gridcell].van-calendar__day` 上（源码确认 `class: [bem("day", type), className]`）。
- **插槽**（源码确认 `slots["top-info"](props.item)`，插槽作用域 = 日对象本身）：
  `#top-info="item"` / `#bottom-info="item"` / `#text="item"` —— 有插槽时忽略 topInfo/bottomInfo 文本。
- **事件**：`select(Date)`；`clickDisabledDate(Date)`（源码：`emit("clickDisabledDate", item.date)`）；`monthShow({ date, title })`（某月首次进入视口时触发，title 如「2026年10月」）。
- **其它**：`rowHeight`（默认 64px）、`showMark`（今天红点）、`showSubtitle`、`showConfirm`、`min-date`/`max-date`、`defaultDate`、`color`（选中态色）；内部还有 `#text` 插槽可覆盖日期数字。
- 深色/主题：CSS 变量 `--van-calendar-*`（CalendarThemeVars：background、headerTitleColor、weekdaysColor、dayTextColor、dayDisabledTextColor、dayHeight、monthTitleFontSize 等），可在 `.dark` 作用域覆盖。

## 集成预检（/tmp/vant-test）

- `vant@4.10.2 + vue@3.5 + @vitejs/plugin-vue@5 + vite@5` → **构建成功**（exit 0）。
- 只引入 `import { Calendar } from 'vant'` + `import 'vant/lib/calendar/style/index'`：
  产物 JS 104KB raw / 41KB gzip（含 Vue 运行时），CSS 79KB raw / 35KB gzip（含 popup 依赖样式）。
- 本项目已有 Vue 运行时，新增量约 **JS ~22KB + CSS ~35KB gzip**，PWA 可接受。

## 交互设计要点（映射到本项目需求）

- 不可用日 → `type: 'disabled'` + `className: 'day-unavail'`（红底 X 由插槽+CSS 实现）；点击仍开 DaySheet（走 clickDisabledDate）。
- 过去日 → 不加 disabled（保持 Vant 正常样式 + 我们的 `.day-past` 淡化），select 回调里忽略过去日。
- 今天 → `className: 'day-today'`，CSS 用 accent 色环（`--van-calendar-day-text` 需要包一层圆形容器，实现时定）。
- 月摘要 → `@monthShow` 更新「当前可见月」，复用现有 `holidaySummary` 计算（休在前班在后）。
- e2e 定位：`[role=gridcell]` 按文本匹配（`hasText: /^1$/`），月份范围用 `.van-calendar__month-title` 锚定；Vant 日格子没有 data-date 属性。
