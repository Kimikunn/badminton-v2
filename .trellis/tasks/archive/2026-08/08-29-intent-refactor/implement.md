# Implement: 监控锁场系统重构为订场意图模型

按序执行，每步完成后跑对应验证。回滚点：步骤 3 前可整体 `git checkout`；步骤 3 之后回滚需保留 016 迁移的逆操作（新表数据拷回旧表，仅开发期可接受）。

## 步骤

### 1. 数据库迁移 016（先行，可独立验证）

- 新建 `server/src/db/migrations/016_intent_refactor.sql`（文档用）+ `db.js` 中 `migrateIntentRefactor()`（幂等，参考 `migrateVenueWatch*` 风格）
- 建 `booking_intents`、`booking_intent_locks`（含 `WHERE status='locked'` 部分唯一索引）、`watch_config`、`watch_areas`、`watch_slot_state`、`watch_notifications`（+`intent_id`）
- 从旧表拷贝数据（映射规则见 design.md §1），删旧表及废弃列
- 验证：`cd server && npm test`（现有测试此时仍指向旧表，预期红——迁移验证放在步骤 6 测试重写后）；手动 `sqlite3` 查新表结构与数据行数一致

### 2. 后端：意图服务层

- `venueWatchService.js` → `intentService.js`：CRUD 改对新表，日期展开/场地优先级逻辑保留，字段改名
- 公共 helper 归一：`dateStr`、`isSlotAvailable` 等收进 `server/src/services/venueShared.js`（或并入 intentService），删 4 处复制
- 验证：service 层可独立 import 无循环依赖

### 3. 后端：监控引擎（核心）

- 新建 `watchEngine.js`：取数计划（burst + 常规节奏）+ 单一下游管道，逻辑搬迁自 `venueWatchPoller.js` + `venueLockRush.js`
- 新建/改写 `bookingLockService.js`（自 `venueLockService.js`）：`tryFulfill` 连续时长判定、courts_needed 逐格锁、两击降级
- 删除 `venueWatchPoller.js`、`venueLockRush.js`；`server.js` 启动/停止改接 `watchEngine`
- `venueWatchDigest.js` 解除 lazy require，保留每日摘要内部触发
- 验证：`cd server && npm run lint`（如有）；引擎单测在步骤 6

### 4. 后端：API 层

- `venueWatchRoutes.js` → `intentRoutes.js`，路径 `/api/venue-watch` → `/api/intents`（`app.js:124` 同步）
- 删 digest/poll-now 端点；notifications/locks 增加 `intentId` 过滤参数
- 校验合并：规则全部入 `intentValidators.js`（含 duration_hours、window_*、courts_needed），删 controller 命令式校验
- 验证：`curl` 冒烟各端点

### 5. 前端

- `stores/venueWatch.js` → `stores/intent.js`（`stores/index.js` 导出同步）
- `VenueWatchPanel.vue` 重写为 `IntentPanel.vue`：卡片列表 + 三步创建表单 + 记录/通知展开（design.md §5）
- `VenueView.vue` 引用更新
- 验证：`cd client && npm run build`；手动或 playwright 截图走查（`e2e/screenshots.spec.js` 模式可参考）

### 6. 测试重写与全量验证

- `server/test/venueWatch.test.js`、`venueLock.test.js`、`venueLockRush.test.js` → 按新模块重写，新增 design.md §6 列出的覆盖点
- `cd server && npm test` 全绿
- 全仓 grep 确认无残留：`venue_watch`、`venueWatch`、`venueLockRush`、`/api/venue-watch`
- e2e：`npx playwright test e2e/smoke.spec.js`

### 7. 文档收尾

- `docs/PRODUCT.md` 补意图功能描述（当前完全未提及）
- `CONTEXT.md` 如实现中术语有偏移则回改
- 本步骤与代码同批提交

## 注意

- 外部下单链路（`gymOrderClient.js`、`venueLockSigner.js`）一行不动
- 迁移脚本是唯一不可逆步骤，执行前确认生产 `server/database/*.db` 有备份
