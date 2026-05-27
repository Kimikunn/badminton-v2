# 工作流示例

---

## 原理：双环境隔离机制

测试和生产共用一套代码，差异通过 **Vite 编译时常量** 控制，不是运行时 if/else。

### 编译时替换

```
Vite build --mode test  →  .env.test 加载
    import.meta.env.VITE_TEST_MODE   → "true"（字面量，不是变量）
    import.meta.env.VITE_ENABLE_X    → "true"

Vite build（默认 mode）→ .env.test 不加载
    import.meta.env.VITE_TEST_MODE   → undefined
    import.meta.env.VITE_ENABLE_X    → undefined
```

`import.meta.env` 的值在构建时被**内联替换**为字符串字面量。浏览器收到的 JS 里没有环境变量读取，只有常量比较。

### Tree-shaking 消除死代码

```js
const isTestMode = import.meta.env.VITE_TEST_MODE === 'true'
// 生产构建展开：const isTestMode = undefined === 'true'  →  false
```

因为 `isTestMode` 永远是 `false`，Vite/Rollup 的 tree-shaking 直接删除 `if (isTestMode)` 分支。`v-if="isTestMode"` 内的 DOM 元素不存在于生产 HTML 中。

### CSS 隔离的本质

CSS 本身没有"环境"概念——所有样式都在 CSS 文件里。隔离靠的是 DOM：

- **Vue scoped CSS**（`data-v-xxxx`）只作用于组件内部的 DOM 元素
- `v-if="isTestMode"` 为 `false` → 元素不渲染 → scoped 样式挂在空树上，无效果
- 生产构建中 `v-if` 包裹的 `<span>TEST</span>` 从不渲染，用户永远看不到

同样，灰度功能的 `v-if="enableCalendar"` 在生产构建里永远是 `false`，日历组件不渲染。上线时只需删掉 flag 判断，`v-if` 变为无条件渲染，`.env.test` 移除对应行，**不修改任何业务逻辑代码**。

### 三层控制

| 机制 | 控制什么 | 例子 |
|------|---------|------|
| `VITE_TEST_MODE` | 测试运维工具可见性 | TEST 徽标、烧瓶按钮、恢复数据 |
| `VITE_ENABLE_X` | 业务功能灰度开关 | 创建赛季、日历视图 |
| `isTestMode` | 测试专属行为（非灰度） | 删除赛季的 × 按钮 |

灰度功能上线后：删 flag → 删 `v-if` → `.env.test` 移除该行。不残留死代码。

---

## 正例：创建赛季

### 代码改动

| 文件 | 作用 |
|---|---|
| `constants/seasonPresets.js` | S1-S5 预设元数据（名称、规则、轮次、颜色） |
| `components/season/SeasonPresetManager.vue` | 创建向导：只展示「下一个可创建赛季」，确认后调 `seasonsStore.createSeason` |
| `stores/seasons.js` | `createSeason` + `deleteSeason` 方法 |
| `views/MatchHubView.vue` | 赛季区域加「创建赛季」按钮 |
| `server/src/services/seasonService.js` | S5 默认轮次 9（后端兜底） |

### 灰度阶段

`.env.test` 加 `VITE_ENABLE_SEASON_CREATE=true`，代码 `v-if="canCreateSeason"`。仅在测试环境可见，Playwright 验证创建、阻止重名、锁逻辑。

### 上线阶段

测试通过后：删除 `canCreateSeason` flag 和 `v-if`，功能无条件可用。`.env.test` 移除该行。部署生产，**不修改任何生产数据**。

### 关键决策

- **一次只建一个赛季**。`SeasonPresetManager` 用 `existingRuleIds` 排除已存在赛季，取第一个不在集合中的预设
- **前一赛季完成才解锁下一个**。`nextPreset` 检查预设列表中前一项的赛季状态是否为 `completed`
- **命名统一**。`buildPresetSeasonName(preset)` → `S{n}-{名称}`
- **功能开关只在灰度期存在**。上线后删除，不残留死代码

---

## 正例：删除赛季

### 代码改动

| 文件 | 作用 |
|---|---|
| `components/season/SeasonTabs.vue` | 新增 `deletable` prop，每个标签右侧渲染 × 图标，`event.stopPropagation` 防止触发选中 |
| `views/MatchHubView.vue` | 传 `:deletable="isTestMode"`，`@delete` 调 `handleDeleteSeason` |
| `composables/useConfirm.js` | 统一二次确认弹窗 |

### 关键决策

- **放在业务页面，不放烧瓶面板**。烧瓶只做测试运维（恢复数据），赛季创建/删除是业务功能
- **仅测试可见**。`:deletable="isTestMode"`，`isTestMode` 来自 `import.meta.env.VITE_TEST_MODE`，生产构建不渲染 ×
- **嵌入 SeasonTabs，不另起一行**。第一版在 SeasonTabs 下方多了一排删除按钮，赛季名重复显示。修正为内嵌到标签胶囊右侧
- **二次确认**。`handleDeleteSeason` 调 `confirmAction`，确认后 `seasonsStore.deleteSeason` + `matchesStore.init` + `seasonsStore.init`

### 上线过程

1. 测试环境验证创建→删除→重建闭环
2. 确认生产无 × 图标、无删除入口
3. 部署生产

---

## 反例：修改生产数据

### 做了什么
```
curl -X PUT :8088/api/seasons/S1776169502480 -d '{"status":"completed"}'
```
S4 实际进行中，为了让「创建 S5」按钮出现，手动标记完成。

