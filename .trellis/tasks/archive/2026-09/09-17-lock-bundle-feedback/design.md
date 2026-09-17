# Design: 锁场整单打包与场馆反馈治理

> 配套 `prd.md`（需求/AC/决策）。本文件只写技术设计与契约，含实测依据。

## 1. 边界与依赖方向

```
watchEngine（取数/burst/风控重试）
   └─> bookingLockService.tryFulfill
         ├─ lockRun.findRun（选出连续段，不变）
         ├─ buildAreaItems(items[])  ← 由「单 item」改为「整单 items」
         ├─ placeOrder(items)        ← 一次 check + 一次 createOrder（一笔订单）
         └─ intentService（落库 / enabled / 通知记录）
   └─> gymOrderClient（createOrderCheck / createOrder，签名不变）
```

依赖方向不变；本次**不新增模块**，改动集中在 `bookingLockService`（下单与落库语义）、`intentValidators`（配置收敛）、`intentService`（输出 `expireAt`）、`DaySheet.vue`（选项与联动）。

## 2. 下单契约（核心改动）

### 2.1 从"逐片次多笔订单"改为"整单一笔订单"

现状：`buildAreaItems(slot)` → `[{...slot.raw}]`（1 个 item），`placeOrder(slot)` 每片次调一次 → 2 片次 = 2 笔订单 → 第 2 笔被场馆 `UNPAID` 拒。

目标契约：

```js
// items: [{ areaId, uniqNo, date, startTime, endTime, price, raw }]  —— 整单全部片次（≤2）
buildAreaItems(items)                 // → [...raw]（透传原始 item，与小程序一致）
async placeOrder(items)               // → { success, orderId, expireAt, softNotice, error, errorCode, riskControl }
  // 1) createOrderCheck(items)
  //    - data.success === 'Y'                      → 继续下单
  //    - data.success === 'N' 且 code === 'LIMITED_BY_START_TIME' → 继续下单，softNotice='no_refund'
  //    - data.success === 'N' 其它 code            → 失败（errorCode 由 classifyErrorCode 判）
  // 2) createOrder(items) → body.code === 200 → 成功，取 data.areaOrderId / data.expireTime
```

关键点：**`LIMITED_BY_START_TIME` 不再阻断**（PRD 实测：该码出现后 `createOrder` 仍返回 200，含义是"距开场 <12h 不可退款"）。

### 2.2 落库语义

`attemptLockOrder({ intent, items, date })` 取代逐片次的 `attemptLock`：

- 先查每个 item 是否已有 `locked` 记录：**已锁的从本次订单里剔除**（避免重复下单；若剔除后为空则直接返回 `skipped: 'already_locked'`）。
- 一次下单后：
  - 成功 → 为每个 item 落一条 `locked` 记录，**同 `order_id` / 同 `expire_at`**（N 条）；
  - 失败 → 为每个 item 落一条 `failed` 记录，**同 `error` / `error_code`**（N 条）。
- 部分唯一索引 `idx_booking_intent_locks_uniq_no_locked`（`uniq_no WHERE status='locked'`）继续兜底并发双锁；insert 异常只记日志（沿用现有 try/catch）。

### 2.3 `tryFulfill` 主流程（改动点标注）

```
① 签名未配置 → skipped no_signer                       （不变）
② 已整段满足 → 补齐 enabled=false                      （不变）
③ run = lockRun.findRun(hourMap, intent)  → null 则不锁（不变）
④ 组装 items：对 run 内每小时，取 need = courts_needed - lockedCount 个候选（按 areaPriority 排序）
⑤ 每日限订闸门：held + items.length > limit → 停手推送（口径：items.length = 片次）
⑥ attemptLockOrder(一次下单)
   ├─ 成功且 occurrenceFulfilled → enabled=false + 推「已锁到」（含订单号、支付截止、不可退款提示）
   ├─ 失败含 UNPAID             → 推「需要先支付」+ enabled=false ← 【新停机路径】
   ├─ 失败含 RISK_CONTROL       → aborted='risk_control'（交给引擎 4 分钟重试窗口，不变）
   └─ 其它失败                  → 推「锁场失败」，继续盯回流（不变）
```

## 3. 场馆反馈 → 系统行为映射（决策表）

| 场馆反馈 | 判定 | 系统行为 |
|---|---|---|
| `createOrderCheck.data.success='Y'` | 正常 | 下单 |
| `code='LIMITED_BY_START_TIME'`（check 阶段） | **软提示：不可退款** | **照常下单**；成功后推送注明"距开场不足 12 小时，不可退款" |
| `code='BOOKING_CONFLICT'` 等 check 失败 | 被抢 | `SOLDOUT`：失败推送，继续盯回流 |
| `createOrder` 文案含"未支付订单" | 已有未支付订单 | `UNPAID`：**推送 + 自动停用**，不再重试 |
| `createOrder` `code` 429 / 403004 | 图形验证风控 | `RISK_CONTROL`：中断本轮，交引擎风控重试窗口 |
| 其它业务码 | 未知 | `OTHER`：失败推送 |

`classifyErrorCode`（`bookingLockService.js:66-79`）保持"文案兜底"能力，但 **`LIMITED_BY_START_TIME` 在 check 阶段不再走"失败"分支**（不产生 `LIMIT` 记录）。

