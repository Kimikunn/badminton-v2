# 前端优化清单与验证记录

> 创建日期：2026-05-25  
> 目的：集中记录 BAD Club v2 前端待优化点、优先级、实施状态，以及每个优化点的 Playwright 前后对照结果。
>
> 跨端/后端技术债另见：`CROSS_STACK_TECH_DEBT.md`。

---

## 0. 执行约定

每个优化点按以下流程执行，不跳步：

1. **确认优化点**
   - 明确问题、目标、影响范围。
   - 标记风险等级。

2. **优化前基线**
   - 使用 Playwright 或等价页面验证方式记录当前行为。
   - 尽量保留截图、控制台错误、网络请求、关键 DOM 状态。
   - 如果是无明显 UI 的问题，记录 API 请求参数、响应和 Store 状态变化。

3. **实施修改**
   - 小步提交式修改。
   - 避免一次混改多个无关问题。

4. **验证**
   - 前端至少执行：
     ```bash
     cd client && npm run build
     ```
   - 涉及后端接口/数据流时执行：
     ```bash
     cd server && npm test
     ```
   - 使用 Playwright 复测同一流程。

6. **部署**
   - 每个优化点完成后重新构建并部署生产与测试环境：
     ```bash
     docker compose -p badminton-v2-prod up -d --build
     docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build
     ```
   - 部署后验证：
     ```bash
     curl -fsS http://127.0.0.1:8088/api/health
     curl -fsS http://127.0.0.1:8090/api/health
     ```

5. **准确反馈差异**
   - 每完成一项，都向用户反馈：
     - 优化前行为
     - 优化后行为
     - 修改文件
     - 验证命令与结果
     - 截图/行为差异
     - 剩余风险

---

## 1. 优先级说明

| 优先级 | 含义 |
|---|---|
| P0 | 明确 bug、可能导致功能错误或误导用户 |
| P1 | 体验一致性、交互质量、可维护性明显收益 |
| P2 | 文档同步、结构整理、代码清洁度提升 |

状态：

| 状态 | 含义 |
|---|---|
| TODO | 未开始 |
| BASELINE | 已记录优化前基线 |
| DOING | 修改中 |
| VERIFYING | 验证中 |
| DONE | 已完成并反馈 |
| BLOCKED | 阻塞 |

---

## 2. 待优化清单

### P0-01：修复 `seasonsStore.fetchRounds()` 查询参数传递

- **状态**：DONE
- **问题位置**：`client/src/stores/seasons.js`
- **现状**：
  - 当前调用：
    ```js
    api.get('/rounds', { params: { seasonId } })
    ```
  - 但 `api.get` 封装为：
    ```js
    api.get(url, params) => client.get(url, { params })
    ```
  - 实际请求可能变成：
    ```text
    /api/rounds?params[seasonId]=S1
    ```
    而不是：
    ```text
    /api/rounds?seasonId=S1
    ```
- **影响**：
  - 调用 `fetchRounds(seasonId)` 时可能没有按赛季过滤。
  - 删除/编辑轮次后刷新局部轮次列表可能拉回全部轮次，造成前端状态污染。
- **目标**：
  - 改为：
    ```js
    api.get('/rounds', { seasonId })
    ```
- **验证方式**：
  - Playwright 或浏览器请求监听确认请求 URL。
  - 删除/编辑轮次后确认只刷新当前赛季轮次。
- **风险等级**：低。

---

### P0-02：修正“创建轮次预览对阵”与后端实际生成不一致

- **状态**：DONE
- **问题位置**：
  - `client/src/views/MatchHubView.vue`
  - `server/src/services/roundCreationService.js`
- **现状**：
  - 前端创建轮次 Sheet 中会随机生成 `previewPairings`。
  - 后端实际创建轮次时没有接收这组预览对阵，而是按 `participants` 固定顺序生成。
- **影响**：
  - 用户看到的“预览对阵”可能与创建后的真实比赛不一致。
  - 属于高误导性 UI。
- **可选方案**：
  1. **短期低风险**：移除“随机预览/换一组”交互，文案改为“系统将按固定轮换生成对阵”。
  2. **完整方案**：前端提交 pairings，后端验证并按提交对阵创建比赛。
- **建议**：
  - 先做方案 1，避免误导。
  - 后续如果确实需要手动调整对阵，再做完整后端支持。
- **验证方式**：
  - Playwright 对比创建轮次 Sheet 和创建后的比赛列表。
- **风险等级**：中。

---

### P1-01：统一替换原生 `confirm()` 删除确认

- **状态**：DONE
- **问题位置**：
  - `client/src/views/ScoringView.vue`
  - `client/src/views/MatchHubView.vue`
  - `client/src/views/SeasonOverview.vue`
  - `client/src/views/VenueView.vue`
  - `client/src/views/MatchDetailView.vue`
- **现状**：
  - 多处使用浏览器原生 `confirm()`。
- **影响**：
  - 视觉与 Apple 原生 + 社区温度风格不一致。
  - 移动端浏览器原生弹窗体验突兀。
  - 不利于 Playwright 精准断言和截图对照。
- **目标**：
  - 新增统一确认组件/Composable，例如：
    - `ConfirmSheet.vue`
    - `useConfirm()`
  - 支持标题、说明、危险操作按钮、取消按钮。
- **验证方式**：
  - Playwright 截图对比删除比赛/删除场地等流程。
  - 验证取消不会触发 API，确认才触发 API。
- **风险等级**：中。

---

### P1-02：优化 Admin Token 输入体验

- **状态**：DONE
- **问题位置**：
  - `client/src/api/client.js`
- **现状**：
  - 写接口 401 后使用原生 `window.prompt()` 输入令牌。
- **影响**：
  - 体验与应用 UI 不一致。
  - 无法较好展示说明、错误状态、清除令牌等。
- **目标**：
  - 用应用内 Sheet/Dialog 替代 prompt。
  - 提供：
    - 输入框
    - 保存到本机说明
    - 重试
    - 清除旧令牌
- **注意**：
  - Axios 拦截器里直接调用 Vue 组件有架构限制，可能需要事件总线或全局 auth store。
- **验证方式**：
  - Playwright 模拟写接口返回 401。
  - 验证弹出应用内授权输入，而不是浏览器 prompt。
- **风险等级**：中高。

---

### P1-03：拆分 `ScoringView.vue`