### 问题
- 修改生产数据不经 git，不可追溯
- 绕过代码逻辑——如果按钮没出现，说明逻辑或数据状态不满足条件，应排查原因而非硬改数据
- 测试环境的价值就是验证：在测试环境完成 S4 后按钮应出现，确认后只部署代码

### 正确做法
代码逻辑要求 S4 完成才能建 S5 → 测试环境验证此逻辑 → 部署代码 → 用户打完 S4 后按钮自然出现。

---

## 反例：把业务功能塞进测试工具面板

### 做了什么
`AdminToolsSheet.vue`（烧瓶面板）同时放了「恢复生产数据」和「删除赛季」。

### 问题
- 烧瓶面板的定位是**测试运维能力**（恢复数据），不是测试功能大杂烩
- 创建赛季、删除赛季是业务功能，应放回对应业务页面
- 可复用组件不应为测试入口在文件名里写 `Test`

### 正确做法
- 烧瓶：只恢复生产数据
- 删除赛季：`SeasonTabs` 的 ×，`isTestMode` 控制可见
- 创建赛季：`MatchHubView` 的业务按钮，`VITE_ENABLE_SEASON_CREATE` 控制

---

## 反例：测试环境没测直接上生产

### 做了什么
```
npm run build && docker compose up -d --build
```
跳过 `build:test` 和 `:8090` 验证。

### 问题
- 生产构建不含测试能力，出问题只能直接操作数据库或服务器
- Playwright 是最后一道防线，略过等于放弃自动化验证

### 正确做法
每次改动：`build:test` → 部署测试 → Playwright → `build` → 部署生产。测试环境跑通再上线。

---

## 正例：场地页日历视图（灰度阶段）

### 代码改动

| 文件 | 作用 |
|---|---|
| `components/venue/BookingCalendar.vue` | 月历组件：7 列网格、订场圆点、点击日期弹出详情 Sheet |
| `views/VenueView.vue` | 订场记录卡片加 `SegmentedControl` 切换「列表/日历」 |
| `.env.test` | 加 `VITE_ENABLE_BOOKING_CALENDAR=true` |

### 灰度阶段

`.env.test` 加 `VITE_ENABLE_BOOKING_CALENDAR=true`，代码：

```js
const enableCalendar = import.meta.env.VITE_ENABLE_BOOKING_CALENDAR === 'true'
```

`SegmentedControl` 的 options 根据 flag 决定是否包含「日历」选项；生产构建无此 flag，`recordViewOptions` 只有「列表」，用户看不到日历入口。

### 部署流程

1. 自测：`build:test` → 部署 `:8090` → Playwright 自检
2. 告诉用户 `:8090` 已就绪，等用户在真实设备验证
3. 用户确认没问题后，再执行上线步骤

### 上线阶段

用户确认后：删除 `enableCalendar` flag 和条件判断，日历 Tab 无条件渲染。`.env.test` 移除 `VITE_ENABLE_BOOKING_CALENDAR`。部署生产。

### 关键决策

- **功能开关只在灰度期存在**。上线后删除，不残留死代码
- **SegmentedControl 单选项不渲染**。当 flag 关闭时 options 仅一项，组件隐藏避免无意义切换
- **不改后端**。日历纯前端，直接消费 `bookingsStore.records` 已有数据

---

## 反例：直接部署生产 + 未加功能开关

### 做了什么

开发场地页日历功能后：
```
npm run build && docker compose up -d --build  # 生产直接上线
```
同时未加 `VITE_ENABLE_BOOKING_CALENDAR` 功能开关，日历在生产直接可见。

### 问题（三重犯错）

1. **跳过测试环境验证**。没有先 `build:test` 部署 `:8090`，用户无法在测试环境实际操作确认。
2. **跳过用户确认**。AGENTS.md 开发流程第 4 步要求等待用户明确确认，直接跳到了第 5 步上线。
3. **未加功能开关**。新功能应通过 `VITE_ENABLE_X` flag 在 `.env.test` 中灰度，生产构建不可见。等到用户验证通过再删 flag 上线。

### 后果

- 生产环境出现了未经用户验证的功能
- 需要事后补救：补加 flag、重新构建部署生产来隐藏
- 如果功能有 bug，直接影响生产数据

### 正确做法

```
1. .env.test 加 VITE_ENABLE_BOOKING_CALENDAR=true
2. v-if 门控
3. build:test → 部署 :8090 → Playwright 自检
4. 告诉用户 :8090 就绪
5. 用户验证通过
6. 删 flag → build → 部署 :8088
```

### 根因分析

- AGENTS.md 的开发流程被读取但未执行。文档是给人（和 AI）遵循的，不是参考读物
- "构建通过 = 可以上线"的惯性思维。构建通过只说明代码无语法错误，不代表功能正确、不代表用户可以接受
- 功能开关模式被当作可选建议而非强制要求

---

## 反例：双层 Sheet 嵌套 + 开发者文案泄漏

### 做了什么
`SeasonPresetManager` 内部自己套了一个 `<Sheet>`，但 `MatchHubView` 外层也套了一个 `<Sheet>`。同时 `AdminToolsSheet` 对话卡片里写了"烧瓶按钮只保留测试环境运维功能"——这是开发者架构备注。

### 问题
- 点「创建赛季」同时弹出两个底部面板
- 用户看到的文案是写给开发者的

### 正确做法
- 被包裹的组件不自己套 Sheet，由调用方决定容器
- 文案面向最终用户
