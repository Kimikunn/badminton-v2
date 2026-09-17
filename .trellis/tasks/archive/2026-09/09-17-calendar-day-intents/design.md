# Design: 订场监控与日历合并（按天开启监控）

> 配套 `prd.md`（需求、状态机、验收标准）。本文件只写技术设计与契约。

## 1. 边界与依赖方向

```
                     ┌──────────────────────────────────────────┐
                     │ client                                    │
  VenueView ──┬──> BookingCalendar（纯展示：月历格子 + 徽标）      │
              ├──> DaySheet（当天：订场记录 / 不可用 / 监控 / 历史）│
              └──> VenueWatchSettingsSheet（总开关 + 锁场优先级）    │
                     │  stores/intent.js（状态唯一来源 + 聚合派生）│
                     └──────────────────────────────────────────┘
                                     ▲ /api/intents*
                     ┌───────────────┴──────────────────────────┐
                     │ server                                    │
  routes/intentRoutes ──> validators/intentValidators             │
                     ──> controllers/intentController（编排 + 注入引擎状态）
                     ──> services/intentService（派生 status / CRUD / 清扫）
                     ──> services/lockRun（纯函数：整段满足判定，新模块）  │
                     ──> services/watchEngine（取数、burst、风控重试、暴露状态）
                     ──> services/bookingLockService（锁场、记录落库）    │
                     └──────────────────────────────────────────┘
```

依赖方向保持不变：engine → service → db。新增的 `lockRun.js` 是**无 DB 依赖的纯模块**，被 `bookingLockService` 与 `intentService` 同时引用，避免二者互相 require 形成环（现状 `bookingLockService` 已 require `intentService`）。

## 2. 数据模型与迁移（migration 018）

### 2.1 目标形态

`booking_intents`：

- 语义唯一：`date`（YYYY-MM-DD）必有值；`weekdays` 列**删除**。
- 一天多条即多行（同一 `date` 多行，各自 `window_start/window_end`）。

`booking_intent_locks`：

- 新增 `error_code TEXT`，枚举 `RISK_CONTROL | SOLDOUT | LIMIT | UNPAID | OTHER`（历史行为 NULL）。
- 失败原因不再依赖中文文案；`status` 仍为 `locked | failed | expired`。

### 2.2 迁移步骤（顺序不可换，整体事务）

`server/src/db/migrations/018_single_date_intents.sql` + `db.js` 特判函数 `migrateSingleDateIntents()`（沿用 015/016/017 的"SQL 记录 + 代码执行 + `hasColumn` 幂等"约定）：

1. `ALTER TABLE booking_intent_locks ADD COLUMN error_code TEXT`（`hasColumn` 守卫）。
2. 回填历史失败记录的 `error_code`：`error LIKE '%风控%' → RISK_CONTROL`、`'%未支付%' → UNPAID`、`'%限订%' → LIMIT`、`'%已被预订%'/'%已预订%' → SOLDOUT`，其余留 NULL（无法可靠判定就不猜）。
3. 遍历 `weekdays IS NOT NULL` 的行：按当前放票窗口（`today ~ today+3`）展开匹配日期，**每个日期插入一条 date 意图**，复制 `mode/window_start/window_end/duration_hours/courts_needed/preferred_area_ids/enabled`；原行删除。
   - 窗口内无匹配（例如 weekly 是周一而窗口落在周四~周日）时：**展开为"下一个发生日"（今天起 7 天内首个匹配星期）而不是删行**，并在迁移日志中记 `id→date`。理由：单日模型允许任意未来日期（D2），该日进放票窗口后自动生效，零配置丢失；实测生产 3 条 weekly 走此路径（→ 09-21/22/23）。
   - 仅当 `weekdays` 非法/为空、无法推出任何日期时才删行（记名单）。
   - 注：016 的 v1 导入路径（`migrateIntentRefactor`）保留旧规则"窗口内无匹配则丢弃"（`db.js:290`），未同步为承接语义——该路径对生产已是历史（016 早已应用），不在本次改动面内。
