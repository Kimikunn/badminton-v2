# Implement: 锁场整单打包与场馆反馈治理

> 依赖 `prd.md`（AC）与 `design.md`（契约）。按序执行，每步跑完验证命令再进下一步。

## 0. 准备与基线

- [ ] 基线：`cd server && npm test`（应 208/208 pass）、`cd client && npm run build`。
- [ ] 确认无残留测试订单：`docker logs badminton | grep -c "createOrder"`（可选）；今晚实测的 153436 / 153439 应已自动释放。

**回滚点 R0**：`24539df`。

## 1. 校验收敛（先立边界，后面才好测）

- [ ] `intentValidators.js`：`durationHours` 1-2（422 文案「暂不支持连打 2 小时以上」）、`courtsNeeded` 1-2（422「同一天最多 2 片次」）、跨字段 `durationHours × courtsNeeded ≤ 2`（422「每天最多 2 个片次（场地×小时），当前组合需要 N 个」）；create/update 规则一致。
- [ ] `intentApi.test.js`：新增矩阵用例（3 小时 422、3 片场 422、2×2 422、2×1 与 1×2 201）。

**验证**：`cd server && node --test test/intentApi.test.js`

## 2. 整单打包下单（核心）

- [ ] `buildAreaItems(items)`：接收数组，透传每个 item 的 `raw`（无 raw 时按字段拼）。
- [ ] `placeOrder(items)`：一次 `createOrderCheck` + 一次 `createOrder`；返回 `{ success, orderId, expireAt, softNotice, error, errorCode, riskControl }`。
- [ ] `LIMITED_BY_START_TIME` 在 check 阶段**不视为失败**，置 `softNotice='no_refund'` 后继续下单。
- [ ] `attemptLockOrder({ intent, items, date })`：剔除已 locked 的 item；成功落 N 条 locked（同 `order_id`/`expire_at`）、失败落 N 条 failed（同 `error`/`error_code`）；全被剔除则 `skipped:'already_locked'`。
- [ ] `tryFulfill`：第④步按 run 组装 items（复用现有 areaPriority 排序与 `need` 计算），第⑥步改为一次 `attemptLockOrder`；`needTotal` 改用 `items.length`。
- [ ] `bookingLock.test.js`：2 小时连打 / 1 小时 2 片各自「只 1 次 createOrder + N 条同 orderId 记录」；失败时 N 条同 error。

**验证**：`cd server && node --test test/bookingLock.test.js`（含既有用例全绿）

**回滚点 R1**：`git checkout` 本步文件。

## 3. UNPAID 停机路径

- [ ] `tryFulfill`：失败项含 `UNPAID` 时 → 不再重试本轮；`intentService.updateIntent(intent.id, { enabled: false })`；推「需要先支付」通知（文案含：你有一笔未支付订单、监控已暂停、付款后重开监控继续抢）；`notifyLockFailed` 不重复推；返回 `{ fulfilled:false, skipped:'unpaid' }`。
- [ ] 引擎侧：`fulfillWithRiskRetry` 只处理 `risk_control`，UNPAID 无需额外处理（意图已停用）。
- [ ] `bookingLock.test.js`：UNPAID 用例断言 ① 第二次 `tryFulfill` 不再发起 `createOrder`（stub 计数）② `enabled=false` ③ 推送文案 ④ 返回 `skipped:'unpaid'`。

**验证**：`cd server && npm test`

## 4. 软提示与推送文案

- [ ] 成功推送（`notifyFulfilled`）在 `softNotice === 'no_refund'` 时追加一行「该场次距开场不足 12 小时，**不可退款**」。
- [ ] 失败推送保持现状。
- [ ] `bookingLock.test.js`：断言软提示场景下 `createOrder` 被调用、成功推送含"不可退款"、**不产生** `error_code='LIMIT'` 记录。

**验证**：`cd server && npm test`

## 5. `expire_at` 列与展示（migration 019）

