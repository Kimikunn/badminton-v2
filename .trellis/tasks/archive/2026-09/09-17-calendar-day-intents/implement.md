# Implement: 订场监控与日历合并（按天开启监控）

> 依赖 `prd.md`（状态机、AC）与 `design.md`（契约、迁移、测试设计）。按顺序执行，每步跑完验证命令再进下一步。

## 0. 准备与基线

- [ ] 记录基线：`cd server && npm test`（应为 187/187 pass）、`cd client && npm run build`。
- [ ] 生产数据已核（2026-09-17 快照：6 行 weekly 全 `enabled=0`）；如部署前再核一次：
      `python3 -c "import sqlite3;db=sqlite3.connect('server/database/badminton.db');print(list(db.execute('SELECT id,date,weekdays,enabled FROM booking_intents')))"`

**回滚点 R0**：改动前状态（`990bd1f`）。

## 1. 抽出 `lockRun.js`（行为等价重构，先立地基）

- [ ] 新建 `server/src/services/lockRun.js`：搬 `findRun`（原 `bookingLockService.js:252-268`）+ 新增 `isOccurrenceFulfilled(intentRow, lockedRows)`。
- [ ] `bookingLockService.js` 改为引用该模块；`occurrenceFulfilled()`（`:178-180`）委托过去。
- [ ] 新增 `server/test/lockRun.test.js`：连段、片数、窗口边界、locked-only 等价。

**验证**：`cd server && npm test` —— 除新文件外**零行为变化**（既有 187 条必须全绿）。
**回滚点 R1**：删除 `lockRun.js` + 还原两个函数。

## 2. 校验层单模式化

- [ ] `intentValidators.js`：`date` 必填、`date >= today`、**去掉窗口上限**、`weekdays` 任意值 → 422；跨字段规则同步（partial 版本一致）。

**验证**：`cd server && node --test test/intentApi.test.js`（先会红，第 6 步补断言）。

## 3. `intentService`：单模型 + 状态派生 + 清扫

- [ ] `RUSH_HOUR` 上移 `venueShared.js`，`watchEngine.js` 改为引用（`watchEngine.js:40` 删除本地常量）。
- [ ] 删除 weekly 分支：`isWeeklyRow`、`expandIntentDates` 每周路径、`createIntent/updateIntent` 的 weekdays 写入、`formatIntent` 的 weekdays 输出（`weekdays` 字段保留返回 null 还是移除？→ **移除**，前端同步）。
- [ ] 新增 `deriveIntentStatus(row, ctx)`（纯函数，顺序即契约，见 design §3.1）。
- [ ] `formatIntent` 输出 `status` / `verifyDeadline` / `lastAttempt`；保留 `expired` 兼容位。
- [ ] 新增 `sweepExpiredIntents()`：`UPDATE booking_intents SET enabled = 0 WHERE date < ? AND enabled = 1`，返回改动行数。
- [ ] `listIntents({ from, to })` 支持日期区间；`listLocks` / `listNotifications` 支持 `date` 过滤。

**验证**：`cd server && node --test test/intentService.test.js test/intentApi.test.js`
（新增用例：7 状态 × 优先级边界、`pending_release` 08:59/09:00 分界、清扫只动过期行）

**回滚点 R2**：`git checkout` 本步骤涉及文件（未跑迁移前数据无害）。

## 4. 引擎：暴露重试状态 + 每日清扫 + 去 weekly

- [ ] `getRiskRetries()` 导出 `rcRetrying` + deadline。
- [ ] `runTick()` 开头（`flags.enabled` 早退**之前**）调用 `sweepExpiredIntents()`，用 `lastSweepDate` 每日去重；`resetEngineState()` 一并复位该标记。
- [ ] `expandIntentDates` 只走单日路径（weekly 已在上一步删除）。
- [ ] `watchEngine.test.js`：删除 weekly 用例；新增 `getRiskRetries` 用例（窗口内有、窗口后清空）与清扫去重用例。

**验证**：`cd server && npm test`（全量绿）

**回滚点 R3**。

## 5. 结构化错误码 + 迁移 018

- [ ] `bookingLockService.js` 失败路径落 `error_code`：风控 `RISK_CONTROL`（`:120-121`）、被抢/`createOrderCheck` 失败 `SOLDOUT`、限订 `LIMIT`、未支付订单存在 `UNPAID`、其余 `OTHER`；`insertLockRecord`（`:64`）加字段。
- [ ] `schema.sql`：`booking_intent_locks.error_code TEXT`；`booking_intents` 去掉 `weekdays` 列（新库）。
- [ ] `server/src/db/migrations/018_single_date_intents.sql`（记录用）+ `db.js` 的 `migrateSingleDateIntents()`：加列 → 回填历史 `error_code`（含 `已被预订→SOLDOUT`）→ weekly 展开为窗口内 date 意图（复制字段、继承 enabled；**窗口内无匹配的行展开为"下一个发生日"，不删配置**；仅 weekdays 非法/为空时删行）→ 删除原行 → 删 `weekdays` 列。全程事务 + `hasColumn` 幂等。
- [ ] `intentMigration.test.js`：展开/复制/enabled 继承、无匹配行删除、列消失/新增、幂等二次启动。
- [ ] `bookingLock.test.js`：四种 `error_code` 断言。

