# Design: 监控锁场系统重构为订场意图模型

依据：`CONTEXT.md`、`docs/adr/0001-intent-centric-venue-model.md`、`docs/adr/0002-unified-watch-engine.md`、`prd.md`。

## 1. 数据模型

### 新表

**`booking_intents`**（替代 `venue_watch_targets`）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | 保留旧 vwt- 前缀 id（无损迁移要求）；新意图用 `int-` 前缀 |
| mode | TEXT | `auto_lock`（默认）/ `notify` |
| date | TEXT NULL | 单次日期，与 weekdays 二选一 |
| weekdays | TEXT NULL | JSON 数组 0-6 |
| window_start / window_end | TEXT | `HH:MM`，时间窗口 |
| duration_hours | INTEGER | 1-12，需连续的小时数 |
| courts_needed | INTEGER | 1-3，默认 1（原 max_locks_per_slot） |
| preferred_area_ids | TEXT | JSON 有序数组；空 = 用全局 area_priority |
| enabled | INTEGER | |
| created_at / updated_at | | |

废弃：`slots`（离散格子选择）、`exclude_unavailable`、`area_id/area_name`。

**`booking_intent_locks`**（替代 `venue_lock_orders`）

| 列 | 说明 |
|---|---|
| id, intent_id, date, uniq_no, area_id, area_name, start_time | 同旧表 |
| status | `locked` / `failed` |
| created_at | |

去重改为**部分唯一索引**：`CREATE UNIQUE INDEX ... ON booking_intent_locks(uniq_no) WHERE status='locked'`——失败记录不阻塞重试（修复旧模型 uniq_no 全量唯一索引把失败也算占坑的问题）。

**保留并改名**：`venue_watch_config` → `watch_config`（删 `token_user`/`webhook_*`/`poll_interval_sec`，保留 `enabled`、`token_invalid_notified`、`poll_failure_notified`、`area_priority`）；`venue_watch_areas` → `watch_areas`；`venue_watch_slot_state` → `watch_slot_state`；`venue_watch_notifications` → `watch_notifications`（增加 `intent_id` 列，关联来源意图）。

### 迁移（016）

- 建 5 张新表 → 从旧表拷贝数据 → 删旧表
- `venue_watch_targets` → `booking_intents` 映射：`slots` 非空时取 `min/max(slot)` 为 window、`count(slots)` 为 duration_hours（对旧用户实际用法成立）；`slots` 为 NULL 时 window = `start_time/end_time`、duration_hours = `end - start`
- 沿用 `server/src/config/db.js` 的 `hasColumn` 幂等迁移风格（参考 `migrateVenueWatch*`），016 的 SQL 文件只做文档

## 2. 监控引擎（替代 poller + rush）

新文件 `server/src/services/watchEngine.js`，删除 `venueWatchPoller.js`、`venueLockRush.js`。

```
调度器（单 timer，每分钟对齐 tick）
  └─ 取数计划：窗口内 4 天各一条 { date, nextFetchAt, mode }
  │    - 新放票日（today+3）：09:00:00 起 burst（1s × ≤10 次，出数即止）
  │    - 其余日期：常规 POLL_INTERVAL_SEC
  └─ 取数 → 更新 watch_slot_state 快照，得 0→1 变化
       └─ 对每条变化 slot：匹配启用中的意图（日期/星期 + 窗口覆盖 + 场地过滤）
            └─ auto_lock 意图 → bookingLockService.tryFulfill(intent, date)
            └─ notify 意图（含被降级的）→ notifier（快照 diff 保证不重复喊）
```

- 全局开关、凭证缺失、token 失效等告警逻辑原样搬入引擎，推送失败计数/token_invalid_notified 语义不变
- `venueWatchDigest` 的 lazy require 循环依赖随 poller 删除自然解除；digest 继续由引擎在固定时刻触发（或直接保留独立 timer，取简单者）

## 3. 满足判定与锁场（替代 venueLockService）

`tryFulfill(intent, date)`：

1. 取该日窗口内当前可订 slot（按小时聚合：每小时可订场地列表，按 preferred_area_ids 排序）
2. 找一段**连续 duration_hours 小时**、且每小时可订场地数 ≥ courts_needed 的小时段；允许多候选时按"最早开始 + 场地优先级"取一段
3. 对该段每小时尝试锁 courts_needed 片：逐个 `createOrderCheck → createOrder`（沿用 `gymOrderClient` + `venueLockSigner`，不变）
4. 整段锁齐 → 该意图当日停手（内存 + `booking_intent_locks` 记录可恢复）；锁不齐 → 已锁的保留，剩余继续等回流

**两击降级**：我锁过的格子在 ~5 分钟内回流可订 = 超时未支付。引擎在 diff 时检测"该 uniq_no 有 locked 记录且再次 0→1"：第 1 次自动重锁并重发通知；第 2 次把该意图本次发生降级为 notify 并推送原因。计数存 `booking_intent_locks.unpaid_expired_count` 或意图级内存状态 + DB 持久（重启不丢）。

**并发**：部分唯一索引兜底同格双锁；同小时内 courts_needed 的配额检查与插入在同一函数内串行执行（Node 单进程，无跨进程并发）。

## 4. API

`/api/venue-watch/*` → `/api/intents/*`：

| 旧 | 新 |
|---|---|
| GET/PUT /config | GET/PUT /config（不变语义） |
| GET/POST /targets, PUT/DELETE /targets/:id | GET/POST /, PUT/DELETE /:id |
| GET /notifications | GET /notifications?intentId=（接入 UI） |
| GET /locks | GET /locks?intentId=（接入 UI） |
| GET /areas, GET /availability | 不变 |
| GET /digest, POST /digest/send, POST /poll-now | **删除**（无前端调用；digest 保留服务端内部触发） |

校验合并为一层：保留 express-validator 声明式规则，删除 controller 内命令式重复校验（`venueWatchController.js:38-152`），新增字段（duration_hours 等）入 validators。

## 5. 前端

- `VenueWatchPanel.vue`（705 行）整体重写为 `IntentPanel.vue`：
  - **卡片列表**：意图内容摘要 + 状态徽标（监控中 / 已锁到待支付 / 已过期 / 已降级仅提醒）+ 开关/编辑/删除；展开显示该意图的锁场记录与通知历史
  - **创建表单**（Sheet）：① 哪天有空（日期卡/星期 chips）② 打几小时（窗口 + 时长选择器，替代时段格子网格）③ 场地偏好（有序 chips，默认全局）+ 模式与片数（次要设置折叠）
  - 头部：凭证就绪指示、总开关、全局场地优先级（沿用现有交互）
- `client/src/stores/venueWatch.js` → `intent.js`，接口路径全部切换
- `targetForm.areaPriority` 实际携带 areaIds 的命名错位随重写消除

## 6. 测试

- `venueWatch.test.js` / `venueLock.test.js` / `venueLockRush.test.js` 重写为 `intent*.test.js` / `watchEngine.test.js`
- 新增覆盖：连续时长满足判定（含跨场）、两击降级、部分唯一索引允许失败后重试、burst 模式取数计划、迁移 016 幂等性
