# Design — 订场日历 v3（固定单月自绘 + 色条/填色）

定稿视觉稿：`research/mockup-v3.html`（浏览器直接打开，含深色切换与月导航）。

## 1. 组件结构（BookingCalendar.vue 重写）

```
BookingCalendar.vue（自绘，去 Vant）
├─ props 不变：records / unavailableDateSet / monitorStatusByDate（值形状改为 Map<string, string[]>）
├─ emit 不变：select-day(dateKey)
├─ 月份导航：minMonth（最早订场记录月）/ maxMonth（+6）夹紧的 cur {year, month}，首屏=今天所在月
├─ 月网格：7 列 grid，lead 空位 + 当月天数；每格 data-date 锚点 + 领域类
├─ metaByKey computed 保留（去 holidaySummary；monitor 改为状态数组）
└─ 底部信息栏：动态图例 + monthTotalHours（保留现有实现）
```

删除：Vant `Calendar` import 与 `--van-calendar-*` 变量覆盖、IntersectionObserver 可见月跟踪、`monthHolidaySummary`、`calendarRef.reset(null)`（自绘无选中态，点击本来就是打开面板不产生选中）。

## 2. 数据契约（intent.js）

`aggregateDayBadge`（折叠为最高优先一条 + count）→ 改造为 **`aggregateDayBars(monitors)`：按 `BADGE_PRIORITY` 排序返回状态数组**（段序稳定 = 优先级序，与契约一致）。旧函数无其他消费者（`badgeFor` 只被 VenueView 日历接线用），`badgeFor` 同步改为返回数组。`VenueView.vue:155` `monitorStatusByDate` 的值从 `{status,count}` 变 `string[]`，传参名保留。

不可用/已过期不参与聚合的现有规则原样保留（expired 过滤、不可用日由日历层处理）。

## 3. 格子渲染规则（mockup v3 1:1）

```
cell（52px，圆角 10，relative，overflow hidden）
├─ .num        永远 flex 居中（不进任何排版流）
├─ .bars       absolute bottom:7px left/right:20%，每段 flex:1（4px 高）
├─ .holi       absolute top:3px right:4px，8px 小字（休=danger / 班=muted）
└─ 底色类（互斥优先级：today > unavail > booking > 状态淡底？→ 不冲突，见下）
```

| 状态 | 类 | 底色（浅色/深色沿用 token） |
|---|---|---|
| 今天 | `day-today` | `--color-accent` 实心 + 反白数字 |
| 不可用 | `day-unavail` | `--color-danger-subtle` + 数字划线 |
| 订场（未来） | `day-book` | `--color-success-subtle` |
| 订场（过去） | `day-book day-past` | 同上 + 整格 opacity .35（视觉=淡绿） |
| 监控中 | `bar-watching` | accent 条 |
| 需验证 | `bar-await` | warning 条 |
| 已锁到 | `bar-locked` | success 条 |
| 待放票/等待放票 | `bar-waiting` | badge-blue 条 |
| 过去日 | `day-past` | 整格 opacity .35、`pointer-events:none` |

色条颜色映射放 `MONITOR_BAR_CLASS`（variant→类），色值全部引用现有 token，不新增色值（R8）。多监控=多段 `<i>` 并排；已暂停/已过期不生成段。

## 4. 兼容与联动

- **e2e**：`e2e/holidays.spec.js` 选择器从 `.van-calendar__day` 改自绘类（`.cal-day[data-date=...]`），`scrollToMonth` 帮手改为点箭头导航；`smoke/contrast` 等如引用日历选择器一并核对。新增 AC3/AC4/AC5 断言。
- **DaySheet**：不动；`select-day` 事件 payload（dateKey 字符串）不变。
- **深色模式**：全部走 token，`.dark` 由根类继承，无需组件内分支。
- **vant 依赖**：仅当 Tabs（`13dbd33` 引入）仍用 Vant 时保留 package.json 依赖；Calendar 样式 import 删除。

## 5. 回滚

单提交实现：`git revert` 即可回到 Vant 版（Vant 代码在本任务基线仍完整存在）。CONTEXT.md/ADR 文档改动随提交走，回滚提交一并还原。
