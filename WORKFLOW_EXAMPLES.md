# 工作流示例

---

## 正例：创建赛季

### 代码改动

| 文件 | 作用 |
|---|---|
| `constants/seasonPresets.js` | S1-S5 预设元数据（名称、规则、轮次、颜色） |
| `components/season/SeasonPresetManager.vue` | 创建向导：只展示「下一个可创建赛季」，确认后调 `seasonsStore.createSeason` |
| `stores/seasons.js` | `createSeason` + `deleteSeason` 方法 |
| `views/MatchHubView.vue` | 赛季区域加「创建赛季」按钮，`VITE_ENABLE_SEASON_CREATE` 控制 |
| `server/src/services/seasonService.js` | S5 默认轮次 9（后端兜底） |

### 关键决策

- **一次只建一个赛季**。`SeasonPresetManager` 用 `existingRuleIds` 排除已存在赛季，取第一个不在集合中的预设，而非展示全部 5 个
- **前一赛季完成才解锁下一个**。`nextPreset` 检查预设列表中前一项的赛季状态是否为 `completed`
- **命名统一**。`buildPresetSeasonName(preset)` → `S{n}-{名称}`（如 `S5-异变秩序`），不再拼时间戳
- **功能开关与测试开关解耦**。`VITE_ENABLE_SEASON_CREATE` 控制业务灰度，`VITE_TEST_MODE` 控制测试运维能力，两个独立 `v-if`

### 上线过程

1. 测试环境：`VITE_ENABLE_SEASON_CREATE=true`，Playwright 验证创建、阻止重名、锁逻辑
2. 确认无误后改 `build` script 加 `VITE_ENABLE_SEASON_CREATE=true`
3. 部署生产。**不修改任何生产赛季数据**——S4 完成后按钮自然出现

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
curl -X PUT :8089/api/seasons/S1776169502480 -d '{"status":"completed"}'
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

## 反例：双层 Sheet 嵌套 + 开发者文案泄漏

### 做了什么
`SeasonPresetManager` 内部自己套了一个 `<Sheet>`，但 `MatchHubView` 外层也套了一个 `<Sheet>`。同时 `AdminToolsSheet` 对话卡片里写了"烧瓶按钮只保留测试环境运维功能"——这是开发者架构备注。

### 问题
- 点「创建赛季」同时弹出两个底部面板
- 用户看到的文案是写给开发者的

### 正确做法
- 被包裹的组件不自己套 Sheet，由调用方决定容器
- 文案面向最终用户