## 4. 支付截止时间（`expire_at`，migration 019）

- 场馆 `createOrder` 响应含 `expireTime`，形如 `2026-09-17 22:28:28`。实测该时间为**北京时间**（同一时刻 UTC 为 14:28）→ 落库统一转成 **UTC**（`'YYYY-MM-DD HH:MM:SS'`），与 `created_at` 口径一致。
- 迁移：`ALTER TABLE booking_intent_locks ADD COLUMN expire_at TEXT`（`hasColumn` 幂等）；`schema.sql` 同步。
- 输出：`formatLockRecord` 增 `expireAt`（UTC）；推送文案用 +8h 渲染为北京时间（沿用既有 `fmtTime` 约定）。

## 5. 校验矩阵（`intentValidators.js`）

| 字段 | 现值 | 改后 |
|---|---|---|
| `durationHours` | 1-12 | **1-2**（422："暂不支持连打 2 小时以上"） |
| `courtsNeeded` | 1-3 | **1-2**（422："同一天最多 2 片次"） |
| 组合 `durationHours × courtsNeeded` | 无约束 | **≤ 2**（422："每天最多 2 个片次（场地×小时），当前组合需要 N 个"） |
| 其它（date 必填、不早于今天、窗口先后、时长 ≤ 窗口、同日同窗口不重复） | — | 不变 |

前端 `DaySheet.vue`：时长选项 `['1','2']`、片场选项 `['1','2']`，并**联动**——选 2 小时则片场锁为 1（禁选 2），选 2 片场则时长锁为 1；内联提示"每天最多 2 个片次"。保存前客户端再兜一次（与既有同窗口校验同一模式）。

## 6. 每日限订闸门的口径

`heldOrdersToday()` 按 `booking_intent_locks` 中 `status='locked'` 的行数计数 —— 一行 = 一个片次，与场馆"2 片次/天"口径**天然一致**，本次不改。`needTotal` 变为 `items.length`（= 片次），闸门比较不变：`held + items.length > GYM_DAILY_ORDER_LIMIT` → 停手推送。

## 7. 测试设计

| 文件 | 新增/改写断言点 |
|---|---|
| `server/test/bookingLock.test.js` | ① 2 小时连打：**只 1 次 `createOrder`**、2 条 locked 记录且 `order_id` 相同；② 1 小时 × 2 片：同上；③ UNPAID：不重试 → 推送含"未支付"、意图 `enabled=false`、返回 `skipped:'unpaid'`；④ `LIMITED_BY_START_TIME`：仍调用 `createOrder`、成功推送含"不可退款"、不落 `LIMIT` 记录；⑤ `expire_at` 落库为 UTC（模拟响应 `expireTime` 北京时间）；⑥ 每日限订仍按片次计数（held=1 + 2 片次 > 2 → 停手） |
| `server/test/intentApi.test.js` | 校验矩阵：`durationHours=3` → 422、`courtsNeeded=3` → 422、`2×2` → 422（文案断言）；`2×1`、`1×2` → 201 |
| `server/test/intentMigration.test.js` | 019：`expire_at` 列存在、幂等（二次启动不重复加列） |
| `server/test/watchEngine.test.js` | 多片次意图在整段可订时，一轮只触发 **1 次** `createOrder`（stub 计数） |
| 前端 | `npm run build`；Playwright 走查：时长/片场联动禁用、2 小时 × 1 片可保存、2 小时 × 2 片不可提交 |

## 8. 兼容与发布

- **API**：`durationHours` / `courtsNeeded` 上界收紧属于有意的破坏性变更；现有生产意图全是 `duration=1 / courts=1`（7 条），不受影响。`expire_at` 为新增输出字段。
- **数据**：迁移 019 只加列（不回填历史；历史行 `expire_at` 为 NULL）。
- **部署**：备份 DB → 构建前端 → 测试环境（`-p badmintontest -f docker-compose.test.yml`）验收 → 生产 `docker compose up -d --build`。
- **回滚**：回退镜像即可（多出的列不影响旧代码；无数据改写，无需恢复备份）。

## 9. 权衡与风险

| 取舍 | 选择与理由 |
|---|---|
| 整单打包 vs 逐片次下单 | **打包**。逐片次必然撞 `UNPAID`（生产已发生），且多笔订单更易撞每日上限与风控 |
| `LIMITED_BY_START_TIME` 当失败 vs 软提示 | **软提示**。实测该码后 `createOrder` 成功；当失败会白丢近场次的锁场机会，还会刷失败告警 |
| UNPAID 停机 vs 等待释放后重试 | **停机**（用户决策）。空等会反复撞场馆 + 刷屏，且用户不知道"为什么不锁了"；停机 + 明确推送把决定权交给用户 |
| `expire_at` 时区 | **存 UTC**。与 `created_at` 口径统一；渲染层 +8h（沿用既有 `fmtTime` 约定） |
| 未知风险 | 一笔订单装**不连续**时段未实测（我们只发连续段，实测连续 2 段 ✓）；若场馆对同单多片次另有隐藏限制，失败会被记为 `SOLDOUT/OTHER` 并推送，可据此再调 |
