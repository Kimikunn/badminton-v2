# BAD Club v2 — AI Agent 开发手册

> **阅读顺序**：本文件 → `DEVELOPMENT.md` → 具体源码文件
>
> 本文档为 AI 模型编写。简明、结构化、可机器解析。

---

## 0. 快速启动

```bash
# 开发模式
cd client && npm run dev          # 前端 :5173
cd server && node src/server.js   # 后端 :3000

# 生产部署
cd client && npm run build
docker compose -p badminton-v2-prod up -d --build      # :8089
docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build  # :8090 (测试DB)
```

**测试环境** (`:8090`) 使用独立数据库 `server/database/test.db`，仅含 1 个赛季的 mock 数据，随意操作。

---

## 1. 项目身份

- **名称**：BAD Club v2
- **类型**：PWA（移动端羽毛球记分 + 赛季管理）
- **用户**：4 人固定俱乐部
- **设计方向**：Apple 原生 + 社区温度（详见 `PRODUCT.md`）
- **技术栈**：Vue 3 + Pinia + Vite + Express + sql.js + Docker

---

## 2. 目录速查

```
badminton-v2/
│
├── AGENTS.md              ← 你正在读的文件
├── PRODUCT.md             ← 产品定义（用户、风格、反参考）
├── DEVELOPMENT.md         ← 业务逻辑、数据模型、API 规范（详细）
├── MATCH_CRUD_SPEC.md     ← 比赛系统 CRUD 规格（记分规则、状态机）
│
├── client/                ← 前端 Vue 3 SPA
│   ├── src/
│   │   ├── main.js            ← 入口
│   │   ├── App.vue            ← 根组件（Header + TabBar + router-view）
│   │   ├── router/index.js    ← 路由表（6 个主路由）
│   │   ├── constants/index.js ← 全局常量（STATUS, BEST_OF_OPTIONS, TITLE_LEVELS）
│   │   │
│   │   ├── styles/            ← 全局样式
│   │   │   ├── tokens.css     ← OKLCH 设计 token（颜色/排版/间距/圆角/阴影）
│   │   │   └── global.css     ← reset + 暗色模式 + 过渡动画
│   │   │
│   │   ├── api/               ← HTTP 客户端
│   │   │   └── client.js      ← axios 实例（baseURL=/api, 错误拦截）
│   │   │
│   │   ├── stores/            ← Pinia 数据层（纯 CRUD，不含业务逻辑）
│   │   │   ├── club.js        ← 俱乐部信息
│   │   │   ├── players.js     ← 选手 CRUD
│   │   │   ├── seasons.js     ← 赛季 + 轮次 CRUD
│   │   │   ├── matches.js     ← 比赛 + 局 CRUD + setGameScore
│   │   │   ├── venues.js      ← 场地列表
│   │   │   ├── titles.js      ← 称号定义 + 选手称号
│   │   │   ├── bookings.js    ← 订场配置 + 记录
│   │   │   └── index.js       ← 统一导出
│   │   │
│   │   ├── composables/       ← 业务逻辑（可复用）
│   │   │   ├── useAppInit.js  ← 并行加载所有 Store
│   │   │   ├── useTheme.js    ← 三态主题（auto/light/dark）
│   │   │   ├── useSeasonTheme.js ← 赛季颜色映射（blue→OKLCH）
│   │   │   ├── useSeasonSelector.js ← 赛季选择跨页持久
│   │   │   ├── useViewAccent.js    ← 页面级 accent 色覆盖
│   │   │   ├── useMatchTab.js      ← 比赛页 Tab 状态持久
│   │   │   └── useToast.js    ← 轻量通知（命令式）
│   │   │
│   │   ├── components/
│   │   │   ├── ui/            ← 原子组件（9 个）
│   │   │   │   ├── Button, Card, Badge, Avatar, Input
│   │   │   │   ├── Sheet, ToastContainer, Skeleton, EmptyState
│   │   │   ├── match/         ← ScoreBoard（记分板）
│   │   │   ├── season/        ← S1~S5 积分面板（S5 复用 S1 榜单）
│   │   │   ├── FriendlyStats.vue ← 友谊赛图表（Chart.js）
│   │   │   └── ...（日历、选手选择等）
│   │   │
│   │   ├── views/             ← 页面组件
│   │   │   ├── HomeView.vue       ← 首页（俱乐部+赛季+成员+进行中）
│   │   │   ├── MatchHubView.vue   ← 比赛中枢（赛季比赛+友谊赛+创建轮次）
│   │   │   ├── MatchDetailView.vue← 比赛详情（各局比分+编辑+删除）
│   │   │   ├── ScoringView.vue    ← 记分页（数字输入+21分制验证）
│   │   │   ├── RankingsHubView.vue← 积分榜调度（按 ruleId 分发子组件）
│   │   │   ├── VenueView.vue      ← 场地管理+订场轮换+记录 CRUD
│   │   │   ├── PlayerDetailView.vue← 选手详情（战绩+称号+装备）
│   │   │   ├── SeasonOverview.vue ← 赛季概览
│   │   │   ├── SeasonRounds.vue   ← 轮次记录（只读）
│   │   │   └── SeasonRankings.vue ← 旧版积分榜（保留但不再主用）
│   │   │
│   │   └── rules/             ← 规则引擎（从 v1 移植）
│   │       ├── index.js       ← getRule(ruleId) 注册中心
│   │       ├── standard.js    ← S1 标准规则
│   │       ├── s2.js          ← S2 绝对压制+绝地反击
│   │       ├── s3.js          ← S3 超能饮料+压制2.0+关键先生
│   │       ├── s4.js          ← S4 星尘之征（上篇骰子+下篇组合）
│   │       └── s5.js          ← S5 异变秩序（15/21分制骰子）
│   │
│   ├── index.html
│   ├── vite.config.js         ← Vite + PWA 配置
│   └── package.json
│
├── server/                   ← 后端 Express API
│   ├── src/
│   │   ├── server.js         ← 入口
│   │   ├── app.js            ← Express 配置 + 路由挂载 + 静态文件服务
│   │   ├── config/
│   │   │   ├── db.js         ← sql.js 封装（init/prepare/save/close）
│   │   │   └── config.js     ← JWT + CORS + 端口配置
│   │   ├── routes/           ← 路由定义（薄层，只做参数验证）
│   │   ├── controllers/      ← 控制器（薄层，参数→service→响应）
│   │   ├── services/         ← 业务逻辑（厚层）
│   │   │   └── scoringService.js ← 21分制验证 + match/round 状态判定
│   │   ├── db/
│   │   │   └── schema.sql    ← 完整表结构
│   │   ├── middleware/
│   │   └── utils/            ← response.js, logger.js
│   ├── database/             ← SQLite 数据文件
│   │   ├── badminton.db      ← 生产数据库（从 v1 复制）
│   │   └── test.db           ← 测试数据库（mock 数据）
│   ├── scripts/
│   │   ├── seed.js           ← 种子数据生成
│   │   └── create-test-db.js ← 测试数据库创建
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml        ← 生产部署
├── docker-compose.test.yml   ← 测试部署
├── Dockerfile                ← 单容器构建
└── nginx.conf                ← (开发用，生产由 Express 服务静态文件)
```

