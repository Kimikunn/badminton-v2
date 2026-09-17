# PRD: 锁场整单打包与场馆反馈治理

## Goal

让"连打两小时 / 双打两片场"这类**需要多个片次的意图真的能锁成**，方式是把整单片次打包成**一笔订单**（当前是逐片次各下一笔，必然撞上场馆"有未支付订单就不能再下单"的限制）；同时把场馆的反馈信息（已有未支付订单、距开场不足 12 小时不可退款）接入系统行为与推送，并按场馆"每天 2 片次"的硬上限收敛可配置项。

## Background（实测与代码取证）

### 场馆侧事实（2026-09-17 实测）

- **一笔订单可装多个片次**（决定性实验）：对 `2026-09-18` 提交 `createOrder([11:00-12:00, 12:00-13:00])`（两条 `areaItems`）→ `code=200`、`areaOrderId=153439`、`totalAmount=70`（2 × ¥35）→ 两个时段确实进了同一笔订单。
- **`LIMITED_BY_START_TIME` 是软提示不是拦截**：`createOrderCheck` 对 `2026-09-18 09:00` 返回 `success=N code=LIMITED_BY_START_TIME`，但紧接着 `createOrder` 成功（`areaOrderId=153436`）。下单响应 `bookingNotice` 原文：**"距开场时间不足 12 小时的订单，不予退款"**。同一日期 `09:00/10:00`（距今 ~11-12h）返回该码，`11:00` 起（>13h）返回 `Y` → 该码含义就是"近场次不可退款"的提示。
- **下单响应带回 `expireTime`**（如 `2026-09-17 22:28:28`，即未支付订单 5 分钟释放的精确时刻）与 `availableBalance=0`（余额支付暂不可用）、`bookingNotice` 场馆须知全文。
- **每日上限 = 2 片次**（用户确认；"两笔订单"即"两个片次"，一片场地一小时算 1 片次，退订返还）。推论：`连打 2 小时 × 1 片`（2 片次）✅、`2 片场 × 1 小时`（2 片次）✅、`2 片场 × 2 小时`（4 片次）❌ 需跨天、`3/4 小时 × 1 片` ❌ 超上限。
- **有 1 笔未支付订单时不能下第二笔**：生产真实失败记录 `2026-09-11 11:38`，`error = 自动锁场下单失败：您存在未支付的订单，请先完成后再下单！`（`error_code=UNPAID`）。

### 代码现状

- 逐片次下单：`bookingLockService.buildAreaItems(slot)` 只组装 **1 个 item**（`server/src/services/bookingLockService.js:44`），`placeOrder(slot)`（`:119-146`）每次 `createOrderCheck` + `createOrder` 各一次 → 一个 2 片次的意图会下 **2 笔订单** → 第 2 笔必被 `UNPAID` 挡回，整段永远凑不齐。
- `tryFulfill`（`:300-350`）先 `lockRun.findRun(hourMap, intent)` 选出连续段，再对段内每小时逐片次 `attemptLock`（`:349` 附近）；`occurrenceFulfilled` 判定整段满足。
- 每日限订闸门：`heldOrdersToday()`（`:230-234`）按 `booking_intent_locks` 中 `status='locked'` 的**行数**计数（一行 = 一片次，口径与场馆一致），`needTotal` 为整段所需笔数；`held + needTotal > limit` 时停手并推「已达限订」（`:305-312`）。
- `classifyErrorCode`（`:66-79`）：风控 → `RISK_CONTROL`；`check` 阶段失败或文案含"已被预订" → `SOLDOUT`；含"未支付" → `UNPAID`；含"限订" → `LIMIT`；其余 `OTHER`。**当前把 `LIMITED_BY_START_TIME` 归为 `LIMIT`**，会把"近场不可退款提示"误判为限订失败。
- 校验：`intentValidators.js` 允许 `durationHours` 1-12、`courtsNeeded` 1-3，**没有"片次总数"约束** → 用户能配出 4 片次（`2 小时 × 2 片`）这种必然失败的组合。
- 前端 `DaySheet.vue`：时长选项 `['1','2','3','4']`、片场选项 `['1','2','3']`，无组合联动。

## Requirements

- **R1 整单打包**：一次锁场动作把该整单的全部片次（`连打时长 × 片场数`，当前最多 2 个）放进**一笔订单**提交；成功时同一 `orderId` 落 N 条 `locked` 记录，失败时落 N 条 `failed` 记录（同 error/error_code）。
- **R2 配置收敛**：时长只允许 1-2 小时；片场只允许 1-2；**组合约束 `时长 × 片场 ≤ 2`**；服务端跨字段校验拒绝越界组合（422），前端联动禁用非法组合。
- **R3 UNPAID 停机**：下单被场馆以"存在未支付订单"拒绝时，**不再重试**：推一条明确通知（含已有订单信息/指引）并**自动停用该意图**，由用户决定支付与是否重开监控。
- **R4 近场次软提示**：`createOrderCheck` 返回 `LIMITED_BY_START_TIME` 时**不阻断下单**，照常提交；成功后推送需注明"距开场不足 12 小时，不可退款"。
- **R5 支付截止时间可视化**：从下单响应取 `expireTime` 落库，用于推送文案与界面展示（比现有"约 5 分钟"更准）。
- **R6 每日限订口径不变**：闸门继续按"locked 记录条数 = 片次"计数，上限仍取 `GYM_DAILY_ORDER_LIMIT`（默认 2）。

## Acceptance Criteria