4. `ALTER TABLE booking_intents DROP COLUMN weekdays`。
5. `schema.sql` 同步：新库直接建 `date` NOT NULL 语义（列定义保留可空以兼容旧数据，但**校验层强制必有值**）、`booking_intent_locks.error_code`。

幂等与安全：步骤 2/4 用 `hasColumn` 守卫；步骤 3 只在 `weekdays` 列存在时执行（列被删掉后自然跳过），保证重复启动不重复展开。

**回滚**：无 SQL 回滚。回滚 = 停止容器 → 用 `server/database/backups/<pre-deploy>.db` 覆盖 → 回退镜像 tag。部署前必须做备份（`server/database/backups/`，沿用既有命名 `<db>.pre-<变更名>-<时间戳>`）。

## 3. 服务端契约

### 3.1 状态派生（单一事实来源）

```js
// server/src/services/intentService.js
/**
 * 纯函数：不含 IO。ctx 的所有外部事实由调用方注入，便于逐条测试。
 * 优先级从上往下，首个命中即为准；顺序即契约，改顺序必须改测试。
 */
function deriveIntentStatus(row, ctx)
// ctx = {
//   today: 'YYYY-MM-DD',
//   now: Date,                    // pending_release 用（09:00 判定）
//   windowEnd: 'YYYY-MM-DD',      // today + BOOKING_WINDOW_DAYS - 1
//   riskRetryKeys: Set<string>,   // `${intentId}|${date}`（引擎注入）
//   isFulfilled: boolean          // 该意图当天 locked 记录能否凑齐整段
// }
// → 'expired' | 'awaiting_verify' | 'fulfilled' | 'pending_release'
//   | 'waiting' | 'watching' | 'paused'
```

判定顺序（与 PRD 表格一致，测试逐条锁定）：

```
1 expired          date < today
2 awaiting_verify  riskRetryKeys.has(`${row.id}|${row.date}`)
3 fulfilled        ctx.isFulfilled
4 pending_release  enabled && date === windowEnd && now 的本地小时 < RUSH_HOUR
5 waiting          enabled && date > windowEnd
6 watching         enabled && date ∈ [today, windowEnd]
7 paused           其余
```

- `RUSH_HOUR = 9` **上移到 `venueShared.js`**，`watchEngine` 与 `intentService` 共用同一常量（现在只在 `watchEngine.js:40`，复制会产生漂移）。
- `isFulfilled` 由 `lockRun.isOccurrenceFulfilled(row, lockedRows)` 计算，`lockedRows` 取 `booking_intent_locks` 中该 `(intent_id, date)` 且 `status='locked'` 的行。
- `formatIntent()` 输出新增 `status`、`verifyDeadline`（引擎注入，非 `awaiting_verify` 时为 null）、`lastAttempt`；保留 `expired`（= `status === 'expired'`）以兼容未迁移的调用方。

### 3.2 `lockRun.js`（新模块，纯函数）

从 `bookingLockService.js` 抽出、双方共用，行为等价：

```js
module.exports = {
  findRun(hourMap, intent),                 // 原样搬移（bookingLockService.js:252-268）
  isOccurrenceFulfilled(intentRow, lockedRows)  // = findRun(仅 locked 记录构建的 map, intent) !== null
};
```

`bookingLockService.occurrenceFulfilled()`（`:178-180`）改为调用 `isOccurrenceFulfilled`，行为不变（原先就是 `buildHourMap(intent, date, [])`）。

### 3.3 引擎改动（`watchEngine.js`）

1. **暴露风控重试状态**：新增 `getRiskRetries()` → `[{ intentId, date, startedAt, deadline }]`，数据源为 `rcRetrying`（已保存 deadline，见 `riskControlRetryLoop`）。只读，不改重试逻辑。
2. **每日清扫过期意图**：`runTick()` 进入后、`flags.enabled` 早退**之前**调用 `intentService.sweepExpiredIntents()`，用进程内 `lastSweepDate` 去重（每天最多一次）；清扫与总开关无关（属数据卫生，不是监控行为）。
3. **删除每周分支**：`expandIntentDates` 只保留单日路径；`loadActiveIntents()` 的 `dates` 集合来源不变。
4. 删除与 weekly 相关的测试用例，替换为 date-only 断言。

