# Research — chinese-days 选型与 API 实测

> 2026-09-22 实测（npm 1.5.9，npm pack 解包 + Vite 5.4.21 构建验证）。

## 候选对比

| 方案 | 中国调休(补班) | 离线 | 体积 | 结论 |
|---|---|---|---|---|
| **chinese-days 1.5.9** | ✅ 完整（holidays/workdays/inLieuDays） | ✅ npm 包内置数据 | ~20KB（gzip ~7KB） | **选用**；MIT、活跃维护、专为中国节假日 |
| date-holidays | ⚠️ 全球语义，调休不准 | ✅ | 大 | 不用 |
| 在线 API / CDN JSON | ✅ | ❌ | - | PWA 断网失效，不用 |

## API 语义（`getDayDetail`，实测）

```js
import { getDayDetail } from 'chinese-days'
getDayDetail('2026-09-25') // { date:'2026-09-25', work:false, name:'Mid-autumn Festival,中秋,1' }  → 假日
getDayDetail('2026-10-10') // { date:'2026-10-10', work:true,  name:'National Day,国庆节,3' }       → 调休补班
getDayDetail('2026-09-22') // { date:'2026-09-22', work:true,  name:'Tuesday' }                     → 普通日
getDayDetail('2027-01-05') // { date:'2027-01-05', work:true,  name:'Tuesday' }                     → 超出数据范围
```

**判定规则**：`name` 含逗号 = 节日条目，`name.split(',')[1]` 为中文名；`work=false` → 休，`work=true` → 班。
**不要用 `isHoliday()`**：它对所有周末都返回 `true`（不代表法定节假日）。

## 数据范围

- 法定节假日/调休：**2004–2026**（README 声明，2026-09-20/10-10 等数据实测存在）。
- 超出范围（2027+）：返回普通星期名 → 不显示标记（不会误报）。
- 农历/节气：1900–2100（本任务不用）。

## 集成验证

- 包 `"type":"commonjs"`、`module: dist/index.es.js`（ESM）→ **Vite 5 build 实测成功**（/tmp/vite-cd-test），产物含数据，`getDayDetail` 可调用。
- 体积：测试 bundle 24KB（gzip 8.5KB，含 Vue 无关的 modulepreload polyfill）；纯库部分 ~20KB。
- 导入：`import { getDayDetail } from 'chinese-days'`（具名导出存在于 `dist/index.es.js`）。

## 展示相关事实

- 现有日历 `BookingCalendar.vue` 自研月网格：格子已承载 日期数字 + 订场圆点 + 监控徽标（9px）+ 右上角条数角标；360px 宽下单格约 43px。
- DaySheet 的 `Sheet :title` 仅接日期字符串（`components/ui/Sheet.vue` 的 title 为 String prop），节日信息需放在 Sheet 内容区。
- 依赖加在 `client/`；部署走 `cd client && npm run build` → 根 `Dockerfile` 的 `COPY client/dist/`。
