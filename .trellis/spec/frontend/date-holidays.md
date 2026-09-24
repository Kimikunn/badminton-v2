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

## UI 呈现（2026-09-23 v3 定稿：自绘固定单月，见 ADR 0003）

- **日历骨架自绘**（`BookingCalendar.vue`，弃 Vant Calendar）：固定单月 7 列 grid + `‹›` 箭头切月，无横滑；一次只渲染一个月。未来上限=今天+6 月，过去下限=最早订场记录所在月（到边 disabled）。
- **形状语言只有两种**：监控=底部多段色条（`aggregateDayBars` 按 `BADGE_PRIORITY` 排序的数组，每条监控一段，已暂停/已过期/不可用日无条）；填色=今天实心 accent 蓝底反白数字 / 订场记录 success 淡绿底（过去日随整格 opacity .35 变淡）/ 不可用 danger 红底+数字划线。视觉契约细节见 `CONTEXT.md` 监控状态条目与任务 `09-23-venue-calendar-v3/research/mockup-v3.html`。
- **色条两态契约（2026-09-23）**：日历聚合只表达两种语义——`watching`（badge-blue 深蓝条，监控中）与 `pending_release`/`waiting`（`--cal-bar-waiting` 浅蓝条，待放票，含等待放票）；`awaiting_verify` 映射为 watching 深蓝条（系统此刻在盯）。瞬态（需验证 awaiting_verify 的分钟级行动、已锁到 fulfilled 的支付引导）由推送负责，日历是回看入口、不再表达——`fulfilled`/`expired`/`paused` 均不生成段。DaySheet 完整明细不受影响（仍展示需验证+截止时间、已锁到等）。
- **数字永远 flex 居中**：色条（absolute 贴底）与休/班小字（absolute 右上）不进数字排版流——任何标记组合下同一行数字位置一致（e2e 按 y 坐标断言）。
- **休/班 字形与配色只有一处定义**：`HolidayBadge.vue`（xs=格子 / md=DaySheet 色块）；消费方只传定位类，不要在消费方重写映射。
- **格子内不显示节日名**；名字只在 DaySheet（月摘要 `monthHolidaySummary` 已删除，勿再引用）。
- **月节日摘要、IntersectionObserver 可见月跟踪已随 Vant 一起删除**——月份就是当前渲染的 `cur` 状态，无需观察器。
- 视图切换用 **SegmentedControl（列表/日历，size sm）**，放在订场记录标题行右侧（与监控设置齿轮同位，2026-09-23 第二轮，R10）；Vant Tabs 与 `.record-view` 固定高容器已删除——第八轮（R18）起两视图在 `.record-body` 里 **grid 叠放**：两分支常渲染于 `grid-area: 1/1`，非激活分支 `invisible pointer-events-none`（保留布局，切换不跳高）；**容器高度 = 日历自然高度（非固定值，勿再硬编码 424px/440px）**，列表分支 `contain: size`（内在尺寸为 0、不参与行高贡献）+ `min-height: 0` + `overflow-y auto` 常开内滚，日历分支在容器内永不滚动（scrollHeight == clientHeight，e2e 断言覆盖 390/360）。列表**默认全量展示所有记录**（R14/R15/R17 第七轮最终收敛：展开/收起机制、`RECORD_PREVIEW_COUNT` 预览条数与吸底按钮均已删除，勿再引用；无按钮即无遮挡与预览态禁滚的边界问题）。列表复用 `BookingRow`。
- **相邻月日期填充（R16）**：网格恒 6 行 42 格，首行空位渲染上月末尾日期、尾部空位渲染下月开头日期（跨年由 `Date` 构造自动处理）。填充格带 `.day-adj` 类：纯视觉（opacity .35、`pointer-events:none`）、**无 `data-date`、无领域标记**，不进 `metaByKey`、不参与任何业务查询——e2e 的 `[data-date]` 锚点只落在当月真实日格上。
- 交互：点今天及以后（含不可用日）→ `select-day(dateKey)` 上抛开 DaySheet；过去日忽略（`pointer-events:none` + `onSelect` 双保险）；自绘无选中态，不需要 reset。
- **图例分组固定（2026-09-23 第十轮）**：信息栏图例恒渲染、恒定分组：**左组=日期填色**「今天（实心蓝 sw）/ 订场（绿淡 sw）/ 不可用（红淡 sw）」，**右组=监控色条（监控中（深蓝条）/ 待放票（浅蓝条，含等待放票））**+ 当月总时长；不随当月实际语义动态增减（每月 UI 逐月一致）。e2e 断言覆盖（任意月份两组恒定同序）。
- **信息栏组件化 + 总时长恒显示（2026-09-23 第十二轮）**：infobar 抽成可复用组件 `client/src/components/venue/CalendarInfoBar.vue`（props：`left`/`right` 图例数组 `[{label, cls}]` + `hours`），BookingCalendar 以 `<CalendarInfoBar :left="legendLeft" :right="legendRight" :hours="monthTotalHours" />` 使用。总时长**恒渲染**：0 也显示「0h」占位（旧版 v-if 隐藏已废弃），信息栏右端布局不随数据增减跳动。e2e 断言覆盖（11 月无记录月 textContent 为 0h）。色值单一来源：`--cal-bar-waiting` 浅蓝 var 定义在 BookingCalendar 的 `.venue-calendar` 根（含 `.dark` 变体），CalendarInfoBar 的 barleg 经 CSS 变量继承引用同名 var，勿在两处重复定义色值。
- **两态色深**（2026-09-23）：监控中=`--color-badge-blue` 深蓝、待放票=**组件内定制浅蓝** `--cal-bar-waiting`（浅色 0.78/深色 0.85，比 accent 明显更浅）——勿用 accent 或对调。
- 改动后验证：`e2e/holidays.spec.js`（固定时钟；AC1 导航边界 / AC2 休班 / AC3 色条 / AC4 填色 / AC5 数字对齐 / AC7 图例固定五项 / AC8-AC9+AC14 视图切换与列表全量展示+常开内滚 / AC11 等高与 42 格 / AC13 相邻月填充；AC12 已随展开/收起机制废除）。
- **e2e 看到的是容器产物**：改前端后必须 `cd client && npm run build:test` + 重建 `badmintontest` 镜像（见 backend/testing.md），否则 :8090 还是旧 bundle，e2e 全红会误判为代码问题。

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

- `BookingCalendar.vue` — 自绘月历格子（休/班右上小字，HolidayBadge xs）
- `DaySheet.vue` — 单日面板顶部节日行

测试：`e2e/holidays.spec.js`（固定时钟 2026-10-01；选择器 `.cal-day[data-date]`，含超范围用例）。
