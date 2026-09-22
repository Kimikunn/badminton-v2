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

## UI 呈现（2026-09-22 用户定：参考苹果日历）

- **休/班 字形与配色只有一处定义**：`components/venue/HolidayBadge.vue`（`size="xs"` 格子 8px 纯文字 / `size="md"` DaySheet 20px 色块）。消费方只传定位类（`.holiday-mark` / `.holiday-chip`），**不要在消费方重写 `type → 休/班/颜色` 映射**。
- **日历格子只放 8px「休/班」角标**（左上角绝对定位）：不参与 flex 流；**格子内不显示节日名**（写多了整片发红、数字被顶歪，被用户退回）。
- 格子布局不变式（改动任何一项都要重测）：日期数字绝对居中固定（`.day-num-fixed`，整月同一基线）；角标固定左上；订场圆点固定在数字下方（有监控 pill 时隐藏）；监控 pill 贴底居中；条数角标固定右上（高 11px，避免碰两位数）。
- 节日名出现在两处（不占格子）：月历下方摘要一行（`.holiday-summary`，固定结构「休 <日期> <名称>」在前、「班 <日期>」在后，如「10月：休 1–7 国庆节 · 班 10」）与 DaySheet 顶部节日行。
- 名称统一：`holidayFor` 内部用 `NAME_MAP` 把 清明/端午/中秋 补成 …节，保证摘要与 DaySheet 用词一致。
- 不可用日（X 分支）不叠加休/班角标——X 语义优先。
- 改动格子布局后用 DOM rect 复测重叠/溢出与数字基线（见 component-guidelines 密集格一节；e2e 已有基线断言）。

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