**验证**：`cd server && npm test`；额外手工迁移演练（**在副本上**）：
```bash
cp server/database/badminton.db /tmp/migrate-test.db
DB_PATH=/tmp/migrate-test.db node -e "require('./server/src/config/db').initDatabase().then(()=>{const {prepare}=require('./server/src/config/db');console.log(prepare('SELECT id,date,weekdays FROM booking_intents').all())})"
```
**回滚点 R4**：迁移不可逆 —— 部署前必须备份（见第 8 步）。

## 6. 控制器与路由

- [ ] `listIntents` 注入引擎状态：`riskRetryKeys` 来自 `watchEngine.getRiskRetries()`，`isFulfilled` 用 `lockRun` + 当日 locked 行；组装 ctx 后调 `formatIntent`（**派生只有一处**，控制器只供料）。
- [ ] `listLocks` / `listNotifications` 透传 `date`；`listIntents` 透传 `from/to`。

**验证**：`cd server && npm test`（全量绿）+ `npm start` 手工 `curl localhost:3000/api/intents | jq '.data[].status'`

## 7. 前端

- [ ] `stores/intent.js`：删 `assembleIntentPayload` 的 weekly 分支；加 `monitorsByDate` / `badgeFor(date)` / `createForDate`；`fetchLocksByDate` / `fetchNotificationsByDate`；聚合纯函数 + 优先级常量（**不可用不参与聚合**）。
- [ ] `BookingCalendar.vue`：抽出内部 sheet → `DaySheet.vue`；新增 `monitorStatusByDate` 入参；格子渲染监控徽标（含条数）；过去日不渲染。
- [ ] `DaySheet.vue`（新）：订场记录（不变）+ 监控区块（列表/新增/编辑/开关/删除，去掉星期条与「工作日/周末/每天」文案）+ 不可用开关区（**正交维度**：不可用日显示提示 + 取消标记入口，不给新建）+ 历史（`SHOW_LOGS` 门控，改按天拉取）；打标记时若有监控先二次确认。
- [ ] `VenueWatchSettingsSheet.vue`（新）：总开关 + 锁场场地优先级（从 `IntentPanel.vue` 搬移）；入口放日历页头齿轮。
- [ ] 删除 `IntentPanel.vue`；`VenueView.vue` 改为：`store.init()` + 日历页头设置入口 + 传 `monitorStatusByDate`。

**验证**：`cd client && npm run build`（vite 构建通过）；`npx playwright test e2e/smoke.spec.js`（需应用运行）

**回滚点 R5**。

## 8. 收尾验证与发布

- [ ] 全量：`cd server && npm test` + `cd client && npm run build`
- [ ] 备份：`cp server/database/badminton.db server/database/backups/badminton.db.pre-day-monitor-$(date +%Y%m%d-%H%M)`（test.db 同）
- [ ] 构建前端产物：`cd client && npm run build && npm run build:test`（Dockerfile 只 COPY 预构建产物）
- [ ] 测试环境：`docker compose -p badmintontest -f docker-compose.test.yml up -d --build`
- [ ] 测试环境验收（对照 AC1-AC9）：点日期建监控 → 徽标出现 → 开关/编辑/删除 → 近日期设"提前监控"看 `waiting` → 迁移日志 `[DB] Running migration: 018_single_date_intents.sql` → `curl localhost:8090/api/intents` 无 weekly 行、`status` 正确
- [ ] 生产：`docker compose up -d --build`；验收同上 + `docker logs badminton | grep "018_single_date"` + `docker logs badminton | grep "push "`
- [ ] 冒烟后确认：`server/runtime/gym-token` 未被动过、监控引擎正常轮询（`pollIntervalSec` 周期内有请求）

## 风险清单 / 回滚

| 风险 | 触发点 | 处置 |
|---|---|---|
| 迁移删错数据 | 第 5 步 | 只在**副本**上先演练；生产部署前备份；回滚 = 覆盖 DB 备份 + 回退镜像 |
| 状态派生顺序写错 | 第 3/6 步 | 优先级顺序以测试逐条锁定；顺序变更必须同步改测试与 PRD 表格 |
| 前端删 `IntentPanel` 后功能缺口（如总开关没入口） | 第 7 步 | 验收清单显式检查 AC8 |
| 09:00 风控路径回归 | 第 4/5 步 | 复用既有 `watchEngine` 风控用例 + 新增 `error_code` 断言；测试环境放票时段观察一次 |

## 完成定义（DoD）

- AC1-AC10 全部有证据（测试输出 / curl 输出 / 构建输出 / 目标环境验收记录）。
- `Implement` 阶段结束时更新 `.trellis/spec/backend/api-routes.md`（weekly → date、新增 status 字段、`?date=`/`?from=` 过滤）与 `CONTEXT.md`（监控按天、状态机、风控状态、迁移说明）。
- 提交分批：重构（lockRun）→ 服务端单模型+状态机 → 迁移与错误码 → 前端合并 → 文档；最后归档任务 + journal。