- **状态**：DOING
- **问题位置**：`client/src/views/ScoringView.vue`
- **现状**：
  - 记分页同时承载：
    - 比赛启动
    - 实时比分输入
    - S5 抵抗/贯穿
    - 结束局确认
    - 编辑已完成局
    - 撤回局
    - 返回时保存比分
- **影响**：
  - 页面组件偏重，后续规则扩展和交互优化容易引入回归。
- **目标拆分方向**：
  - `useScoringSession()`
  - `useGameRuleUi()`
  - `GameScoreInput.vue`
  - `CompletedGamesList.vue`
  - `EndGameConfirmSheet.vue`
- **执行策略**：
  - 先做低风险展示组件拆分，保证 UI 和行为不变。
  - 再做 Composable 逻辑拆分。
  - 最后再处理开始比赛、结束局、撤回局、编辑比分后的局部刷新优化。
- **验证方式**：
  - Playwright 覆盖：
    - 输入非法比分提示
    - 合法比分结束局
    - S5 抵抗局选择胜方
    - 撤回最后一局
- **风险等级**：中高。

---

### P1-04：拆分 `MatchHubView.vue`

- **状态**：TODO
- **问题位置**：`client/src/views/MatchHubView.vue`
- **现状**：
  - 同时承载：
    - 赛季选择
    - 当前轮展示
    - 创建轮次
    - 轮次删除/编辑
    - 赛季比赛历史
    - 友谊赛创建
    - 友谊赛历史
- **影响**：
  - 组件职责偏多，和 `selectSeason` 曾被误删的历史问题相关。
- **目标拆分方向**：
  - `SeasonMatchPanel.vue`
  - `CreateRoundSheet.vue`
  - `RoundMatchList.vue`
  - `FriendlyMatchPanel.vue`
  - `CreateFriendlySheet.vue`
- **验证方式**：
  - Playwright 覆盖赛季/友谊赛 Tab 切换、创建友谊赛、创建轮次入口。
- **风险等级**：中高。

---

### P1-05：前端 Store/API 封装一致性整理

- **状态**：PARTIAL-DONE
- **问题位置**：
  - `client/src/api/client.js`
  - `client/src/stores/*`
- **现状示例**：
  - `venuesStore` 仍读取 `/bookings/venues`，但后端已统一支持 `/venues`。
  - 部分 Store 只返回 `res.success`，没有返回 `res.data`，页面只能重新 init。
  - 局部刷新策略不统一。
- **目标**：
  - 统一使用新 API 边界。
  - 明确 Store 方法返回值。
  - 减少不必要的全量 `init()`。
- **已完成范围**：
  - `venuesStore` 场地 CRUD 局部更新。
  - `bookingsStore` 订场记录 CRUD 局部更新。
  - 核心 Store `initialized/force` 初始化策略。
  - 创建轮次后通过响应回填赛季、轮次和比赛，避免全量刷新。
- **暂缓范围**：
  - `ScoringView.vue` 中开始比赛、结束局、撤回局、编辑已完成局后的局部刷新。
  - 暂缓原因：这些操作会联动比赛、局、轮次、赛季规则事件，不是普通 CRUD；需要放入 P1-03/P1-06 记分页专项里按状态机单独验证。
- **验证方式**：
  - Playwright + 网络请求计数，对比操作前后请求数量和响应数据。
- **风险等级**：中。

---

### P1-06：记分页实时保存/离开保存体验优化

- **状态**：TODO
- **问题位置**：`client/src/views/ScoringView.vue`
- **现状**：
  - 返回时会尝试保存当前比分。
  - 但用户不一定感知“已保存/未保存”。
  - 开始比赛、结束局、撤回局、编辑已完成局后仍使用全量刷新兜底：
    ```js
    matchesStore.init({ force: true })
    seasonsStore.init({ force: true })
    ```
- **目标**：
  - 明确保存状态：
    - 未保存
    - 保存中
    - 已保存
    - 保存失败
  - 可考虑 debounce 自动保存。
  - 在完成记分页状态机回归后，再评估是否把上述全量刷新改成精确回填。
- **验证方式**：
  - Playwright 输入比分后监听 `PUT /games/:id/score`。
  - 验证离开页面前比分已保存。
- **风险等级**：中。

---

### P1-07：预设赛季创建入口功能开关

- **状态**：DONE
- **问题位置**：
  - `client/src/App.vue`
  - `client/src/components/admin/AdminToolsSheet.vue`
  - `client/src/components/season/SeasonPresetManager.vue`
  - `client/src/stores/seasons.js`
- **现状**：
  - 测试环境已有烧瓶入口，但只包含“从生产环境恢复”。
  - 测试环境无法直接创建 S1-S5 预设赛季，必须依赖已有 mock 数据或手工调 API。
  - 如果把所有测试功能组件都用 `Test*` 命名，未来同一能力迁入正式管理后台时需要重命名/搬迁，容易引入重复文件。
- **目标**：
  - 烧瓶入口只保留恢复生产数据。
  - 比赛页增加自然的“+ 创建赛季”按钮，不新增测试/后台感的卡片或说明。
  - 创建赛季按真实上线标准开发，但当前通过 `VITE_ENABLE_SEASON_CREATE` 功能开关只在测试环境打开；未来正式上线只改开关。
  - 创建时复用正式赛季 API，默认固定 4 名成员、固定规则、固定总轮次和赛制，仅允许确认信息与选择颜色。
  - 组件按业务能力命名：`VITE_TEST_MODE` 只控制测试运维入口，不控制业务功能；创建赛季由独立功能开关控制，不把可复用业务组件命名为 `Test*`。
- **验证方式**：
  - Playwright 打开测试环境烧瓶入口，确认只包含恢复生产数据，不包含创建赛季。
  - Playwright 打开测试比赛页，确认可见“+ 创建赛季”和 S1-S5 预设赛季。
  - Playwright 打开正式比赛页，确认当前不可见“+ 创建赛季”。
  - 选择 S1 后确认信息包含：固定 4 人、7 轮、三局两胜。
  - 点击确认创建后拦截 `POST /api/seasons`，校验返回赛季为 `ruleId=standard` 且 participants 为 4 人。
  - 测试结束删除刚创建的赛季，保持测试库稳定。
- **风险等级**：中。

---

### P2-01：同步更新项目文档

- **状态**：TODO
- **问题位置**：
  - `AGENTS.md`
  - `DEVELOPMENT.md`
  - 可能新增/更新本文件
