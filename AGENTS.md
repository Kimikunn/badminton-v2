# BAD Club v2 — Agent 上下文

> 每次对话自动加载。只写原则和规范。细节见其他相关文档。

---

## 项目

羽毛球双打记分 + 赛季管理 PWA，4 人俱乐部。Vue 3 + Pinia + Vite → Express + sql.js → Docker。

---

## 环境

| | 生产 `:8088` | 测试 `:8090` |
|---|---|---|
| DB | `badminton.db` | `test.db`（同目录） |
| 构建 | `npm run build` → `dist/` | `npm run build:test` → `dist-test/` |
| 恢复 | — | 烧瓶按钮 → `POST /api/admin/reset-db` |

**区分机制**：
- 后端：`ENABLE_TEST_FEATURES=true` 条件注册路由
- 前端：`VITE_TEST_MODE=true` 编译时 `v-if`（构建时变量，非运行时）

**测试生产环境原则**：

- 测试与生产共用一套业务代码，即使是测试环境，业务功能也放对应业务页面，与生产环境没有区别，唯二区别是数据隔离和灰度功能。bug 修复和已上线功能同时影响双环境，仅灰度新功能和测试运维工具存在差异
- 测试专属能力用 `isTestMode`（前端）+ `ENABLE_TEST_FEATURES`（后端）控制，且校验当前为测试 DB

- 对于每一个测试功能，需灰度时`.env.test` 加 `VITE_ENABLE_X=true`，代码里 `v-if` 检查，仅测试可见。上线后删掉 flag，`v-if` 改为无条件渲染。`.env.test` 移除该行

---

## 开发流程

1. **改代码** — 只改文件，不动生产数据，测试/生产的差异用环境变量或功能开关控制
2. **自测** — `build:test` → 部署 `:8090` → Playwright 自检，确保无编译错误和明显回归
3. **提交验证** — 告诉用户功能已在测试环境 `:8090` 就绪，由用户在真实设备上操作验证
4. **等待确认** — 用户验证通过并明确指示后，方可部署生产。未经确认，禁止 `npm run build` + 生产部署
5. **上线** — 用户确认后 `build` → 部署 `:8088`，不动生产数据

```bash
# 测试
cd client && npm run build:test
docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build

# 生产
cd client && npm run build
docker compose -p badminton-v2-prod up -d --build
```

**示例见** `WORKFLOW_EXAMPLES.md`。

---

## Git 提交规范

每次提交必须标注作者身份：

```
经由 [Claude / Codex] 完成。

via [HAPI](https://hapi.run)

Co-Authored-By: HAPI <noreply@hapi.run>
```

禁止以 `root` 身份提交。提交前设置 `git config user.name` 和 `user.email`。

---

## 架构原则

```
Component → Composable → Store → api(client.js) → Backend
```

- **Component**：渲染 + 事件转发，不含业务逻辑
- **Composable**：业务逻辑载体（验证、流程、规则判断）
- **Store**：数据 CRUD + 缓存。所有 API 调用封装在 Store 方法内，View 不直接 import api
- **Backend**：Controller 薄封装，Service 是业务逻辑最终裁决者

---

## 代码规范

1. **View 不裸调 api** — 所有 HTTP 请求走 Store 方法
2. **Store init 防重** — 所有 Store 须有 `initialized` + `options.force` 守卫
3. **写操作返回值** — create/update → `data|null`，delete/action → `boolean`
4. **新增 API** — Controller → Service → 在 app.js 注册。测试专属路由用 `ENABLE_TEST_FEATURES` 条件挂载
5. **无原生弹窗** — 统一用 ConfirmSheet / AdminTokenSheet，禁止 `confirm()` / `prompt()`
6. **状态机双向** — 所有状态转换必须支持前向和后向（完成↔撤回）。新增转换后更新 `state-machine.test.js`

---

## 已知陷阱

- `sql.js` 占位符只用 `?`，禁止字符串拼接 SQL
- `v-if` 内元素不要用 `ref` 引用
- Canvas 不支持 OKLCH，须用 hex
- 跨页共享状态用 composable 单例，不要各页独立管理
- 所有比赛/轮次/赛季操作必须级联检查状态一致性

---

## 文档索引

| 需要什么 | 去哪里 |
|---------|--------|
| 数据模型、API 完整清单、业务规则 | `DEVELOPMENT.md` |
| 产品风格、用户故事 | `PRODUCT.md` |
| 工作流正反例 | `WORKFLOW_EXAMPLES.md` |
| 前端优化待办 | `FRONTEND_OPTIMIZATION_BACKLOG.md` |
| 后端待办 | `BACKEND_TODO.md` |
| 赛季规则 UI 设计范式 | `docs/SEASON_RULE_DESIGN.md` |

---

*最后更新：2026-05-26*
