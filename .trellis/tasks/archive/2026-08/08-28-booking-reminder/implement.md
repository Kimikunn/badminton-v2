# Implement: 订场提醒与推送

## 实施清单（按序）

### 1. 数据层
- [ ] `server/src/db/schema.sql`：新增 `venue_watch_config`、`venue_watch_targets`、`venue_watch_slot_state`、`venue_watch_notifications` 四张表 + `INSERT OR IGNORE` config 默认行
- [ ] `server/src/db/migrations/009_venue_watch.sql`：同样四张表的 DDL（存量库用）

### 2. 服务端模块
- [ ] `server/src/services/venueWatchNotifier.js`：`notify({type, url, title, content})`，wecom/serverchan 两种 payload
- [ ] `server/src/services/venueWatchService.js`：config 读写（token 脱敏输出）、targets CRUD、notifications 分页查询
- [ ] `server/src/services/venueWatchPoller.js`：`start()`/`stop()`/`pollOnce()`；fetch + diff + 目标匹配 + 401 告警；含 slot_state 过期清理
- [ ] `server/src/controllers/venueWatchController.js` + `server/src/validators/venueWatchValidators.js`
- [ ] `server/src/routes/venueWatchRoutes.js`，并在 `server/src/app.js` 挂载 `app.use('/api/venue-watch', ...)`
- [ ] `server/src/server.js`：listen 成功后 `poller.start()`，gracefulShutdown 中 `poller.stop()`

### 3. 服务端测试
- [ ] `server/test/venueWatch.test.js`：按 design.md 测试策略覆盖 diff/匹配/401/CRUD/脱敏/notifier；`global.fetch` 用 stub
- [ ] 验证：`cd server && npm test` 全绿

### 4. 客户端
- [ ] `client/src/stores/venueWatch.js`
- [ ] `client/src/views/VenueWatchView.vue`（配置卡 + 目标 CRUD Sheet + 推送历史 + 立即轮询）
- [ ] `client/src/router/index.js` 注册 `/venue-watch`；首页加入口卡片
- [ ] 验证：`cd client && npm run build` 通过

### 5. 联调与收尾
- [ ] 真实 token + 真实 webhook（用户先建一个企业微信群机器人）端到端验证一次：`POST /poll-now` → 收到推送
- [ ] 确认 pino 日志不输出 token
- [ ] 若新增约定（如外部 API 轮询模块模式），回写 `.trellis/spec/`
- [ ] 更新 AGENTS.md（若涉及其中描述的结构/命令）

## 验证命令

```bash
cd server && npm test
cd client && npm run build
# 端到端：启动服务后 PUT /api/venue-watch/config 写入 token+webhook，POST /api/venue-watch/poll-now
```

## 风险点 / 回滚

- `server.js` 启动顺序改动最小化：poller 启动失败不得阻塞 listen（try/catch 包裹）。
- 回滚 = 反挂载路由 + 停 poller + migration 不删（DDL 无害）。
- 外部接口结构变化 → AC4：记录错误并告警，不静默失败。