- **现状**：
  - 文档里仍有“前端无 Tailwind”的描述，但实际使用 Tailwind v4。
  - 部分页面仍标注“占位”，与当前实现不完全一致。
- **目标**：
  - 保持文档作为后续 AI/人类开发的可靠上下文。
- **验证方式**：
  - 文档检查，不需要 Playwright。
- **风险等级**：低。

---

### P2-02：增强 Playwright 回归用例结构

- **状态**：TODO
- **问题位置**：`e2e/`
- **现状**：
  - 已有 smoke、截图、对比度、记分验证脚本。
  - 但很多脚本偏一次性验证，缺少围绕优化点的稳定回归用例。
- **目标**：
  - 增加按业务流程组织的测试：
    - `match-hub.spec.js`
    - `scoring.spec.js`
    - `venues.spec.js`
  - 优先使用用户可见文本和 role locator，减少脆弱选择器。
- **验证方式**：
  - `npx playwright test` 或指定 spec。
- **风险等级**：中。

---

## 3. 当前建议执行顺序

1. P0-01：修复 `fetchRounds` 查询参数。
2. P0-02：修正创建轮次预览与真实结果不一致。
3. P1-01：统一删除确认交互。
4. P1-05：Store/API 一致性整理。
5. P1-03：拆分 `ScoringView.vue`。
6. P1-04：拆分 `MatchHubView.vue`。
7. P1-02：Admin Token 输入体验。
8. P1-07：测试环境预设赛季创建入口。
9. P1-06：记分页保存状态。
10. P2-02：增强 Playwright 回归结构。
11. P2-01：同步文档。

---

## 4. 完成记录模板

后续每完成一个优化点，按此模板追加记录：

```md
### YYYY-MM-DD：优化点编号 - 标题

- 状态：DONE
- 修改文件：
  - `...`
- 优化前：
  - ...
- 优化后：
  - ...
- Playwright / 验证：
  - 命令：`...`
  - 结果：...
  - 截图/证据：...
- 构建/测试：
  - `cd client && npm run build`：通过/失败
  - `cd server && npm test`：通过/失败/未涉及
- 剩余风险：
  - ...
```

---

## 5. 完成记录

### 2026-05-26：P1-07 - 预设赛季创建入口功能开关

- 状态：DONE
- 修改文件：
  - `client/src/App.vue`
  - `client/src/components/admin/AdminToolsSheet.vue`
  - `client/src/components/season/SeasonPresetManager.vue`
  - `client/src/constants/seasonPresets.js`
  - `client/src/stores/seasons.js`
  - `client/src/composables/useAppInit.js`
  - `playwright.config.js`
  - `e2e/season-management.spec.js`
  - `AGENTS.md`
  - `DEVELOPMENT.md`
- 优化前：
  - 测试环境烧瓶入口只有“从生产环境恢复”。
  - 不能在 UI 内直接创建 S1-S5 预设赛季。
  - `initAllStores({ force: true })` 被全局已初始化守卫提前拦截，测试库恢复/创建后存在刷新不彻底风险。
- 纠正后的优化后：
  - 烧瓶入口仍只保留“恢复生产数据”。
  - 比赛页新增自然的“+ 创建赛季”按钮，位置在赛季选择区域旁边。
  - 创建赛季按正式功能结构实现，但当前通过 `VITE_ENABLE_SEASON_CREATE` 只在测试构建打开，生产构建暂不显示。
  - S1-S5 规则、轮次、赛制按固定预设填充；成员默认取当前 4 名成员；创建前展示确认信息；颜色可选择。
  - 可复用组件不使用 `Test*` 文件名：测试运维入口由 `VITE_TEST_MODE` 控制，创建赛季由 `VITE_ENABLE_SEASON_CREATE` 控制。
  - `seasonsStore` 新增 `createSeason/deleteSeason`，创建走正式 `/api/seasons`。
  - 修正 `useAppInit` 的 `force` 逻辑，强制刷新不再被已初始化状态拦截。
- Playwright / 验证：
  - `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8090 PLAYWRIGHT_EXPECT_SEASON_CREATE=1 PLAYWRIGHT_ENABLE_SEASON_MANAGEMENT_WRITE=1 npx playwright test e2e/season-management.spec.js --project=light`：通过。
  - `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8088 PLAYWRIGHT_EXPECT_SEASON_CREATE_HIDDEN=1 npx playwright test e2e/season-management.spec.js --project=light`：通过，未写入生产数据。
  - 验证内容：打开测试工具确认不含创建赛季；测试比赛页可见“+ 创建赛季”；生产比赛页不可见“+ 创建赛季”；测试环境确认 S1 信息并创建赛季；断言 `POST /api/seasons` 返回 4 名 participants 和 `ruleId=standard`；测试结束删除创建的赛季。
  - `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8088 npx playwright test e2e/smoke.spec.js --project=light`：通过，4 passed。
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd client && npm run build:test`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过。
  - `docker compose -p badminton-v2-prod up -d --build`：通过。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 本次先完成“创建赛季”。删除赛季 UI 仍需作为下一步单独补齐，避免和创建流程混在一起。

### 2026-05-25：P0-01 - 修复 `fetchRounds()` 查询参数传递

- 状态：DONE
- 修改文件：
  - `client/src/stores/seasons.js`
- 优化前：
  - `fetchRounds(seasonId)` 调用 `api.get('/rounds', { params: { seasonId } })`。
  - 因为 `api.get` 内部已经会把第二个参数包成 axios 的 `{ params }`，实际请求 URL 变成：
    ```text
    /api/rounds?params%5BseasonId%5D=S1
    ```
  - 后端 `roundsController.getAll` 读取的是 `req.query.seasonId`，因此无法识别嵌套的 `params[seasonId]`。
- 优化后：
  - `fetchRounds(seasonId)` 改为调用 `api.get('/rounds', { seasonId })`。
  - 实际请求 URL 变为：
    ```text
    /api/rounds?seasonId=S1
    ```
  - 后端可以正确按赛季过滤轮次。
- Playwright / 验证：
  - 优化前请求基线：
    ```text
    http://127.0.0.1:5173/api/rounds?params%5BseasonId%5D=S1
    ```
  - 优化后请求复测：
    ```text
    http://127.0.0.1:5173/api/rounds?seasonId=S1
    ```
  - 截图证据：
    - `/tmp/p0-01-before.png`
    - `/tmp/p0-01-after.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - 已在 P0-02 完成后统一部署到生产 `:8088` 与测试 `:8090`。