---

## 3. 架构要点

### 3.1 数据流

```
Component → Composable → Store → API (client.js) → Express Route → Controller → DB
                                                      ↓
Component ← Composable ← Store ← API ←─────────── Response
```

**原则**：
- Component 只做渲染 + 事件转发
- Composable 承载业务逻辑（记分流程、排名计算、规则判断）
- Store 只做数据 CRUD + 缓存
- 后端 Controller 薄封装，Service 是业务逻辑的最终裁决者

### 3.2 路由表

| 路径 | 组件 | Tab | 说明 |
|------|------|-----|------|
| `/` | HomeView | home | 首页 |
| `/matches` | MatchHubView | matches | 比赛中枢 |
| `/matches/:id` | MatchDetailView | - | 比赛详情 |
| `/scoring/:matchId` | ScoringView | - | 记分页 |
| `/rankings` | RankingsHubView | rankings | 积分榜 |
| `/venues` | VenueView | venues | 场地管理 |
| `/players/:id` | PlayerDetailView | - | 选手详情 |
| `/season/overview` | SeasonOverview | - | 赛季概览（保留路由） |
| `/season/rounds` | SeasonRounds | - | 轮次记录（保留路由） |

### 3.3 赛季积分解耦

```
RankingsHubView (调度)
  ├─ ruleId==='standard' → S1Rankings  (三Tab: 大分/小分/得分)
  ├─ ruleId==='s2'       → S2Rankings  (Buff面板 + 排名 + Buff标签)
  ├─ ruleId==='s3'       → S3Rankings  (Buff面板 + 排名 + Buff标签)
  ├─ ruleId==='s4'       → S4Rankings  (星尘之征: 阶段/骰子/种子/星尘榜/组合星尘)
  └─ ruleId==='s5'       → S5Rankings  (异变秩序: 未开始提示/骰子状态 + 复用S1榜单)
```

