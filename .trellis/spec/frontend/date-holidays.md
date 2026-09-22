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

## UI 呈现（2026-09-22 用户定：苹果日历式 休/班 角标；同日二改：卡片方块化）

- **单日方块的全部状态收在 `components/venue/DayCell.vue`**：今天（蓝方框）/ 不可用（红方块 + X）/ 休班角标 / 订场圆点 / 监控徽标。`BookingCalendar.vue` 只负责月份与数据装配。（改「蓝圈/红圈」只改 DayCell 一处。）
- 方块：`bg-surface` 卡片 + `rounded-sm`（项目 `rounded-lg`=20px 会变圆）+ `shadow-sm`；今天用 inset 阴影画蓝框（不改 border 宽度，内容锚点与其它格完全一致）。
- 内容锚点全部绝对定位，互不挤动：数字 `top: calc(50% + 1px)` 居中（整月同一基线）、角标左上 `3px`、圆点数字下方（有监控 pill 时隐藏）、pill 贴底、条数角标右上。
- **休/班 字形与配色只有一处定义**：`HolidayBadge.vue`（`size="xs"` 格子 8px 纯文字 / `size="md"` DaySheet 20px 色块）。消费方只传定位类（`.holiday-mark` / `.holiday-chip`），**不要在消费方重写 `type → 休/班/颜色` 映射**。
- **格子内不显示节日名**（写多了整片发红、数字被顶歪，被用户退回）；节日名在月摘要一行（`.holiday-summary`，固定结构「休 <日期> <名称>」在前、「班 <日期>」在后）与 DaySheet 顶部。
- **监控 pill 是胶囊且贴底满内宽**（`bottom-0 max-w-full`）：360px 下「已暂停」3 字必须完整且不切方块圆角（e2e 有「不越界/不截断」回归用例）。
- 不可用日不叠加休/班角标（X 语义优先）；名称统一由 `NAME_MAP`（清明/端午/中秋 → …节）。
- 改动格子布局后用 DOM rect 复测重叠/溢出/数字基线；e2e 已有基线断言与 pill 约束断言。

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