- 剩余风险：
  - 本次只修复参数传递；调用 `fetchRounds` 后的局部刷新策略仍可在后续 P1-05 中统一整理。

### 2026-05-25：P0-02 - 修正创建轮次预览与实际生成不一致

- 状态：DONE
- 修改文件：
  - `client/src/views/MatchHubView.vue`
- 优化前：
  - 创建轮次 Sheet 中的预览对阵由前端随机生成。
  - 用户可点击“重新随机”改变预览。
  - 但确认创建时提交体不包含预览对阵，后端仍按 `roundCreationService.generatePairings()` 的固定参赛名单顺序生成比赛。
  - Playwright 基线示例：
    ```json
    {
      "previewBefore": [
        "M1王铮昊/张逸骋 vs 赵沂/胡肖涛",
        "M2王铮昊/赵沂 vs 张逸骋/胡肖涛",
        "M3王铮昊/胡肖涛 vs 张逸骋/赵沂"
      ],
      "previewAfterShuffle": [
        "M1赵沂/王铮昊 vs 张逸骋/胡肖涛",
        "M2赵沂/张逸骋 vs 王铮昊/胡肖涛",
        "M3赵沂/胡肖涛 vs 王铮昊/张逸骋"
      ],
      "postedBody": {
        "seasonId": "S1",
        "roundNo": 1
      }
    }
    ```
- 优化后：
  - 预览对阵改为固定生成，并与后端当前规则保持一致：
    - 标准轮次：按赛季 `participants` 顺序生成三场。
    - S4 第 5-7 轮组合赛：按后端 `getS4ComboPairing()` 逻辑生成一场 PA7 组合赛预览。
  - 移除“重新随机”按钮，避免用户误以为随机预览会提交到后端。
  - 增加说明文案：
    ```text
    按赛季参赛名单固定生成，确认后将与下列对阵一致。
    ```
- Playwright / 验证：
  - 优化后复测结果：
    ```json
    {
      "preview": [
        "M1赵沂/胡肖涛 vs 王铮昊/张逸骋",
        "M2赵沂/王铮昊 vs 胡肖涛/张逸骋",
        "M3赵沂/张逸骋 vs 胡肖涛/王铮昊"
      ],
      "note": "按赛季参赛名单固定生成，确认后将与下列对阵一致。",
      "randomButtonCount": 0,
      "postedBody": {
        "seasonId": "S1",
        "roundNo": 1
      }
    }
    ```
  - 截图证据：
    - `/tmp/p0-02-before-sheet.png`
    - `/tmp/p0-02-after-sheet.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 前端仍是“镜像后端规则”。如果后端未来调整轮次生成逻辑，需要同步更新前端预览。
  - 更彻底的方案是后端提供 `preview round pairings` API 或让创建接口显式接收并验证 pairings；该能力可后续单独规划。

### 2026-05-25：P0-02 修正补丁 - 恢复随机对阵并让后端按预览创建

- 状态：DONE
- 背景：
  - 用户明确指出：创建轮次时需要“对成员进行随机”，不能删除随机功能。
  - 上一次 P0-02 的处理只解决了“预览不等于真实创建”的问题，但误删了用户需要的“随机成员”能力。
  - 正确修正方向：保留随机预览，并把当前预览的 pairings 提交给后端，由后端验证后按该预览创建比赛。
- 修改文件：
  - `client/src/views/MatchHubView.vue`
  - `server/src/controllers/roundsController.js`
  - `server/src/services/roundService.js`
  - `server/src/services/roundCreationService.js`
  - `server/test/roundCreation.test.js`
- 优化前：
  - 创建轮次 Sheet 不再有“重新随机”按钮。
  - 提交体只有：
    ```json
    {
      "seasonId": "S1",
      "roundNo": 1
    }
    ```
  - 无法满足随机成员生成对阵的产品需求。
- 优化后：
  - 恢复“重新随机”按钮。
  - 文案改为：
    ```text
    随机生成对阵，可重新随机；确认后将按当前预览创建。
    ```
  - 前端确认创建时提交当前预览：
    ```json
    {
      "seasonId": "S1",
      "roundNo": 1,
      "pairings": [
        { "teamA": ["p2", "p4"], "teamB": ["p3", "p1"] },
        { "teamA": ["p2", "p3"], "teamB": ["p4", "p1"] },
        { "teamA": ["p2", "p1"], "teamB": ["p4", "p3"] }
      ]
    }
    ```
  - 后端新增 `pairings` 验证：
    - 标准轮次必须 3 场。
    - 每场必须是双打 2v2。
    - 不允许同场重复选手。
    - 不允许非本赛季选手。
    - 同一轮内搭档组合不能重复。
  - 验证通过后，后端按提交的 pairings 创建比赛。
- Playwright / 验证：
  - 复测结果：
    ```json
    {
      "previewBefore": [
        "M1赵沂/胡肖涛 vs 王铮昊/张逸骋",
        "M2赵沂/王铮昊 vs 胡肖涛/张逸骋",
        "M3赵沂/张逸骋 vs 胡肖涛/王铮昊"
      ],
      "previewAfterShuffle": [
        "M1胡肖涛/张逸骋 vs 王铮昊/赵沂",
        "M2胡肖涛/王铮昊 vs 张逸骋/赵沂",
        "M3胡肖涛/赵沂 vs 张逸骋/王铮昊"
      ],
      "note": "随机生成对阵，可重新随机；确认后将按当前预览创建。",
      "randomButtonCount": 1
    }
    ```
  - 截图证据：
    - `/tmp/p0-02-random-restored.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：通过，55 passed / 0 failed。
- 剩余风险：
  - 当前只支持标准轮次自定义随机 pairings。
  - S4 第 5-7 轮组合赛仍按赛季规则固定生成，不支持随机 pairings。

### 2026-05-25：P1-01 - 统一替换原生 `confirm()` 删除确认

- 状态：DONE
- 修改文件：
  - `client/src/composables/useConfirm.js`
  - `client/src/components/ui/ConfirmSheet.vue`
  - `client/src/App.vue`
  - `client/src/views/ScoringView.vue`
  - `client/src/views/MatchHubView.vue`
  - `client/src/views/SeasonOverview.vue`
  - `client/src/views/VenueView.vue`
  - `client/src/views/MatchDetailView.vue`