每个赛季组件独立消费自己的数据合约，不共用模板。

规则相关行为按生命周期落位：
- `beforeRound`：创建/开始轮次前的赛前行为，如 S5 投骰。
- `roundStart`：轮次创建、对阵生成、赛季进入进行中。
- `afterGame`：小局结束后的赛季事件，如 S5 抵抗与贯穿。
- `afterRound`：轮次完成后的结算、奖励、排名。

后端规则插件位于 `server/src/rules/`。标准规则是默认内核，赛季特供规则通过插件接入生命周期。

### 3.4 比赛状态机

```
create → pending → start → in_progress → 全部局结束 → completed
                       ↓
                    cancel → 删除所有局 → pending
```

局结束规则：`canEndGame(scoreA, scoreB)` → `server/src/services/scoringService.js`

### 3.5 关键技术决策

- **API 统一响应**：`{ success: true, data: ... }` / `{ success: false, error: { code, message } }`
- **前端无 Tailwind**：全部使用 CSS 自定义属性（`client/src/styles/tokens.css`）
- **移动端优先**：viewport 390×844，TabBar 固定底部
- **暗色模式**：`document.documentElement.classList.toggle('dark')` 触发
- **PWA**：vite-plugin-pwa，NetworkFirst API 缓存策略
- **数据库**：sql.js（纯 JS SQLite），文件 `server/database/badminton.db`

---

## 4. 关键文件速查

| 当需要... | 查看文件 |
|-----------|---------|
| 理解记分规则 | `server/src/services/scoringService.js` |
| 修改设计 token | `client/src/styles/tokens.css` |
| 添加新 API | `server/src/routes/` + `server/src/controllers/` + `server/src/app.js` |
| 理解赛季规则 | `client/src/rules/s4.js`（最复杂，参考此文件结构） |
| 修改 S4 积分面板 | `client/src/components/season/S4Rankings.vue` |
| 理解比赛页逻辑 | `client/src/views/MatchHubView.vue`（~450 行，最大组件） |
| 修改 TabBar | `client/src/App.vue` 中的 `tabs` 数组 |
| 添加新页面 | `client/src/router/index.js` + `client/src/views/` + TabBar |
| 理解数据库结构 | `server/src/db/schema.sql` |

---

## 5. 已知陷阱

1. **`selectSeason` 函数**：MatchHubView 中此函数曾被意外删除导致报错。修改时注意保持函数存在。
2. **`v-if` 内的 `ref`**：不要对 `v-if` 内部的元素使用 `ref` 引用，渲染前不存在会报错。
3. **Chart.js 颜色**：Canvas 不支持 OKLCH 格式，必须用 hex（`#22c55e` 等）。
4. **sql.js 占位符**：所有 SQL 参数必须用 `?` 占位，不能混用硬编码值和占位符。
5. **比赛顺序**：`getRoundMatches` 返回的 `_playable` 属性控制哪场比赛可开始。修改时注意顺序逻辑。
6. **赛季切换持久化**：使用 `useSeasonSelector` 共享状态，不要在每个页面独立管理 `selectedSeasonId`。
7. **测试环境**：`:8090` 使用独立 DB，`:8089` 使用生产 DB。每次修改代码后需同时部署两个环境。

---

## 6. 当前状态

### 已完成
- ✅ 全部页面骨架（首页、比赛、积分榜、场地、选手详情）
- ✅ 比赛 CRUD（创建/开始/结束/编辑/删除）+ 21分制验证
- ✅ 轮次创建 + 自动生成对阵 + 删除
- ✅ 五个赛季积分面板（S1/S2/S3/S4/S5）
- ✅ 订场轮换 + CRUD
- ✅ 选手称号选择 + 头像上传 + 装备管理
- ✅ 友谊赛图表（Chart.js）
- ✅ Docker 双环境部署

### 待完成
- ⏳ 记分页实时 API 集成（当前为占位）
- ⏳ S4 骰子投掷交互
- ⏳ S2/S3 Buff 触发交互
- ⏳ Tips 系统
- ⏳ 数据导出/备份
- ⏳ 赛季创建/编辑表单

---

## 7. 部署

```bash
# 同时部署生产+测试
cd client && npm run build
cd ..
docker compose -p badminton-v2-prod up -d --build
docker compose -p badminton-v2-test -f docker-compose.test.yml up -d --build
```

访问：
- 生产：`http://38.55.194.167:8089/`
- 测试：`http://38.55.194.167:8090/`

V1 原项目仍在 `:8088` 运行，互不影响。

---

*最后更新：2026-05-17 | 版本：v2.0-beta*
