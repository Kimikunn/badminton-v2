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