- 优化前：
  - 删除比赛、删除轮次、删除场地、删除订场记录、撤回局等操作使用浏览器原生 `confirm()`。
  - Playwright 基线捕获到浏览器 dialog：
    ```json
    {
      "dialogs": [
        {
          "type": "confirm",
          "message": "删除比赛？"
        }
      ]
    }
    ```
- 优化后：
  - 新增全局 `useConfirm()`，返回 Promise，业务代码可 `await confirmAction(...)`。
  - 新增全局 `ConfirmSheet`，挂载在 `App.vue`，使用项目既有 `Sheet` + `Button` 风格。
  - 所有视图中的原生 `confirm()` 已替换为应用内确认 Sheet。
  - `rg "confirm\\(" client/src` 只剩 `useConfirm.js` 内部函数定义。
- Playwright / 验证：
  - 优化后复测删除友谊赛：
    ```json
    {
      "dialogs": [],
      "sheetTitle": "删除比赛",
      "sheetMessage": "确认删除这场比赛？",
      "deletesAfterCancel": [],
      "deletesAfterConfirm": ["/matches/F-1"]
    }
    ```
  - 说明：
    - 不再触发浏览器原生 dialog。
    - 点击“取消”不会发送 DELETE。
    - 点击“删除”才发送 DELETE。
  - 截图证据：
    - `/tmp/p1-01-before-native-confirm.png`
    - `/tmp/p1-01-after-confirm-sheet.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 当前统一的是确认交互本身；更复杂的二次确认（例如输入文字确认）暂未实现。
  - `window.prompt()` 输入 Admin Token 仍存在，后续在 P1-02 单独优化。

### 2026-05-25：P1-02 - 优化 Admin Token 输入体验

- 状态：DONE
- 修改文件：
  - `client/src/composables/useAdminTokenPrompt.js`
  - `client/src/components/ui/AdminTokenSheet.vue`
  - `client/src/api/client.js`
  - `client/src/App.vue`
- 优化前：
  - 写接口遇到 `401 UNAUTHORIZED` 时，Axios 拦截器调用浏览器原生 `window.prompt()`。
  - Playwright 基线：
    ```json
    {
      "dialogs": [
        {
          "type": "prompt",
          "message": "请输入写入权限令牌",
          "defaultValue": ""
        }
      ],
      "requests": [
        { "url": "http://127.0.0.1:5173/api/venues", "token": "" },
        { "url": "http://127.0.0.1:5173/api/venues", "token": "secret-token" }
      ]
    }
    ```
- 优化后：
  - 新增全局 `requestAdminToken()`，Axios 拦截器可 `await` 应用内授权输入。
  - 新增 `AdminTokenSheet` 并挂载到 `App.vue`。
  - 写接口 401 后显示应用内 Sheet：
    - 标题：`写入权限`
    - 文案：`当前操作需要写入权限。请输入令牌后将自动重试。`
    - 输入框：password
    - 按钮：`取消` / `保存并重试`
  - 输入后仍沿用原有逻辑：
    - 保存到 `localStorage badclub:adminToken`
    - 设置 `x-admin-token`
    - 自动重试原请求一次
- Playwright / 验证：
  - 复测结果：
    ```json
    {
      "dialogs": [],
      "sheetMessage": "当前操作需要写入权限。请输入令牌后将自动重试。",
      "requests": [
        { "url": "http://127.0.0.1:5173/api/venues", "token": "" },
        { "url": "http://127.0.0.1:5173/api/venues", "token": "secret-token" }
      ],
      "result": {
        "success": true,
        "data": { "id": "v1", "name": "球馆" }
      },
      "stored": "secret-token"
    }
    ```
  - 截图证据：
    - `/tmp/p1-02-before-native-prompt.png`
    - `/tmp/p1-02-after-token-sheet.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 当前 Sheet 只负责首次输入与重试；没有单独做“管理/清除 token”的设置入口。
  - `Input` 组件的 label 尚未通过 `for/id` 与 input 绑定，Playwright 暂用 placeholder 定位；可在后续无障碍优化中统一改进。

### 2026-05-25：P1-05a - 统一场地前端 API 到 `/venues`

- 状态：DONE
- 修改文件：
  - `client/src/stores/venues.js`
  - `client/src/views/VenueView.vue`
- 优化前：
  - 前端场地读取和 CRUD 仍使用兼容旧路径 `/bookings/venues`。
  - Playwright 基线：
    ```json
    {
      "requests": [
        { "method": "GET", "path": "/bookings/venues", "token": "" },
        { "method": "GET", "path": "/bookings/venues", "token": "" },
        { "method": "POST", "path": "/bookings/venues", "token": "token" },
        { "method": "GET", "path": "/bookings/venues", "token": "" }
      ]
    }
    ```
- 优化后：
  - `venuesStore.init()` 改为读取 `/venues`。
  - `VenueView` 场地新增、编辑、删除改为：
    - `POST /venues`
    - `PUT /venues/:id`
    - `DELETE /venues/:id`
  - 前端源码中不再出现 `/bookings/venues`。
- Playwright / 验证：
  - 复测结果：
    ```json
    {
      "requests": [
        { "method": "GET", "path": "/venues", "token": "" },
        { "method": "GET", "path": "/venues", "token": "" },
        { "method": "POST", "path": "/venues", "token": "token" },
        { "method": "GET", "path": "/venues", "token": "" }
      ]
    }
    ```
  - 截图证据：
    - `/tmp/p1-05-before-venues-api.png`
    - `/tmp/p1-05-after-venues-api.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - `/bookings/venues` 后端兼容路由仍保留，避免旧客户端失效。
  - P1-05 还会继续整理其他 Store 方法返回值和局部刷新策略。
  - 已同步记录到 `CROSS_STACK_TECH_DEBT.md` 的 `CS-001`。

### 2026-05-25：P1-05b - 移除新增订场记录后的冗余配置更新

- 状态：DONE
- 修改文件：
  - `client/src/stores/bookings.js`
- 优化前：
  - 后端 `POST /bookings/records` 创建订场记录时，已经会推进 `booking_config.current_person_index`。
  - 前端 `bookingsStore.addRecord()` 在 POST 成功后，又本地计算下一位，并额外发送：
    ```text
    PUT /bookings/config
    ```
  - Playwright 基线：
    ```json
    {
      "requests": [
        { "method": "POST", "path": "/bookings/records" },
        { "method": "PUT", "path": "/bookings/config", "body": { "currentPersonIndex": 1 } }
      ]
    }
    ```
- 优化后：
  - 保留前端本地轮换 UI 更新。
  - 移除冗余 `PUT /bookings/config`。
  - `addRecord()` 返回后端创建的记录数据，而不是只返回 boolean，为后续局部刷新整理打基础。
- Playwright / 验证：
  - 复测结果：
    ```json
    {
      "requests": [
        { "method": "POST", "path": "/bookings/records" }
      ],
      "nextText": "下一个：胡肖涛"
    }
    ```
  - 说明：
    - 新增订场记录只发送一次写请求。
    - 本地轮换仍从赵沂推进到胡肖涛。
  - 截图证据：
    - `/tmp/p1-05b-before-booking-add.png`
    - `/tmp/p1-05b-after-booking-add.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 当前前端依然是“本地镜像”后端轮换推进结果；如果后端未来返回 config，可直接用后端返回值替换本地计算。
  - 初始加载阶段存在重复 `bookingsStore.init()` 调用，后续可继续整理。