### 3.4 校验规则（`intentValidators.js`，422 矩阵）

| 输入 | 结果 |
|---|---|
| `date` 缺失 / null | 422 `请选择日期` |
| `date` 格式非 `YYYY-MM-DD` | 422 `日期格式必须是 YYYY-MM-DD` |
| `date < today` | 422 `不能给过去的日期设置监控` |
| `date > today+3` | **接受**（D2 提前设置） |
| 传 `weekdays`（任意值） | 422 `不再支持每周重复，请按日期设置` |
| `windowStart >= windowEnd` | 422（不变） |
| `durationHours * 60 > 窗口长度` | 422（不变） |
| `mode` 非枚举 / `courtsNeeded` 越界 | 422（不变） |

`PUT /api/intents/:id` 为 partial 版本，跨字段校验沿用"省略字段取现有行值合并"的现有模式（`crossFieldRules({ partial: true })`）。

### 3.5 API 契约

| 路由 | 变更 |
|---|---|
| `GET /api/intents` | 支持 `?from=YYYY-MM-DD&to=YYYY-MM-DD` 过滤；返回项含 `status` / `verifyDeadline` / `lastAttempt`。无过滤时返回全部（含过期，前端自行按日期取用） |
| `POST /api/intents` | 只接受 `date` 模式；`weekdays` → 422 |
| `PUT /api/intents/:id` | 同上；不再支持切换模式 |
| `GET /api/intents/locks` | 新增 `?date=YYYY-MM-DD` 过滤（与既有 `?intentId=` 可并用） |
| `GET /api/intents/notifications` | 新增 `?date=` 过滤 |
| `GET /api/intents/areas`、`/config`、`/availability`、`POST /token` | 不变 |

响应包裹不变（`utils/response.js` 的 `success/error` 信封；写入受 `requireWriteAuth` 保护，GET 全公开）。

`lastAttempt` 结构（由 `booking_intent_locks` 派生，取该 `(intent_id, date)` 最近一行 + 当日失败次数）：

```json
{ "status": "failed", "errorCode": "RISK_CONTROL", "error": "…", "createdAt": "UTC 时间戳", "attempts": 4 }
```

## 4. 前端设计

### 4.0 状态模型：一天两个正交维度

界面与 store 都按这个结构组织，**任何地方不得把不可用折进监控状态**：

| 维度 | 数据来源 | 派生在哪 | 渲染在哪 |
|---|---|---|---|
| 监控状态 | `booking_intents` 行 + `booking_intent_locks` + 引擎重试集 + 时间事实 | 服务端 `deriveIntentStatus()`（纯函数）→ 行的 `status` | 日历徽标 = 当天监控聚合；sheet = 逐条列表 |
| 日期标记 | `unavailable_days` 行 | 直接用（布尔） | 格子 X 覆盖（现有 `v-if="cell.isUnavailable"` 分支，与徽标二选一）；sheet 内提示 + 取消标记入口 |

正交带来的确定性：无优先级表可争（不存在 `blocked` vs `watching`）、无双向同步（取消标记不需恢复任何记忆）、引擎侧已经是实时求值（`expandIntentDates()` 每次都读 `unavailable_days`）。

交互规则：

- 给已有监控的日期打标记 → 二次确认（沿用现有"该日有 N 条订场记录…"的 confirm 模式）。标记后监控 `enabled` 不变，引擎下次展开自动跳过。
- 取消标记 → 下次 tick 自动恢复参与，不写任何状态。
- 不可用日的 sheet：监控区块换成提示 + 取消标记入口（不可达新建）；API 层不因此报错，校验层不耦合 `unavailable_days`。

### 4.1 组件切分

