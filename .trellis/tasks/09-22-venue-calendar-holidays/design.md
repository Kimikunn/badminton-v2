# Design — 订场日历节假日显示

> 纯前端改动：1 个新工具模块 + 2 个组件接线 + 1 个依赖 + 1 个 e2e spec。无服务端、无接口、无数据结构变更。

## 1. 架构与数据流

```
chinese-days (npm, 离线)
   └─ getDayDetail('YYYY-MM-DD') → { work, name }
        └─ client/src/utils/holiday.js  holidayFor(dateKey)
             ├─ BookingCalendar.vue  → 每月格子 holiday 字段
             └─ DaySheet.vue         → 顶部节日行
```

- 新增 `client/src/utils/holiday.js`（`client/src/` 下暂无 `utils/`，本任务新建；纯函数，无响应式）：
  ```js
  import { getDayDetail } from 'chinese-days'

  /**
   * @param {string} dateKey YYYY-MM-DD（日历本身的日期串，不经 Date 对象，避免时区偏移）
   * @returns {{ name: string, type: 'holiday'|'workday' } | null}
   *   holiday = 法定放假（休）；workday = 调休补班（班）；普通日/超范围 → null
   */
  export function holidayFor(dateKey) {
    const detail = getDayDetail(dateKey)
    if (!detail.name.includes(',')) return null      // 普通日 name 是星期英文名
    return { name: detail.name.split(',')[1], type: detail.work ? 'workday' : 'holiday' }
  }
  ```
- 不做缓存：单月 ≤31 次调用，库内部是常量 Map 查表，无性能问题；保持纯函数便于推理。
- 不显示农历/节气；不用 `isHoliday()`（周末误报，见 research）。

## 2. 日历格子（BookingCalendar.vue）

- `days` computed 内为每个 cell 增加 `holiday: holidayFor(key)`（含过去/不可用日，标记是事实信息）。
- 渲染位置（`day-normal` 分支，日期数字**上方**，作为 flex 列第一项）：
  ```html
  <span v-if="cell.holiday" class="holiday-tag"
        :class="cell.holiday.type === 'holiday' ? 'text-danger' : 'text-fg-muted'">
    <span>{{ cell.holiday.type === 'holiday' ? '休' : '班' }}</span>{{ cell.holiday.name }}
  </span>
  ```
- 不可用日（X 分支）不叠加节日标记（X 语义优先）；DaySheet 仍会显示节日信息。
- **空间约束（关键）**：360px 宽下单格约 43px，现有栈 = 数字 14 + 圆点 6+2 + 监控徽标 13+2 ≈ 37px。节日 tag 用 `text-[8px] leading-[9px] px-[2px] w-full truncate text-center`；当节日与监控徽标同格时**隐藏圆点行**（`v-if="cell.bookings.length && !(cell.holiday && cell.monitor)"`），保证 9+14+2+13 ≈ 38px 不溢出。实现后必须按 AC4 在 360/390 截图确认（必要时微调 leading，而不是改格子高度）。
- 给格子加 `:data-date="cell.key"`（`data-date` 属性）供 e2e 稳定定位。

## 3. DaySheet.vue

- `const holiday = computed(() => holidayFor(props.date))`。
- 渲染在 Sheet 内容区最顶部（`v-if="unavailable"` 分支之前，两类日期都能看到）：
  ```html
  <div v-if="holiday" class="flex items-center gap-2 rounded-lg px-3 py-2 mb-3"
       :class="holiday.type === 'holiday' ? 'bg-danger-subtle' : 'bg-surface-hover'">
    <span class="w-5 h-5 rounded-md flex items-center justify-center text-2xs font-semibold text-fg-inverse"
          :class="holiday.type === 'holiday' ? 'bg-danger' : 'bg-fg-muted'">
      {{ holiday.type === 'holiday' ? '休' : '班' }}
    </span>
    <span class="text-sm font-medium text-fg">{{ holiday.name }}</span>
    <span class="text-xs text-fg-muted">{{ holiday.type === 'holiday' ? '法定假日' : '调休补班' }}</span>
  </div>
  ```
- Sheet 的 `title` 保持现状（日期串），不改 `components/ui/Sheet.vue`。
- 色 token 全部复用现有（`bg-danger-subtle`/`text-danger`/`bg-fg-muted`/`text-fg-inverse`/`bg-surface-hover`），不新增 token。

## 4. 依赖与构建

- `cd client && npm install chinese-days`（→ `^1.5.9`，更新 `package.json` + `package-lock.json`）。
- 体积 ~20KB（gzip ~7KB），Vite 5 实测可打包（`module` 字段 ESM，见 research）。
- PWA：无接口契约变化；SW 预缓存随构建产物 hash 自动更新，无需改 `vite.config.js` 的 runtimeCaching。
- 部署：`cd client && npm run build` → 根 `Dockerfile` 的 `COPY client/dist/` → `docker compose build && docker compose up -d`。

## 5. 测试

- 新增 `e2e/holidays.spec.js`（ESM，遵循既有 spec 风格）：
  - `page.clock.install({ time: new Date('2026-10-01T12:00:00+08:00') })` 固定"今天"（Playwright 1.60 支持），再 `goto('/venues')`。
  - 断言 `[data-date="2026-10-01"]` 含「国庆节」且含「休」；`[data-date="2026-10-10"]` 含「班」；`[data-date="2026-10-08"]` 无 `.holiday-tag`。
  - 点 2026-10-01 格子 → DaySheet 出现「国庆节」「法定假日」。
  - 若 clock 假装定时器影响应用初始化（轮询挂在固定时钟上），退化方案：`page.addInitScript` 覆写 `Date`；仍不稳定则保留截图人工验证并记录。
- `cd client && npm run build`、`npx playwright test`（4 个 project：390/360 × light/dark）。
- 无前端单测 runner，不新建测试框架（遵循 frontend spec）。

## 6. 风险 / 回滚

| 风险 | 缓解 |
|---|---|
| 360px 格子拥挤、与监控徽标重叠 | 节日+监控同格隐藏圆点；AC4 截图门禁；微调 leading |
| 依赖体积 / 解析失败 | Vite 实测通过；~7KB gzip；构建即验证 |
| 数据范围外（2027+）无标记 | 不误报；npm 升级依赖即支持 |
| e2e 固定时钟脆弱 | 退化到 addInitScript 覆写 Date；记录并保留截图验证 |

**回滚**：删除 `client/src/utils/holiday.js`、`e2e/holidays.spec.js`，`git checkout -- BookingCalendar.vue DaySheet.vue package.json package-lock.json`。
