# BAD Club v2 — Agent 上下文

> 每次对话自动加载。只写原则和规范。细节见 `DEVELOPMENT.md`。

---

## 项目

羽毛球双打记分 + 赛季管理 PWA，4 人俱乐部。Vue 3 + Pinia + Vite → Express + sql.js → Docker。

---

## 环境

| | 生产 `:8089` | 测试 `:8090` |
|---|---|---|
| DB | `badminton.db` | `test.db`（与生产同目录） |
| 构建 | `npm run build` → `dist/` | `npm run build:test` → `dist-test/` |
| 特性 | 标准业务功能（赛季创建开关暂关） | 标准业务功能（赛季创建开关开启）+ TEST 徽标 + 烧瓶按钮恢复数据 |
| 恢复 | — | `POST /api/admin/reset-db`（复制生产 DB → 测试 DB） |

**区分机制**：后端 `ENABLE_TEST_FEATURES=true` 条件注册路由；前端 `VITE_TEST_MODE=true` 编译时 `v-if`。

**测试环境控制**：
- 测试环境与正式环境使用同一套业务代码，差异应来自数据隔离和功能开关，不写临时代码。
- 当前赛季创建按正式功能开发，但先通过 `VITE_ENABLE_SEASON_CREATE=true` 只在测试构建打开；未来正式上线只改开关。
- 前端只维护一套源码；测试运维能力用 `v-if="isTestMode"` 控制，业务灰度能力用独立功能开关控制。
- `VITE_TEST_MODE` 是 **Vite 构建时变量**，不是容器启动时变量。
- 因此测试环境必须先执行 `npm run build:test` 生成 `client/dist-test/`，不能直接复用生产 `client/dist/`。
- 生产构建 `npm run build` 不带 `VITE_TEST_MODE=true`，不会显示 TEST 徽标和测试工具；默认也不带 `VITE_ENABLE_SEASON_CREATE=true`。
- 烧瓶按钮只放测试运维能力（目前是恢复生产数据）；业务功能必须放在对应业务页面，例如创建赛季放在比赛页。
- 可复用业务组件不要为了测试入口在文件名里写 `Test`，例如赛季创建使用 `SeasonPresetManager`。
- 测试功能不能只靠前端 `v-if`，后端必须同时用 `ENABLE_TEST_FEATURES=true` 且仅允许测试 DB 保护。

---

## 开发流程

**四步标准流程**：

1. **改代码** — 只改文件，不动生产数据。测试/生产的差异用环境变量或功能开关控制
2. **测** — `build:test` → 部署 `:8090` → Playwright 验证。需要干净数据点时烧瓶恢复
3. **验** — 确认测试环境跑通。测试环境能跑通的，生产就能跑通（同 Dockerfile、同依赖、差异仅环境变量）
4. **发** — `build` → 部署 `:8089`。只动代码不动数据

```bash
# 测试
cd client && npm run build:test
docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build

# 生产
cd client && npm run build
docker compose -p badminton-v2-prod up -d --build
```

**示例见** `WORKFLOW_EXAMPLES.md`（创建赛季、删除赛季的正反例）。

---

## Git 提交规范

每次提交必须标注作者身份。commit message 末尾注明：

```
经由 [Agent名称] 完成。
```

Agent 名称：`Claude` 或 `Codex`。禁止以 `root` 身份提交。

---

## 架构原则

```
Component → Composable → Store → api(client.js) → Backend
```

- **Component**：渲染 + 事件转发，不含业务逻辑
- **Composable**：业务逻辑载体（验证、流程、规则判断）
- **Store**：数据 CRUD + 缓存。**所有 API 调用必须封装在 Store 方法内，View 不得直接 import api**
- **Backend**：Controller 薄封装，Service 是业务逻辑最终裁决者

---

## 代码规范

1. **View 不裸调 api** — 游戏操作（endGame/revertGame/updateCompletedScore）走 matchesStore，赛季动作走 seasonsStore.recordAction
2. **Store init 防重** — 所有 Store 须有 `initialized` + `options.force` 守卫
3. **写操作返回值** — create/update 返回 `data|null`，delete/action 返回 `boolean`
4. **新增 API** — Controller → Service → 在 app.js 注册。测试专属路由用 `ENABLE_TEST_FEATURES` 条件挂载
5. **无原生弹窗** — 统一用 ConfirmSheet / AdminTokenSheet，禁止 `confirm()`/`prompt()`
6. **比分验证** — 编辑比分页必须用 `useScoringValidation`，不能只放静态文案

---

## 已知陷阱

- `sql.js` 占位符只用 `?`，不能硬编码拼 SQL
- `v-if` 内元素不要用 `ref` 引用
- Canvas（Chart.js）不支持 OKLCH，须用 hex
- 赛季选择跨页用 `useSeasonSelector`，不要各页独立管理 selectedSeasonId

---

## 文档索引

| 需要什么 | 去哪里 |
|---------|--------|
| 数据模型、API 完整清单、业务规则 | `DEVELOPMENT.md` |
| 产品风格、用户故事 | `PRODUCT.md` |
| 工作流正反例 | `WORKFLOW_EXAMPLES.md` |
| 前端优化待办 | `FRONTEND_OPTIMIZATION_BACKLOG.md` |
| 后端待办 | `BACKEND_TODO.md` |

---

*最后更新：2026-05-25*