### 2026-05-25：P1-05c - 去除 VenueView 初始重复加载

- 状态：DONE
- 修改文件：
  - `client/src/stores/bookings.js`
  - `client/src/stores/venues.js`
  - `client/src/views/VenueView.vue`
- 优化前：
  - `useAppInit()` 已在应用启动时加载 `bookingsStore` 与 `venuesStore`。
  - `VenueView.onMounted()` 又调用一次：
    ```js
    bookingsStore.init()
    venuesStore.init()
    ```
  - Playwright 基线中同类 GET 成对出现：
    ```json
    [
      { "method": "GET", "path": "/venues" },
      { "method": "GET", "path": "/venues" },
      { "method": "GET", "path": "/bookings/config" },
      { "method": "GET", "path": "/bookings/records" },
      { "method": "GET", "path": "/bookings/config" },
      { "method": "GET", "path": "/bookings/records" }
    ]
    ```
- 优化后：
  - `bookingsStore` 和 `venuesStore` 增加 `initialized` 状态。
  - `init()` 增加重复加载保护：
    ```js
    if ((initialized.value || loading.value) && !options.force) return
    ```
  - 保存/删除等需要强制刷新数据的地方改为：
    ```js
    init({ force: true })
    ```
- Playwright / 验证：
  - 复测进入 `/venues`：
    ```json
    {
      "requests": [
        { "method": "GET", "path": "/venues" },
        { "method": "GET", "path": "/bookings/config" },
        { "method": "GET", "path": "/bookings/records" }
      ]
    }
    ```
  - 说明：
    - 首次进入场地页只保留必要的 3 个 GET。
    - 不再重复请求场地、订场配置和订场记录。
  - 截图证据：
    - `/tmp/p1-05c-after-init-dedupe.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 目前仅为 `bookingsStore` 与 `venuesStore` 增加初始化保护。
  - 其他 Store 是否也需要统一 `initialized/force` 模式，可在后续 P1-05 子项继续整理。

### 2026-05-25：P1-05d - 核心 Store 统一防重复初始化与强制刷新

- 状态：DONE
- 修改文件：
  - `client/src/stores/club.js`
  - `client/src/stores/players.js`
  - `client/src/stores/titles.js`
  - `client/src/stores/matches.js`
  - `client/src/stores/seasons.js`
  - `client/src/composables/useAppInit.js`
  - `client/src/composables/useSeasonAction.js`
  - `client/src/views/ScoringView.vue`
  - `client/src/views/MatchDetailView.vue`
  - `client/src/views/MatchHubView.vue`
  - `client/src/views/SeasonOverview.vue`
- 优化前：
  - 页面组件和全局初始化都可能调用同一个 Store 的 `init()`。
  - 旧模式没有明确区分：
    - “页面刚进来，已经有数据，不需要再拉一次”
    - “刚刚新增/删除/记分，必须重新拉最新数据”
  - 结果是前端容易出现同一类 GET 重复加载，或者后续维护时不知道某次 `init()` 到底是普通初始化还是强制刷新。
- 优化后：
  - 核心 Store 统一增加 `initialized` 状态。
  - 普通初始化使用：
    ```js
    init()
    ```
    如果已经初始化或正在加载，则直接跳过。
  - 数据发生变化后的刷新使用：
    ```js
    init({ force: true })
    ```
    明确表示需要重新向后端拉最新数据。
  - `reloadAllStores()` 统一改为 `initAllStores({ force: true })`，保留手动全量刷新能力。
- Playwright / 验证：
  - 初始进入 `/matches` 的核心初始化请求只出现一轮：
    ```text
    GET /club
    GET /players
    GET /venues
    GET /titles
    GET /titles/all-players
    GET /seasons
    GET /rounds
    GET /matches
    GET /games
    GET /bookings/config
    GET /bookings/records
    ```
  - 创建轮次后，因为数据确实变化，只执行必要强制刷新：
    ```text
    POST /rounds
    GET /seasons
    GET /rounds
    GET /matches
    GET /games
    ```
  - 说明：
    - 普通进页面不会因为重复 `init()` 多拉一遍数据。
    - 写操作后仍然会刷新赛季、轮次、比赛、局数据，不会丢最新状态。
  - 截图证据：
    - `/tmp/p1-05d-core-store-force.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 这个优化改变的是加载策略，不改变业务数据结构。
  - 后续如果新增写操作，必须按同一规范使用 `init({ force: true })`，不能随手写普通 `init()`。

### 2026-05-25：P1-05e - 场地 CRUD 改为 Store 局部更新，移除保存后的冗余 GET

- 状态：DONE
- 修改文件：
  - `client/src/stores/venues.js`
  - `client/src/views/VenueView.vue`
- 优化前：
  - 场地新增/编辑/删除在页面组件里直接调用 API。
  - 保存成功后再调用：
    ```js
    venuesStore.init({ force: true })
    ```
  - 这会导致一次写操作后又重新请求整份场地列表。
  - Playwright 基线：新增场地后请求为：
    ```json
    [
      { "method": "POST", "path": "/venues" },
      { "method": "GET", "path": "/venues" }
    ]
    ```
- 优化后：
  - `venuesStore` 增加：
    - `createVenue(data)`
    - `updateVenue(id, data)`
    - `deleteVenue(id)`
  - 新增/编辑成功后直接使用后端返回的 `res.data` 更新本地 Store。
  - 删除成功后直接从本地 Store 移除对应场地。
  - 保留按名称排序，避免本地更新后列表顺序混乱。
  - 页面不再为了场地 CRUD 额外调用 `venuesStore.init({ force: true })`。