| 组件 | 职责 | 变更 |
|---|---|---|
| `BookingCalendar.vue` | 纯展示：月历格子、订场圆点、不可用 X、**监控徽标**；`@select-day` 上抛 | 把内部 sheet 抽出去；新增 `monitorStatusByDate` 入参 |
| `DaySheet.vue`（新） | 当天 sheet：订场记录列表 / 新增订场 / 标记不可用 / **监控区块**（列表 + 新增 + 开关 + 编辑 + 删除）/ 历史（`SHOW_LOGS` 门控，按天） | 从 BookingCalendar 抽出 + 新增监控区块 |
| `VenueWatchSettingsSheet.vue`（新） | 总开关 + 锁场场地优先级（从 `IntentPanel.vue` 的设置 sheet 搬移） | 新；入口在日历页头齿轮 |
| `IntentPanel.vue` | — | **删除** |

### 4.2 `stores/intent.js`（状态集中：两个正交维度各一个来源）

```js
// state
config, intents, areas, loading, initialized

// getters（派生，唯一事实来源）
monitorsByDate   // Map<'YYYY-MM-DD', monitor[]>（同一天多条，按 window_start 排序）
badgeFor(date)   // { status, count } | null：当天监控按聚合优先级折叠
                 // awaiting_verify > fulfilled > watching > pending_release > waiting > paused
                 // 维度二（不可用）不参与聚合：仍用现有 unavailableDateSet 独立渲染 X 覆盖

// actions
init({ force })                   // 现有；支持 from/to
createForDate(date, payload)      // 组装 date 模式 payload 后 POST
updateMonitor(id, patch) / toggleMonitor(id) / deleteMonitor(id)
fetchLocksByDate(date, page)      // GET /intents/locks?date=
fetchNotificationsByDate(date, page)
saveConfig(patch)                 // 现有
```

- 删除 `assembleIntentPayload` 中的 `schedule='weekly'` 分支，只保留 date 形态。
- 聚合用一个小纯函数 `aggregateDayBadge(monitors)`，优先级表以常量数组表达（顺序即契约）；`expired` 不参与（过去日不渲染徽标）。
- **不可用不进这个 store 的聚合**：`unavailable_days` 继续由 `VenueView` 现有的 `unavailableDays` ref / `unavailableDateSet` 提供（正交维度，见 §4.0）。
- 组件不各自 `api.get`：`VenueView` 只调 `store.init()`，徽标与 sheet 都从 store 派生（满足 R4"状态集中管理"）。

### 4.3 交互

- 点日历某天（今天及以后）→ `DaySheet` 打开：上部订场记录（不变），中部监控区块（空态给「+ 开启这天监控」；已有给列表 + 开关 + 编辑 + 删除），下部历史（`SHOW_LOGS`）。
- 新建/编辑监控：时间窗口（9:00-21:00，沿用 `START_HOUR_OPTIONS/END_HOUR_OPTIONS`）、时长 1-4h、次要设置（模式 `auto_lock|notify`、片数 1-3）。**去掉星期条**（日期已由 sheet 决定），去掉 `weekdaysLabel` 的「工作日/周末/每天」文案。
- `awaiting_verify`：徽标 + sheet 内醒目提示 + 截止时间（"请在小程序完成验证，系统会在 XX:XX 前自动重试"）。
- 不可用日期：sheet 内提示"该日已标记不可用，监控不会生效"（保留现有取消标记入口）。
- 日历页头齿轮 → `VenueWatchSettingsSheet`（总开关 + 锁场优先级）。

### 4.4 样式与约定

沿用 Tailwind 设计令牌与既有 `Badge` / `Button` / `Sheet` / `SegmentedControl` 原语；不引入新依赖、不引入 TS 或 lint（`.trellis/spec/frontend/quality-guidelines.md`）。徽标配色：`awaiting_verify` warning、`fulfilled` success、`watching` accent、`pending_release`/`waiting` info、`paused` muted。

## 5. 测试设计

