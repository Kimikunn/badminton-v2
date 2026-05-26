# BAD Club — 开发参考文档

> 本文档是项目的**唯一真相源**。所有业务逻辑、数据模型、组件契约、API 规范均在此定义。代码修改前先查本文档，代码修改后同步更新本文档。

---

## 目录

1. [项目概述](#1-项目概述)
2. [架构总览](#2-架构总览)
3. [数据模型](#3-数据模型)
4. [业务规则](#4-业务规则)
5. [页面与路由](#5-页面与路由)
6. [组件契约](#6-组件契约)
7. [API 规范](#7-api-规范)
8. [设计系统](#8-设计系统)
9. [状态管理](#9-状态管理)
10. [扩展指南](#10-扩展指南)

---

## 1. 项目概述

### 1.1 产品定义

羽毛球俱乐部记分系统（BAD Club），服务于 4 人固定小团体的双打比赛记录和赛季管理。

- **用户**：4 名俱乐部成员
- **场景**：打球现场手机记分（主）+ 赛后查看排名/日历（辅）
- **风格**：Apple 原生 + 社区温度，清爽/亲近/利落
- **平台**：PWA，移动端优先，兼容桌面

### 1.2 核心功能域

| 域 | 说明 | 优先级 |
|---|---|---|
| **记分** | 实时双打记分、撤销、修改、暂停/继续 | P0 |
| **赛季** | 赛季 CRUD、轮次管理、规则引擎、排名 | P0 |
| **比赛** | 友谊赛、赛季赛、日历视图、历史记录 | P1 |
| **俱乐部** | 成员管理、称号系统、场地管理、订场轮换 | P1 |
| **数据** | 导出、自动备份、数据完整性 | P2 |
| **Tips** | 羽毛球知识每日推送 | P2 |

### 1.3 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | Vue 3 (Composition API) |
| 构建工具 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| 样式方案 | Tailwind v4 + CSS Custom Properties (OKLCH) |
| HTTP | Axios |
| 后端框架 | Express 4 |
| 数据库 | sql.js (SQLite) |
| 认证 | Admin Token (x-admin-token header) |
| 部署 | Docker (Express 直接服务静态文件) |

---

## 2. 架构总览

### 2.1 目录结构

```
badminton-v2/
├── client/src/
│   ├── api/client.js          ← axios 实例 + token 拦截
│   ├── stores/                ← Pinia（7 个: club/players/seasons/matches/venues/titles/bookings）
│   ├── composables/           ← 业务逻辑（11 个）
│   ├── components/
│   │   ├── ui/                ← 原子组件（12 个，含 ConfirmSheet/AdminTokenSheet）
│   │   ├── match/             ← GameScoreInput, CompletedGamesList, EndGameConfirmSheet
│   │   └── season/            ← S1~S5 积分面板 + SeasonTabs
│   ├── views/                 ← 页面组件（10 个）
│   ├── rules/                 ← 规则引擎（standard/s2/s3/s4/s5）
│   ├── styles/                ← tokens.css + global.css (Tailwind v4 + OKLCH)
│   ├── router/index.js
│   ├── constants/index.js
│   ├── App.vue
│   └── main.js
├── server/src/
│   ├── routes/                ← 路由（12 个，含 admin）
│   ├── controllers/           ← 控制器（9 个，含 adminController）
│   ├── services/              ← 业务逻辑
│   ├── rules/                 ← 后端规则插件
│   ├── db/schema.sql + migrations/
│   ├── middleware/             ← writeAuth, errorHandler
│   ├── utils/                 ← response, logger, validators, errorHandling
│   ├── config/db.js + config.js
│   ├── app.js
│   └── server.js
├── docker-compose.yml         ← 生产 :8089
├── docker-compose.test.yml    ← 测试 :8090
├── Dockerfile
├── AGENTS.md                  ← 上下文（每次对话加载）
├── PRODUCT.md
└── DEVELOPMENT.md             ← 本文档
```

### 2.2 数据流

```
Component → Composable → Store → API Client → Backend Route → Controller → Service → DB
                                                      ↓
                                              Response (统一格式)
                                                      ↓
Component ← Composable ← Store ← API Client ←────────┘
```

**原则**：
- Component 只负责渲染 + 事件转发，不含业务逻辑
- Composable 是业务逻辑的载体（记分流程、排名计算、规则判断）
- Store 只做数据 CRUD + 缓存，不做业务计算
- Service（后端）是业务逻辑的最终裁决者

### 2.3 写接口权限

- 后端在配置 `ADMIN_TOKEN` 后，会要求所有 `POST/PUT/PATCH/DELETE` 请求携带写入令牌。
- 令牌支持 `x-admin-token` 请求头或 `Authorization: Bearer <token>`。
- 前端 API client 会在写请求中自动附带本机保存的 token；首次返回 `UNAUTHORIZED` 时会提示输入并重试一次。
- 未配置 `ADMIN_TOKEN` 时保持无鉴权写入，便于本地开发和测试环境按需启用。

### 2.4 模块边界

```
App Shell
  ├── Header (标题 + TEST徽标[测试] + 调试按钮[测试] + 主题切换 + 停车缴费)
  ├── <router-view> (页面过渡: fade / slide-left / slide-right)
  │     └── Page → Composable → Store → api/client.js → Backend
  ├── TabBar (首页 | 比赛 | 积分榜 | 场地)
  ├── ConfirmSheet / AdminTokenSheet (全局)
  └── ToastContainer (全局)
```

- **TabBar** 始终显示，记分页和比赛详情页除外 (`meta.hideTab: true`)
- **测试环境**：使用同一套业务代码；Header 额外显示 TEST 徽标 + 烧瓶按钮（仅恢复生产数据）。赛季创建按正式功能开发，但当前只在测试构建通过 `VITE_ENABLE_SEASON_CREATE=true` 打开。

### 2.5 双环境

| | 生产 `:8089` | 测试 `:8090` |
|---|---|---|
| 构建 | `npm run build` → `dist/` | `npm run build:test` → `dist-test/` |
| DB | `badminton.db` | `test.db` |
| 调试功能 | 无 | TEST 徽标 + 烧瓶恢复数据 |
| 功能开关 | 赛季创建默认关闭 | `VITE_ENABLE_SEASON_CREATE=true` |
| 后端 | 标准路由 | 额外 `/api/admin/reset-db` |

区分机制：后端 `ENABLE_TEST_FEATURES=true` 条件注册路由；前端 `VITE_TEST_MODE=true` 编译时 `v-if`。

测试功能控制原则：

- 测试环境与正式环境使用同一套业务代码，差异应来自数据隔离和功能开关。
- 前端只维护一套源码，只有测试运维能力通过 `v-if="isTestMode"` 控制；业务灰度能力使用独立功能开关。
- `isTestMode` 来自 `import.meta.env.VITE_TEST_MODE === 'true'`。
- 赛季创建入口来自 `import.meta.env.VITE_ENABLE_SEASON_CREATE === 'true'`。
- `VITE_TEST_MODE` 是 Vite **构建时变量**，所以生产和测试必须分别构建：
  ```bash
  # 测试
  cd client && npm run build:test   # 输出 dist-test/，包含 VITE_TEST_MODE=true 和 VITE_ENABLE_SEASON_CREATE=true

  # 生产
  cd client && npm run build        # 输出 dist/，默认不显示测试工具，也不显示创建赛季
  ```
- 测试环境 Docker 使用 `BUILD_DIR=dist-test`，生产环境默认使用 `dist`。
- 测试功能必须有前后端双保险：
  - 前端：`VITE_TEST_MODE=true` 才显示 TEST 徽标和测试工具。
  - 后端：`ENABLE_TEST_FEATURES=true` 且当前数据库必须是测试库，才允许注册/执行测试管理接口。
- 测试运维入口只控制“测试运维能力是否可见”。烧瓶按钮只放测试运维功能；业务功能放回对应业务页面，并通过独立功能开关灰度：
  - `components/admin/AdminToolsSheet.vue`：测试运维工具容器，目前只恢复生产数据。
  - `views/MatchHubView.vue`：创建赛季按钮放在比赛页赛季选择区域，当前仅测试构建打开。
  - `components/season/SeasonPresetManager.vue`：按固定预设创建赛季，可未来接入正式管理后台。
  - `constants/seasonPresets.js`：S1-S5 创建赛季所需的固定规则元数据。
- 测试构建产物 `client/dist-test/` 是构建产物，不提交 Git。

---

## 3. 数据模型

### 3.1 实体关系

```
Club (1) ─────────────────────────────────────────────
  │
  ├── Player (*) ──┬── player_titles (*) ── Title (*)
  │                ├── booking_records (*)
  │                └── Match.teamA / Match.teamB (JSON)
  │
  ├── Season (*) ──┬── Round (*) ── Match (*) ── Game (*)
  │                └── Rule
  │
  ├── Venue (*) ──── booking_records (*)
  │
  └── BookingConfig (1) ── rotation (*)
```

### 3.2 表结构

#### players

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `p{数字}` |
| name | TEXT | 选手姓名 |
| avatar | TEXT | 头像 URL（服务器相对路径） |
| racket | TEXT | 球拍型号（可选） |
| shoes | TEXT | 球鞋型号（可选） |
| displayed_title_id | TEXT FK | 用户选择展示的称号（可选） |

#### seasons

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `S{数字}` |
| name | TEXT | 赛季名称 |
| total_rounds | INTEGER | 总轮次数 |
| best_of | INTEGER | 默认局数：1=一局，3=三局两胜，7=七局打满 |
| status | TEXT | `pending` / `ongoing` / `completed` |
| participants | TEXT | JSON 数组，选手 ID 列表 |
| rule_id | TEXT | 规则标识：`standard` / `s2` / `s3` / `s4` / `s5` |
| comeback_data | TEXT | JSON，规则专用数据（S2/S3 Buff、S4 星尘、S5 骰子等） |
| color | TEXT | 赛季主题色 |

#### rounds

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `R{数字}` |
| season_id | TEXT FK | 所属赛季 |
| round_no | INTEGER | 第几轮 |
| status | TEXT | `pending` / `in_progress` / `completed` |
| venue_manager_id | TEXT FK | 订场负责人（可选） |

#### matches

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `R1-M1` 或 `F-{timestamp}` |
| season_id | TEXT FK | 所属赛季（友谊赛为 null） |
| round_id | TEXT FK | 所属轮次（友谊赛为 null） |
| type | TEXT | `doubles`（仅双打） |
| team_a | TEXT | JSON 数组，A 队选手 ID |
| team_b | TEXT | JSON 数组，B 队选手 ID |
| best_of | INTEGER | 局数 |
| status | TEXT | `pending` / `in_progress` / `completed` |
| winner | TEXT | `a` / `b` / null |
| date | TEXT | 比赛日期 |
| venue_id | TEXT FK | 场地 ID（可选） |

#### games

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `R1-M1-G1` |
| match_id | TEXT FK | 所属比赛 |
| game_no | INTEGER | 第几局 |
| score_a | INTEGER | A 队得分 |
| score_b | INTEGER | B 队得分 |
| winner | TEXT | `a` / `b` / null |
| status | TEXT | `pending` / `in_progress` / `completed` |
| completed_at | TEXT | 完成时间 |

#### game_rule_events

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 规则事件 ID |
| season_id | TEXT FK | 所属赛季 |
| round_id | TEXT FK | 所属轮次 |
| match_id | TEXT FK | 所属场比赛 |
| game_id | TEXT FK | 所属小局 |
| rule_id | TEXT | 规则标识 |
| timing | TEXT | 生命周期时点：`beforeRound` / `afterGame` / `afterRound` |
| type | TEXT | 事件类型：`dice` / `resistance` / `pierce` 等 |
| payload | TEXT | JSON，规则事件数据 |
| created_at | TEXT | 创建时间 |

#### titles

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 格式 `t_xxx` |
| name | TEXT | 称号名称 |
| level | TEXT | `hidden` / `S` / `A` / `B` / `C` |
| type | TEXT | `auto`（自动计算）/ `manual`（手动授予） |
| condition_desc | TEXT | 获得条件描述 |
| sort_order | INTEGER | 排序权重 |

#### player_titles

| 字段 | 类型 | 说明 |
|------|------|------|
| player_id | TEXT FK | 选手 ID |
| title_id | TEXT FK | 称号 ID |
| season_id | TEXT | 关联赛季（可选） |
| awarded_at | TEXT | 授予时间 |

#### venues / booking_config / booking_records / club

（完整表结构见 `server/src/db/schema.sql`）

---

## 4. 业务规则

### 4.1 比赛生命周期

```
                    ┌─ 取消 → (删除)
                    │
创建(pending) → 开始(in_progress) → 结束(completed)
                    │                    ↑
                    │  暂停(保持in_progress, 比分保留)
                    │                    │
                    └── 继续 ────────────┘
```

**规则**：
- 创建比赛时，默认局数从赛季继承（友谊赛默认 BO3）
- 开始比赛时自动创建对应数量的局（BO1=1局, BO3=3局, PA7=7局），第一局自动激活
- 暂停比赛：保存当前比分，保持 `in_progress`
- 结束比赛后不可再记分，但已完成局可通过 `updateCompletedGameScore` 修改
- 撤回局：只能撤回最后一个已完成的局（`revertGame`），其后所有局一并删除

**前端 Store 方法**（封装在 `matchesStore`）：
- `startMatch(id)` / `endGame(id, a, b, winner, payload)` / `revertGame(id)` / `updateCompletedGameScore(id, a, b, winner, payload)`
- View 层不直接调 api，全部通过这些方法

### 4.2 赛季规则引擎

规则模块是**插件式**的，位于 `client/src/rules/`。每个规则导出统一接口：

```typescript
interface RuleModule {
  id: string
  name: string
  description: string

  // 计算选手最终积分
  calcPlayerScore(playerId, matches, getGamesByMatch, context): number

  // 计算排名（返回排序后的数组）
  calcRankings(participants, matches, getGamesByMatch, getPlayerById, context): Ranking[]

  // 获取选手 Buff 状态
  getPlayerBuffs(playerId, matches, getGamesByMatch, context): Buff[]

  // 获取赛季 Buff 结算状态
  getSeasonBuffStatus(matches, getGamesByMatch, rounds, context): BuffStatus
}
```

**已有规则**：
| ID | 名称 | 说明 |
|----|------|------|
| `standard` | 标准规则 | 纯积分制，无特殊 Buff |
| `s2` | S2 绝地反击 | 绝对压制 + 绝地反击骰子 |
| `s3` | S3 超能饮料 | 超能饮料 + 压制2.0 + 关键先生 |
| `s4` | S4 星尘之征 | 上篇四象骰子 + 下篇组合赛 |
| `s5` | S5 异变秩序 | 10轮 BO3；赛前骰子决定15/21分制；异变轮结算债务；记录贯穿暂停使用和债务结算；未开始时不生成轮次/比赛 |

**添加新规则**：在 `client/src/rules/` 下新建文件，实现 `RuleModule` 接口，在 `index.js` 注册即可。

**规则生命周期**：

| 时点 | 用途 | 示例 |
|------|------|------|
| `beforeRound` | 创建/开始轮次前必须完成的赛前结算 | S5 赛前投骰，写入 `comeback_data.s5.roundDice` |
| `roundStart` | 轮次创建、对阵生成、赛季从 `pending` 进入 `ongoing` | 自动生成 BO3/PA7 比赛 |
| `afterGame` | 小局结束后的规则事件与派生数据 | S5 抵抗胜方、贯穿触发次数 |
| `afterRound` | 轮次完成后的结算与排名数据 | S5 异变债务、大分/小分/特殊奖励结算 |

后端规则插件位于 `server/src/rules/`。标准规则是默认内核；赛季规则通过插件覆盖生命周期钩子，不直接修改通用校验。

### 4.3 记分规则

- **记分方式**：数字键盘直接输入两队得分，实时验证合法性
- **结束本局**：满足 21 分制规则（≥21 且领先 ≥2，或先到 30/21 封顶）且双方分数不相等方可结束
- **实时验证**：`useScoringValidation` 与后端 `scoringService.canEndGame` 逻辑一致
- **BO3 判定**：先赢 2 局者获胜
- **BO1 判定**：1 局定胜负
- **PA7 判定**：打满 7 局，按总赢局数判定胜者

### 4.4 统计维度

| 维度 | 说明 | 计算方式 |
|------|------|----------|
| **大分** | 比赛胜负 | 赢 1 场 +1 |
| **小分** | 局数胜负 | 赢 1 局 +1（BO3 可 +2/:0 或 +2/:1） |
| **得分** | 具体比分 | 所有局的得分总和 |
| **净胜分** | 得分差 | 本方得分 - 对方得分 |
| **胜率** | 比赛胜率 | 赢场 / 总场 |

### 4.5 称号系统

五级称号：**S 金 > A 紫 > B 蓝 > C 绿 > hidden 灰**

- **自动称号**：由系统根据赛季数据自动计算（如"S1 赛季总冠军"）
- **手动称号**：管理员手动授予（如"装备专家"）
- **展示称号**：用户可选择展示哪个已解锁的称号，默认展示最高级

---

## 5. 页面与路由

### 5.1 路由表

| 路径 | 组件 | Tab | depth | 说明 |
|------|------|-----|-------|------|
| `/` | HomeView | home | 0 | 首页 |
| `/matches` | MatchHubView | matches | 0 | 比赛中枢（赛季+友谊赛） |
| `/matches/:id` | MatchDetailView | — | 1 | 比赛详情 |
| `/scoring/:matchId` | ScoringView | — | 2 | 记分页 |
| `/rankings` | RankingsHubView | rankings | 0 | 积分榜 |
| `/venues` | VenueView | venues | 0 | 场地管理 + 订场 |
| `/players/:id` | PlayerDetailView | — | 1 | 选手详情 |
| `/season/overview` | SeasonOverview | — | 0 | 赛季概览 |
| `/season/rounds` | SeasonRounds | — | 0 | 轮次记录 |
| `/season/rankings` | SeasonRankings | — | 0 | 积分榜（旧） |
| `/season/rules` | RuleDashboard | — | 0 | 规则面板 |

### 5.2 导航结构

- **Header**（吸顶）：BAD Club 标题 + 测试模式标识 + 主题切换 + 停车缴费；详情页滚动时隐藏
- **TabBar**（底部胶囊）：首页 / 比赛 / 积分榜 / 场地；记分页和详情页隐藏
- **页面过渡**：同级 Tab 切换 fade，进入详情 slide-left，返回 slide-right

---

## 6. 组件契约

### 6.1 原子组件 (components/ui/)

#### Button

```typescript
props: {
  variant: 'primary' | 'secondary' | 'danger' | 'ghost'
  size: 'sm' | 'md' | 'lg'
  loading: boolean
  disabled: boolean
  block: boolean  // 是否撑满宽度
}
events: ['click']
slots: ['default', 'prefix', 'suffix']  // prefix/suffix 放图标
```

#### Card

```typescript
props: {
  padding: 'sm' | 'md' | 'lg' | 'none'
  clickable: boolean  // 是否有点击态
}
events: ['click']
slots: ['default', 'header', 'footer']
```

#### Sheet (底部弹出面板，替代 Modal 作为首选)

```typescript
props: {
  show: boolean
  title: string
  height: 'auto' | 'half' | 'full'
}
events: ['close']
slots: ['default']
```

#### Toast

```typescript
// 命令式调用，非组件
useToast().show({ message, type: 'success' | 'error' | 'info', duration: 3000 })
```

#### Badge / Avatar / Input / Skeleton / EmptyState

（接口定义在组件源码的 JSDoc 中）

### 6.2 业务组件

#### GameScoreInput (components/match/) — 记分数字输入板

```typescript
props: {
  scoreA: number, scoreB: number
  matchScore: { scoreA, scoreB }
  teamAPlayers: string[], teamBPlayers: string[]
  bestOf: number, maxScore: number
  hasCurrentGame: boolean, isMatchOver: boolean
  borderClass: string
}
events: ['update:scoreA', 'update:scoreB']
```

#### CompletedGamesList — 已完成局列表（含规则事件 Badge + 撤回/编辑按钮）

#### EndGameConfirmSheet — 结束本局确认面板

---

## 7. API 规范

### 7.1 统一响应格式

```json
// 成功 - 单条
{ "success": true, "data": { ... } }

// 成功 - 列表
{ "success": true, "data": [...], "meta": { "total": 50 } }

// 错误
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

### 7.2 端点清单

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/players` | 选手列表 / 创建 |
| GET/PUT/DELETE | `/api/players/:id` | 选手 CRUD |
| GET/POST | `/api/seasons` | 赛季列表 / 创建 |
| GET/PUT/DELETE | `/api/seasons/:id` | 赛季 CRUD |
| POST | `/api/seasons/:id/actions/:actionId` | 赛季动作（S5 投骰/暂停/偿债） |
| GET/POST | `/api/rounds` | 轮次列表 / 创建 |
| PUT/DELETE | `/api/rounds/:id` | 轮次 CRUD |
| GET/POST | `/api/matches` | 比赛列表 / 创建 |
| GET/PUT/DELETE | `/api/matches/:id` | 比赛 CRUD |
| POST | `/api/matches/:id/start` | 开始比赛（创建局） |
| POST | `/api/matches/:id/cancel` | 取消比赛 |
| GET | `/api/matches/:matchId/games` | 比赛局列表 |
| GET | `/api/games` | 全局局列表 |
| PUT | `/api/games/:id/score` | 更新局比分 |
| POST | `/api/games/:id/end` | 结束本局 |
| POST | `/api/games/:id/revert` | 撤回最后一局 |
| POST | `/api/games/:id/update-completed-score` | 修改已完成局比分 |
| GET/POST | `/api/venues` | 场地列表 / 创建 |
| PUT/DELETE | `/api/venues/:id` | 场地 CRUD |
| GET/PUT | `/api/club` | 俱乐部信息 |
| GET | `/api/titles` | 称号列表 |
| GET | `/api/titles/all-players` | 选手称号 |
| GET/PUT | `/api/bookings/config` | 订场配置 |
| GET/POST | `/api/bookings/records` | 订场记录 |
| PUT/DELETE | `/api/bookings/records/:id` | 订场记录 CRUD |
| POST | `/api/upload/avatar` | 上传头像 |
| POST | `/api/admin/reset-db` | **测试环境** 从生产恢复数据 |

---

## 8. 设计系统

### 8.1 颜色

（详见 `client/src/styles/tokens.css`，OKLCH 色板）

- **Accent**: 青色系，用于主操作和选中态
- **Success / Warning / Danger**: 绿/黄/红，语义化
- **Neutral**: 从品牌色微偏的灰色阶（0.005 chroma），用于背景和边框

日间模式为默认，暗色模式为可选偏好。

### 8.2 排版阶梯

| Token | 字号 | 字重 | 用途 |
|-------|------|------|------|
| `text-xs` | 0.75rem | 400 | 辅助信息、时间戳 |
| `text-sm` | 0.875rem | 400 | 正文、标签 |
| `text-base` | 1rem | 400 | 正文主要 |
| `text-lg` | 1.125rem | 500 | 卡片标题 |
| `text-xl` | 1.25rem | 600 | 页面区块标题 |
| `text-2xl` | 1.5rem | 700 | 页面主标题 |
| `text-3xl` | 2rem | 800 | 记分大数字 |

字体：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif`

### 8.3 间距

基于 4px 单位：4, 8, 12, 16, 20, 24, 32, 40, 48, 64

### 8.4 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| `rounded-sm` | 6px | 按钮、输入框 |
| `rounded-md` | 10px | 小卡片、Badge |
| `rounded-lg` | 16px | 卡片 |
| `rounded-xl` | 20px | 大容器、Sheet |
| `rounded-full` | 9999px | 头像、药丸按钮 |

---

## 9. 状态管理

### 9.1 Store 职责

```typescript
// 每个 Store 遵循统一模式
defineStore('name', () => {
  const items = ref([])
  const loading = ref(false)
  const initialized = ref(false)

  const getById = (id) => items.value.find(...)

  async function init(options = {}) {
    if ((initialized.value || loading.value) && !options.force) return
    loading.value = true
    try {
      const res = await api.get('/resource')
      if (res.success) items.value = res.data
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function create(data) { /* → res.success ? res.data : null */ }
  async function update(id, data) { /* → res.success ? res.data : null */ }
  async function remove(id) { /* → res.success (boolean) */ }

  return { items, loading, initialized, getById, init, create, update, remove }
})
```

**约定**：
- 所有 API 调用封装在 Store 方法内，View 不直接 import `api`
- `init()` 必须有 `initialized` + `options.force` 防重守卫
- 写操作返回值：create/update → `data|null`，delete/action → `boolean`
- Store 不做业务计算（排名/规则）→ 交给 composables 和 rules

### 9.2 初始化顺序

```
App.vue onMounted
  → useAppInit().initAllStores()
    → Promise.all([
        clubStore.init(),
        playersStore.init(),
        venuesStore.init(),
        titlesStore.init(),
        seasonsStore.init(),
        matchesStore.init(),
        bookingsStore.init()
      ])
```

---

## 10. 扩展指南

### 10.1 添加新页面

1. 在 `client/src/views/` 创建 `.vue` 文件
2. 在 `client/src/router/index.js` 添加路由
3. 如需底部 Tab，在 `App.vue` 的 TabBar 配置中添加

### 10.2 添加新赛季规则

1. 在 `client/src/rules/` 创建 `my-rule.js`
2. 实现 `RuleModule` 接口（见 [4.2](#42-赛季规则引擎)）
3. 在 `client/src/rules/index.js` 注册
4. 在 `server/src/services/ruleService.js` 添加对应的后端逻辑（如需要）
5. 在数据库初始化脚本中确保规则可被引用

### 10.3 添加新称号

1. 在 `server/src/db/migrations/` 添加迁移脚本
2. 在 `titles` 表插入新称号
3. 自动称号：在 `client/src/services/titleCalculator.js` 添加计算逻辑
4. 手动称号：无需额外代码，管理员通过 UI 授予

### 10.4 添加新 API 端点

1. 在 `server/src/services/` 添加业务逻辑
2. 在 `server/src/controllers/` 添加控制器（薄封装）
3. 在 `server/src/routes/` 添加路由定义
4. 在 `server/src/app.js` 挂载路由
5. 在 `client/src/api/` 添加前端调用
6. 更新本文档 [7.2](#72-端点清单)

### 10.5 修改设计系统

1. 修改 `client/src/styles/tokens.css` 中的 CSS 变量
2. 如需新增组件变体，修改 `client/src/components/ui/` 对应组件
3. 所有引用设计 token 的地方自动生效

---

*文档版本：v2.0 | 最后更新：2026-05-25*