- Playwright / 验证：
  - 复测新增场地后请求变为：
    ```json
    [
      { "method": "POST", "path": "/venues" }
    ]
    ```
  - 页面上能立即看到新场地：
    ```json
    {
      "visible": true
    }
    ```
  - 截图证据：
    - `/tmp/p1-05e-before-venue-create.png`
    - `/tmp/p1-05e-after-venue-create.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 当前场地本地排序按名称处理，和后端 `ORDER BY name` 的意图一致；不同数据库中文排序细节可能略有差异，但不影响功能正确性。
  - 订场记录的编辑/删除仍会强制刷新 `bookingsStore`，后续可继续做同类局部更新优化。

### 2026-05-25：P1-05f - 订场记录编辑/删除改为 Store 局部更新

- 状态：DONE
- 修改文件：
  - `client/src/stores/bookings.js`
  - `client/src/views/VenueView.vue`
- 优化前：
  - 订场记录编辑成功后，页面会调用：
    ```js
    bookingsStore.init({ force: true })
    ```
  - 因此一次编辑会产生：
    ```json
    [
      { "method": "PUT", "path": "/bookings/records/:id" },
      { "method": "GET", "path": "/bookings/config" },
      { "method": "GET", "path": "/bookings/records" }
    ]
    ```
  - 删除记录也是同类模式：删除后重新拉取订场配置和订场记录。
- 优化后：
  - `bookingsStore` 增加：
    - `updateRecord(id, data)`
    - `deleteRecord(id)`
  - 编辑成功后直接使用后端返回的记录数据更新本地 `records`。
  - 删除成功后直接从本地 `records` 移除对应记录。
  - 保留本地排序：
    - 日期倒序
    - 同日期按创建时间倒序
  - 新增记录也改为走同一套 `upsertRecord()`，避免列表顺序维护分散。
- Playwright / 验证：
  - 编辑记录优化前：
    ```json
    [
      { "method": "PUT", "path": "/bookings/records/6" },
      { "method": "GET", "path": "/bookings/config" },
      { "method": "GET", "path": "/bookings/records" }
    ]
    ```
  - 编辑记录优化后：
    ```json
    [
      { "method": "PUT", "path": "/bookings/records/7" }
    ]
    ```
  - 编辑后页面立即显示新备注：
    ```json
    {
      "visible": true
    }
    ```
  - 删除记录优化后：
    ```json
    [
      { "method": "DELETE", "path": "/bookings/records/9" }
    ]
    ```
  - 删除后页面不再显示该记录：
    ```json
    {
      "stillVisible": false
    }
    ```
  - 截图证据：
    - `/tmp/p1-05f-before-booking-edit.png`
    - `/tmp/p1-05f-after-booking-edit.png`
    - `/tmp/p1-05f-after-booking-delete.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 本项只处理订场记录列表本身。
  - 创建订场记录时，后端会推进轮换人；前端仍是本地镜像推进，后续如果后端返回最新 config，可进一步改为以后端返回值为准。

### 2026-05-25：P1-05g - 创建轮次改为响应内回填轮次/比赛/赛季，移除创建后的全量刷新

- 状态：DONE
- 修改文件：
  - `server/src/services/roundCreationService.js`
  - `server/test/roundCreation.test.js`
  - `client/src/stores/seasons.js`
  - `client/src/stores/matches.js`
  - `client/src/views/MatchHubView.vue`
  - `client/src/views/SeasonOverview.vue`
- 优化前：
  - 创建轮次成功后，后端只返回轮次本身和 `matchCount`。
  - 前端为了拿到新创建的比赛、更新赛季状态/S5 骰子数据，会继续全量刷新：
    ```json
    [
      { "method": "POST", "path": "/rounds" },
      { "method": "GET", "path": "/seasons" },
      { "method": "GET", "path": "/rounds" },
      { "method": "GET", "path": "/matches" },
      { "method": "GET", "path": "/games" }
    ]
    ```
  - 其中 `GET /games` 对刚创建的轮次通常没有必要，因为新比赛尚未开始，没有局数据。
- 优化后：
  - `POST /rounds` 的响应增加：
    - `matches`：本轮创建出的比赛列表。
    - `season`：创建轮次后更新过的赛季数据，例如 pending → ongoing、S5 赛前骰子写入后的 comebackData。
  - `seasonsStore.createRound()` 直接 upsert 新轮次和返回的赛季。
  - `matchesStore.upsertMatches()` 直接回填本轮比赛。
  - `MatchHubView` 和 `SeasonOverview` 创建轮次后不再调用：
    ```js
    seasonsStore.init({ force: true })
    matchesStore.init({ force: true })
    seasonsStore.fetchRounds(...)
    ```
- Playwright / 验证：
  - 优化前创建轮次请求：
    ```json
    [
      { "method": "POST", "path": "/rounds" },
      { "method": "GET", "path": "/seasons" },
      { "method": "GET", "path": "/rounds" },
      { "method": "GET", "path": "/matches" },
      { "method": "GET", "path": "/games" }
    ]
    ```
  - 优化后创建轮次请求：
    ```json
    [
      { "method": "POST", "path": "/rounds" }
    ]
    ```
  - 页面结果：
    ```json
    {
      "hasRound": true,
      "hasMatch": true
    }
    ```
  - 截图证据：
    - `/tmp/p1-05g-before-create-round.png`
    - `/tmp/p1-05g-after-create-round.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：通过，55 passed / 0 failed。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 本项只优化“创建轮次”后的回填。
  - 记分页开始比赛、结束局、撤回局、编辑已完成局仍有 `matchesStore.init({ force: true })`，因为这些接口会联动比赛、局、轮次、赛季规则事件，后续要单独按状态机验证后再局部更新。

### 2026-05-25：P1-03a - 拆出记分页比分输入组件

- 状态：DONE
- 修改文件：
  - `client/src/components/match/GameScoreInput.vue`
  - `client/src/views/ScoringView.vue`
  - `FRONTEND_OPTIMIZATION_BACKLOG.md`
- 优化前：
  - `ScoringView.vue` 直接包含整块比分输入 UI：
    - A/B 队大比分圆点
    - 当前局两个大数字输入框
    - 队员姓名展示
    - VS 分隔
    - 输入框样式 `.score-input`
  - 这部分是纯展示 + 输入绑定，但和记分页业务逻辑混在同一个大文件里。
- 优化后：
  - 新增 `GameScoreInput.vue`，专门负责比分输入区域。
  - `ScoringView.vue` 改为通过：
    ```vue
    <GameScoreInput
      v-model:score-a="scoreA"
      v-model:score-b="scoreB"
      ...
    />
    ```
    传入数据和接收输入变化。
  - 原来的 `.score-input` 样式迁移到组件内部。
  - 本项不改变任何记分业务逻辑，不改 API，不改状态机。
- Playwright / 验证：
  - 优化前：
    ```json
    {
      "status": true,
      "inputs": [
        { "value": "0", "min": "0", "max": "30" },
        { "value": "0", "min": "0", "max": "30" }
      ],
      "hasEndButton": true,
      "hasVs": true
    }
    ```
  - 优化后：
    ```json
    {
      "status": true,
      "inputs": [
        { "value": "0", "min": "0", "max": "30" },
        { "value": "0", "min": "0", "max": "30" }
      ],
      "valuesAfterFill": ["11", "9"],
      "hasEndButton": true,
      "hasVs": true
    }
    ```
  - 说明：
    - 页面仍显示进行中状态。
    - 两个比分输入框仍存在。
    - `min/max` 属性保持不变。
    - 输入 11:9 后组件能正确把值同步回页面状态。
  - 截图证据：
    - `/tmp/p1-03a-before-scoring-board.png`
    - `/tmp/p1-03a-after-scoring-board.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 这是 P1-03 的第一步，只拆出了比分输入展示组件。
  - 结束局确认、已完成局列表、S5 抵抗/贯穿 UI、状态机刷新仍在 `ScoringView.vue`，后续继续小步拆分。

