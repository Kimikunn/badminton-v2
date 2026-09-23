# Date & Holiday Data

> 中国法定节假日 / 调休补班的**唯一数据源**：`chinese-days`（离线 npm 包，随前端 bundle）。
> 业务代码只通过 `client/src/utils/holiday.js` 的 `holidayFor(dateKey)` 查询，
> 不要在组件里直接 `import 'chinese-days'`（统一判定规则，便于未来换数据源）。

---

## Contract

```js
holidayFor('YYYY-MM-DD') // → null | { name: string, type: 'holiday' | 'workday' }
```

| type | 含义 | UI 约定 |
|------|------|---------|
| `'holiday'` | 法定放假 | 「休」+ `danger` 色系 |
| `'workday'` | 调休补班 | 「班」+ `fg-muted`/中性色 |
| `null` | 普通日期、普通周末、超出数据范围 | 不显示任何标记 |

日期串直接透传（不经 `new Date()`），避免时区偏移。

## UI 呈现（2026-09-22 苹果日历式角标；2026-09-23 三改：换 Vant 4 Calendar）

- **日历骨架由 Vant Calendar 承担**（`BookingCalendar.vue` 内嵌 `poppable=false`，行高 64px）：网格/星期/月份标题/触控滚动都是组件库的；自研格子组件 DayCell 已删除。
- 领域标记放 Vant 的逐日定制位：`formatter`（不可用 → `type:'disabled'` + `.day-unavail`；今天/过去 → className）＋ `#top-info`（HolidayBadge xs 休/班；不可用日 X）＋ `#bottom-info`（监控胶囊或订场圆点）＋ `#text`（数字包 `<span :data-date>`，e2e 锚点 + 今天 accent 环钩子）。
- **休/班 字形与配色只有一处定义**：`HolidayBadge.vue`（xs=格子 / md=DaySheet 色块）；消费方只传定位类（`.holiday-mark` / `.holiday-chip`），不要在消费方重写映射。
- **格子内不显示节日名**；名字在月摘要（`utils/holiday.js` 的 `monthHolidaySummary(year, month)`，休在前班在后）与 DaySheet。
- **可见月跟踪**：不用 `@monthShow`（Vant 只对首次进入视口的月触发，回滚不再发）；用 IntersectionObserver 监听 `.van-calendar__month` 区块、取可见比例最大的月驱动摘要与当月时长。
- **Vant 的 `showMark` 是月份背景水印**（不是「今天」标记）——必须 `:show-mark="false"`（深色下会以巨型浅灰月份数字压住日期，实测对比度 1.43:1）；今天用 `.day-today .day-number` 的 **accent 实心圆 + 反白数字**（Vant 原生选中态语言，2026-09-23 从描边色环改来）。
- 视图切换用 **Vant Tabs**（下划线 + 可左右滑），列表/日历两视图装在 `.record-view` 同高容器（440px）内不跳动；日历高度由外层决定（`.van-calendar { height: 100% }`），不再硬编码。
- 交互：点日期与点不可用日（`clickDisabledDate`）走同一个 `select-day` 上抛；过去日忽略；select 后 `calendarRef.reset(null)` 清选中态（本日历是「打开面板」不是「选日期」）。
- 不可用日：红底（danger-subtle 8px 圆角）+ X（danger、opacity 0.7，L 差 ≥ 0.3）；过去日整格 0.45 淡化。
- 改动后验证：`e2e/holidays.spec.js`（固定时钟）+ DOM rect 审计（越界/截断/上下排重叠）+ 深色下确认无水印残留。

## 判定规则（来自 `chinese-days` 的 `getDayDetail`）

| `name` 形态 | 含义 | 例 |
|---|---|---|
| `'National Day,国庆节,3'` + `work=false` | 法定假日 | 2026-10-01 |
| `'National Day,国庆节,3'` + `work=true` | 调休补班 | 2026-10-10 |
| `'Tuesday'`（英文星期名，无逗号） | 普通日 | 2026-10-08 |

- **必须用 `name.includes(',')` 判定是否节日条目**，中文名取 `split(',')[1]`。
- **不要用 `isHoliday()`**：它对所有周末都返回 `true`，不代表法定节假日。
- 数据范围：法定节假日/调休 **2004–2026**；范围外返回普通星期名 → 无标记、不误报。

## 升级数据（新一年度）

```bash
cd client && npm install chinese-days@latest && npm run build   # 重建即可，无需改代码
```

## Consumers

- `BookingCalendar.vue` — 月历格子节日 tag
- `DaySheet.vue` — 单日面板顶部节日行

测试：`e2e/holidays.spec.js`（固定时钟 2026-10-01；含超范围 AC5 用例）。