- [ ] `schema.sql`：`booking_intent_locks.expire_at TEXT`。
- [ ] `db/migrations/019_lock_expire_at.sql`（内容记录）+ `db.js` 特判 `migrateLockExpireAt()`（`hasColumn` 幂等）。
- [ ] 落库：从 `createOrder` 响应 `expireTime`（北京时间）转 UTC 后写入；`insertLockRecord` 与 `formatLockRecord` 透传。
- [ ] 推送文案用北京时间渲染支付截止（沿用 `fmtTime` 的 +8h 约定）。
- [ ] `intentMigration.test.js`：019 列存在 + 幂等；`bookingLock.test.js`：`expire_at` 由北京时间正确转 UTC。

**验证**：`cd server && npm test`；迁移演练（副本）：
```bash
cp server/database/badminton.db /tmp/mig-019.db
DB_PATH=/tmp/mig-019.db node -e "require('./server/src/config/db').initDatabase()" 2>&1 | grep -E "019|Schema"
```

## 6. 前端选项与联动

- [ ] `DaySheet.vue`：`DURATION_OPTIONS` → 1/2 小时；`COURTS_OPTIONS` → 1/2 片；联动（2 小时 ⇒ 片场锁 1；2 片 ⇒ 时长锁 1）；内联提示「每天最多 2 个片次（场地×小时）」；保存前兜底校验。
- [ ] 顺带把"新增监控"默认值保持 `20:00-21:00 · 1 小时 · 1 片`（现状不变）。

**验证**：`cd client && npm run build`；Playwright 走查（测试环境）：
① 选 2 小时 → 片场选项只剩 1 可选；② 选 2 片 → 时长锁 1；③ 非法组合无法提交；④ 正常 2 小时 × 1 片可保存。

## 7. 收尾验证与发布

- [ ] 全量：`cd server && npm test` + `cd client && npm run build`
- [ ] 备份：`cp server/database/badminton.db server/database/backups/badminton.db.pre-lock-bundle-$(date +%Y%m%d-%H%M)`（test.db 同）
- [ ] 构建产物：`cd client && npm run build && npm run build:test`
- [ ] 测试环境：`docker compose -p badmintontest -f docker-compose.test.yml up -d --build` + 验收（含 AC1-AC8 走查，**验收建监控一律 `enabled:false` 或 `mode:notify`**，避免误下真实订单）
- [ ] 生产：`docker compose up -d --build`；验收：`docker logs badminton | grep -E "019|Schema"`、`GET /api/intents` 正常、前端产物 hash 与本地 dist 一致
- [ ] 观察放票日 09:00 行为（次日）：连打意图是否 **1 笔订单装 2 片次**、UNPAID 时是否停用并推送

## 风险清单 / 回滚

| 风险 | 触发点 | 处置 |
|---|---|---|
| 打包后下单异常导致"整单失败"（原本可能部分成功） | 第 2 步 | 这是有意的（原子性）：失败即本轮无货，继续盯回流；测试覆盖 N 条 failed 记录 |
| UNPAID 停机过激（用户其实想继续等） | 第 3 步 | 停机只在"场馆明确拒绝"时发生；推送里写明如何恢复（付款后重开） |
| 时区转换写错 | 第 5 步 | 断言用北京时间样本（22:28:28 → UTC 14:28:28）；渲染层再 +8h 校验 |
| 校验收紧影响既有意图 | 第 1 步 | 生产现存 7 条全是 1×1，不受影响；update 走合并校验 |

## 完成定义（DoD）

- AC1-AC8 均有证据（测试输出 / curl / 构建产物 / 环境验收记录）。
- 提交分批：校验收敛 → 整单打包 → UNPAID 停机 + 软提示 → expire_at 迁移 → 前端联动 → 文档（CONTEXT.md「锁场」「打球时长」词条 + `spec/backend/api-routes.md`）。
- 任务归档 + journal。