- **AC1**：`2 小时 × 1 片` 意图在整段可订时只产生 **1 笔订单**（1 次 `createOrder`），落 **2 条** locked 记录且 `order_id` 相同。
- **AC2**：`1 小时 × 2 片` 意图同上（1 笔订单、2 条 locked 记录）。
- **AC3**：越界组合被拒：`durationHours=3` → 422；`courtsNeeded=3` → 422；`2 小时 × 2 片` → 422（文案说明"每天最多 2 个片次"）。
- **AC4**：下单被 `UNPAID` 拒绝时：不再对同一意图重试；推一条含"存在未支付订单"的通知；该意图 `enabled` 变为 `false`（状态回落 `paused`）。
- **AC5**：`createOrderCheck` 返回 `LIMITED_BY_START_TIME` 时仍会调用 `createOrder`（不被当作失败）；成功后的推送文案包含"不可退款"。
- **AC6**：`booking_intent_locks.expire_at` 落库（UTC），接口输出该字段；推送含支付截止时间（本地时区可读）。
- **AC7**：既有能力不回归：风控 429 仍进 4 分钟重试窗口；被抢（`SOLDOUT`）仍继续盯回流；`锁到即停`、每日限订闸门、通知/锁场记录按天查询均正常。
- **AC8**：`cd server && npm test` 全绿；`cd client && npm run build` 通过；前端非法组合在 UI 上不可提交。

## Decisions

- **D1**：保留连打 1-2 小时；**去掉 3/4 小时**（超每日 2 片次上限，物理上不可完成）。
- **D2**：不做"2 片场 × 2 小时"（4 片次，跨天才行，而锁到即停会关监控 → 不值得支持）。
- **D3**：整单打包成一笔订单（而非逐片次多笔）——这是让多片次真正可行的前提。
- **D4**：UNPAID → 推送 + 自动停用（用户决策 2026-09-17），不做支付状态跟踪（沿用 2026-08-30 决策）。
- **D5**：`LIMITED_BY_START_TIME` 视为软提示，照常下单 + 文案提示不可退款（实测支持）。

## Out of Scope

- 支付自动化（余额支付 `availableBalance=0`，暂不可用）。
- 跨天的多片次需求（需要用户手动重开监控）。
- 每天 ≥3 片次的场景（等场馆放宽上限后再评估，`GYM_DAILY_ORDER_LIMIT` 已可配）。

## 验收记录（2026-09-17）

| 项 | 证据 |
|---|---|
| AC1/AC2 整单打包 | `bookingLock.test.js`：2 小时连打与 1 小时 2 片各自 `orderCalls === ['check','create']`（只 1 笔订单）、`areaItems.length === 2`、N 条记录同 `order_id`；引擎级用例（`watchEngine.test.js`）同样断言一轮只 1 次 createOrder |
| AC3 校验收敛 | 测试环境接口实测：3 小时 → 422「打球时长只能是 1-2 小时（暂不支持连打 2 小时以上）」；3 片 → 422「同时片数只能是 1-2（同一天最多 2 片次）」；2×2 → 422「每天最多 2 个片次（场地×小时），当前组合需要 4 个」；2×1 / 1×2 → 201 |
| AC4 UNPAID 停机 | `bookingLock.test.js`：失败后 `enabled=false`、推送标题【需要先支付】、`error_code='UNPAID'`、二次调用 `skipped==='disabled'` 且 0 次下单 |
| AC5 软提示 | `bookingLock.test.js`：`LIMITED_BY_START_TIME` 仍走 `['check','create']`、成功推送含“不可退款”、`error_code='LIMIT'` 记录数为 0 |
| AC6 支付截止 | `bookingLock.test.js` 北京时间 `22:28:28 → UTC 14:28:28`；`intentApi.test.js` 断言 `/locks` 输出 `expireAt`；生产迁移后 `booking_intent_locks` 已含 `expire_at` 列 |
| AC7 无回归 | 风控仍走 `aborted='risk_control'` → 4 分钟重试窗口；被抢仍继续盯回流；锁到即停、限订按片次、按天查询均有用例；生产 7 条意图未变（4 paused + 3 waiting）、锁场记录 16 条完好 |
| AC8 测试/构建/UI | `npm test` **214/214**；`npm run build` 通过；Playwright 实测（8090）：时长选项 `['1 小时','2 小时']`、片场 `['1 片','2 片']`；点「2 小时」→ 片场自动收敛为 1 片且提示「场馆每天只给 2 个片次：2 片次 · 一次下单、一次支付」；点「2 片」→ 时长自动收敛为 1 小时；2×1 可保存成功 |
| 迁移 019 | 测试库与生产库启动均打印 `Running migration: 019_lock_expire_at.sql`；列已加、行数不变；副本演练确认幂等（二次启动 / 抹标记重跑） |
| 部署 | 测试 8090 与生产 8088 均重建镜像；前端产物 hash 与本地 dist 一致（`index-BUH67NcT.js`）；容器无重启、日志无 error |
| 待观察 | 放票日 **09:00 实战**（下一次放票）：连打意图是否一笔订单装 2 片次、UNPAID 时是否停用并推送；本次未在放票窗口做真实下单验证 |

### 审查处置（独立 review 子代理）

无 P0。P1-1（文档未同步）已在本任务内完成：`CONTEXT.md`（每日 2 片次 + 未支付硬约束 + 整单打包 + 支付截止 + 不可退款软提示 + 时长/片场可选范围）与 `spec/backend/api-routes.md`（expireAt 与整单打包契约）。P2 顺手修了三条：落库不完整补 `logger.warn`、跨轮拼接的支付截止取最晚一条、锁场记录面板补显示支付截止；P2-1（UI 自动化证据）已用 Playwright 走查补齐（见上表 AC8）。