### 2026-05-25：P1-03b - 拆出记分页已完成局列表组件

- 状态：DONE
- 修改文件：
  - `client/src/components/match/CompletedGamesList.vue`
  - `client/src/views/ScoringView.vue`
  - `FRONTEND_OPTIMIZATION_BACKLOG.md`
- 优化前：
  - `ScoringView.vue` 直接包含已完成局横向列表：
    - G1/G2 等局号卡片。
    - 每局比分。
    - S5 抵抗/贯穿等规则 Badge。
    - 当前进行中局的占位卡片。
    - “撤回最后一局”按钮。
  - 这块 UI 也和记分页状态机逻辑混在同一个文件里。
- 优化后：
  - 新增 `CompletedGamesList.vue`，专门负责已完成局列表渲染。
  - `ScoringView.vue` 只负责传入：
    - `completedGames`
    - `hasCurrentGame`
    - `isMatchOver`
    - `getRuleEventBadges`
  - 组件通过事件把动作交还父组件：
    ```vue
    @edit-game="openEdit"
    @revert-last="handleRevertLast"
    ```
  - 本项不改变撤回逻辑，不改编辑比分逻辑，不改任何 API。
- Playwright / 验证：
  - 优化前：
    ```json
    {
      "gameCardVisible": true,
      "scoreVisible": true,
      "revertVisible": true,
      "hasCurrentGameHint": true
    }
    ```
  - 优化后：
    ```json
    {
      "gameCardVisible": true,
      "scoreVisible": true,
      "revertVisible": true,
      "editSheetVisible": true,
      "hasCurrentGameHint": true
    }
    ```
  - 说明：
    - G1 卡片仍显示。
    - 21:18 比分仍显示。
    - “撤回最后一局”按钮仍显示。
    - 当前 G2/进行中提示仍显示。
    - 点击 G1 后仍能打开“修改 G1 比分”弹层。
  - 截图证据：
    - `/tmp/p1-03b-before-completed-games.png`
    - `/tmp/p1-03b-after-completed-games.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 本项仍是 P1-03 的低风险 UI 拆分。
  - “撤回最后一局”实际状态机仍在父组件中，后续需要结合 P1-06 单独验证再考虑局部刷新优化。

### 2026-05-25：P1-03c - 拆出结束本局确认弹层

- 状态：DONE
- 修改文件：
  - `client/src/components/match/EndGameConfirmSheet.vue`
  - `client/src/views/ScoringView.vue`
  - `FRONTEND_OPTIMIZATION_BACKLOG.md`
- 优化前：
  - `ScoringView.vue` 内部直接写了结束本局确认弹层：
    - Teleport 到 body。
    - 遮罩和底部 Sheet 样式。
    - “确认结束本局？”标题。
    - 当前比分和胜方文案。
    - 取消/确认按钮。
  - 这部分和真正的 `handleEndGame()` 状态机逻辑混在同一个文件里。
- 优化后：
  - 新增 `EndGameConfirmSheet.vue`。
  - `ScoringView.vue` 只传入：
    - `show`
    - `scoreA`
    - `scoreB`
    - `winnerName`
    - `saving`
  - 组件只发事件：
    ```vue
    @close="showEndConfirm=false"
    @confirm="handleEndGame"
    ```
  - 本项不改变结束本局接口，不改变比分验证，不改变比赛状态机。
- Playwright / 验证：
  - 优化前：
    ```json
    {
      "titleVisible": true,
      "scoreVisible": true,
      "cancelVisible": true,
      "confirmVisible": true
    }
    ```
  - 优化后：
    ```json
    {
      "titleVisible": true,
      "scoreVisible": true,
      "cancelVisible": true,
      "confirmVisible": true,
      "closedAfterCancel": true,
      "writeRequests": []
    }
    ```
  - 说明：
    - 结束本局确认弹层仍正常出现。
    - 比分 21:18 和胜方文案仍正常显示。
    - 取消按钮能关闭弹层。
    - 取消不会触发写请求。
  - 截图证据：
    - `/tmp/p1-03c-before-end-confirm.png`
    - `/tmp/p1-03c-after-end-confirm.png`
- 构建/测试：
  - `cd client && npm run build`：通过。
  - `cd server && npm test`：未涉及后端代码，本项未执行。
- 部署：
  - `docker compose -p badminton-v2-prod up -d --build`：通过，容器 `badminton-v2` 已启动。
  - `docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build`：通过，容器 `badminton-v2-test` 已启动。
  - `curl -fsS http://127.0.0.1:8088/api/health`：通过。
  - `curl -fsS http://127.0.0.1:8090/api/health`：通过。
- 剩余风险：
  - 结束本局的实际提交逻辑仍在 `ScoringView.vue`。
  - 后续如果要优化结束局后的全量刷新，需要单独做状态机级别 Playwright 回归。