| 文件 | 新增/改写内容（断言点） |
|---|---|
| `server/test/intentService.test.js` | `deriveIntentStatus` 逐状态用例 + 优先级边界（如 `awaiting_verify` 覆盖 `watching`、`fulfilled` 覆盖 `paused`、`windowEnd` 且 08:59 vs 09:00 的 `pending_release` 分界）；`sweepExpiredIntents`（只动过期行、`enabled` 置 0、锁场记录不变）；date-only 创建/更新 |
| `server/test/lockRun.test.js`（新） | `findRun` 连段/片数/窗口边界；`isOccurrenceFulfilled` 与旧行为等价（locked-only） |
| `server/test/intentApi.test.js` | 422 矩阵（缺日期、过去日期、`weekdays` 拒绝、窗口/时长）；提前到窗口外日期 201；`status` 字段随响应返回；`?from/?to` 过滤 |
| `server/test/intentMigration.test.js` | weekly → date 展开（窗口内匹配日、字段复制、enabled 继承）；无匹配行删除并记日志；`weekdays` 列消失；`error_code` 列存在且历史回填正确；迁移幂等（二次启动不重复展开） |
| `server/test/bookingLock.test.js` | 失败记录落 `error_code`：风控 `RISK_CONTROL`、被抢 `SOLDOUT`、限订 `LIMIT`、未支付订单 `UNPAID` |
| `server/test/watchEngine.test.js` | `getRiskRetries()` 在重试窗口内返回条目、窗口结束后清空；每日清扫只跑一次；删除 weekly 用例 |
| 前端 | `cd client && npm run build`（无单测框架）；可选 Playwright：测试环境（8090）手动/脚本走查"点日期 → 建监控 → 徽标出现 → 开关 → 删除" |

## 6. 兼容与发布

- **API 兼容**：`weekdays` 入参从"支持"变"422"，属于有意的破坏性变更；消费方只有本项目前端（同步发布），无第三方。
- **数据兼容**：迁移在容器启动时自动执行（`db.js` → `runMigrations()`）；迁移在任何 HTTP 服务前完成。
- **部署顺序**：备份 DB → 构建前端（`client/dist` + `client/dist-test`，Dockerfile 只 COPY 预构建产物）→ 先测试环境（`-p badmintontest -f docker-compose.test.yml`）验证 → 生产（`docker compose up -d --build`）。
- **观察点**：容器日志 `[DB] Running migration: 018_single_date_intents.sql`；`GET /api/intents` 无 weekly 行；日历徽标与 `status` 一致；`push ok/push fail` 审计日志无异常。

## 7. 权衡记录

| 取舍 | 选择与理由 |
|---|---|
| 状态派生放服务端 vs 前端 | **服务端**。前端无单测框架（`spec/backend/testing.md` "What does not exist"），放前端等于不可测；服务端可逐条断言，前端只做聚合折叠 |
| `findRun` 抽公共模块 vs 控制器里各算 | **抽 `lockRun.js`**。避免"整段满足"两处实现漂移，也避免 `intentService ↔ bookingLockService` 循环依赖 |
| `blocked` 作为监控状态 vs 正交日维度 | **正交日维度**。混进枚举会与 `watching` 产生优先级歧义，并引入"取消标记后恢复成什么"的隐藏状态；正交后两边实时求值、零同步 |
| 删除 `weekdays` 列 vs 保留废弃 | **删除**。用户明确要单模型；保留列会诱导后人写出第二种模型 |
| 无匹配的 weekly 行删除 vs 猜一个日期 | **删除 + 日志**。生产 6 行全部停用，臆造日期比丢失更危险 |
| 过期清理挂引擎 tick vs 惰性读时写 | **挂 tick**（每日一次）。读路径不写库，避免并发下的隐式副作用 |
| 日历组件读 store vs 继续 props | **页面持有 store，组件收 props/派生**：`BookingCalendar` 保持纯展示（沿用现有 prop 风格），`DaySheet` 通过 store action 改写状态 |
