# Design: 订场提醒与推送（v2 修订）

> v2 变更：推送/小程序凭证从"管理界面配置"改为**服务端 .env 环境变量**；监控目标支持**4 天放票窗口内的日期卡片选场 + 重复规律（仅此一天/每天/工作日/每周末/自定义星期）**；开关体系 = 全局总开关 + 逐项开关 + 过期自动失效；服务端对距开场 12h 内场次不做过滤（可订场次到开打前都可能变化）。

## 架构总览

新增独立模块 `venue-watch`（订场监控），不侵入现有 booking（内部订场记录）模块。

```
server/src/
  routes/venueWatchRoutes.js          # 薄路由
  controllers/venueWatchController.js # 校验 + 调 service
  services/venueWatchService.js       # 开关状态 / 目标 / 通知记录
  services/venueWatchPoller.js        # 定时调度 + 外部 fetch + 状态对比
  services/venueWatchNotifier.js      # webhook 推送（按类型构造 payload）
client/src/
  views/VenueWatchView.vue            # 管理界面（开关 + 日期卡片/时段选场 + 历史）
  stores/venueWatch.js                # Pinia store
```

外部数据流：`定时轮询 → GET shop.chuanshatiyuchang.cn/gym/miniprogram/venue/listAreaLease → 与快照表对比 → 0→1 变化且命中启用目标 → PushPlus 群组推送 + 落通知记录`。

## 配置方式（v2：环境变量）

凭证与推送参数全部走 `server/.env`（docker-compose 用 `env_file: server/.env` 注入；`server/.env` 已在 .gitignore）：

```
GYM_TOKEN_USER=...        # 小程序 token-user 头
PUSH_TYPE=pushplus        # pushplus | wecom | serverchan
PUSH_TOKEN=...            # pushplus token / serverchan 用 URL 见下
PUSH_TOPIC=badmintonchuansha  # pushplus 群组编码
PUSH_URL=                 # wecom/serverchan 的 webhook URL（pushplus 不用）
POLL_INTERVAL_SEC=120     # 可选，最小 60
```

- 轮询器每次 tick 读 `process.env`（改 .env 后需重启容器生效——可接受，运维操作）。
- DB 的 `venue_watch_config` 单行表只保留 `enabled`（全局开关，界面可切）+ `token_invalid_notified`；v1 的 token/webhook 列由 migration 010 清空并废弃。
- 401 告警文案改为"小程序 token 已失效，请更新服务器 .env 并重启"。

## 数据模型

`schema.sql` + `migrations/009_venue_watch.sql`（v1 四表）+ `migrations/010_venue_watch_weekly.sql`：

- `venue_watch_targets` 变更：
  - 新增 `weekdays TEXT NULL`（JSON 数组，如 `[6,0]` 表示每周六日；NULL=单日模式，用 `date`）
  - 新增 `area_ids TEXT`（JSON 数组，如 `[41,42]`；空数组 = 任意场地）
  - 废弃 `area_id`/`area_name`（列保留不删，010 把 area_id 迁入 area_ids）
- `venue_watch_config`：010 清空 `token_user/webhook_url/webhook_token/webhook_topic/webhook_type/poll_interval_sec` 列值（列保留，代码不再读取）。
- `venue_watch_slot_state`（`uniq_no` PK, `available`, `date`, `updated_at`）与 `venue_watch_notifications` 不变。

目标语义：
- 单日模式：`date >= 今天` 才参与轮询；`date < 今天` 视为**过期**，poller 跳过、UI 置灰标"已过期"（不删数据、不改 enabled）。
- 重复模式：每 tick 把 `weekdays` 展开为放票窗口（今天起 4 天）内匹配的具体日期参与轮询；永不过期。
- 匹配条件：slot 日期 ∈ 目标展开日期 且 `slot.startTime ∈ [startTime, endTime)` 且（areaIds 为空 或 slot.areaId ∈ areaIds）。

## 轮询器（venueWatchPoller.js）

- 递归 setTimeout + 0-15s 抖动；`start()` 于 listen 后，`stop()` 于 gracefulShutdown；启动失败不阻塞 listen。
- 每 tick：读 config 行（`enabled=0` → 跳过）；读 env（缺 GYM_TOKEN_USER 或推送配置 → 跳过）。
- 收集所有启用且未过期目标展开的日期（去重），逐日期 fetch `listAreaLease`（15s AbortController 超时，头：`token-user`/`x-gym-client-id: 1`/`content-type: application/json`）。
- 可订判定 `status==='NORMAL' && showStatus==='AVAILABLE'`；与 slot_state diff，仅 0→1（含新 key）触发；同 tick 同目标合并一条 markdown 推送；首 poll（slot_state 空）只播种。
- 401 → 告警推送一次（`token_invalid_notified` 去重），成功后清零；每 tick 清理 `date < 今天-1` 快照；多写走 `transaction()`；推送失败落 `success=0` 不抛出。

## 推送（venueWatchNotifier.js）

`notify({type, url, token, topic, title, content})`：
- `pushplus`：POST `https://www.pushplus.plus/send`，body `{token,title,content,template:'markdown',topic}`，成功判定 `code===200`
- `wecom`：`{msgtype:'markdown',markdown:{content}}`，判定 `errcode===0`
- `serverchan`：`{title, desp}`，判定 `code===0`

## API（全部挂 `/api/venue-watch`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/config` | `{ enabled, pushConfigured, gymTokenConfigured, pollIntervalSec }`（只暴露布尔，不回任何凭证） |
| PUT | `/config` | body 只接受 `{ enabled }`；写操作自动受 `requireWriteAuth` 保护 |
| GET/POST | `/targets` | 目标列表 / 新建。POST body：`{ date? , weekdays?, startTime, endTime, areaIds? }`——date 与 weekdays 二选一；areaIds 省略/空 = 任意场地 |
| PUT/DELETE | `/targets/:id` | 修改（含 enabled 开关）/ 删除（DELETE → data: null） |
| GET | `/notifications?pageNo=&pageSize=` | `{ list, total, pageNo, pageSize }` 倒序 |
| GET | `/availability?date=` | 透传外部 `{ areaDate, areas:[{areaId,areaName,items:[...]}] }`，供选场时段列表；401 → 422 |
| POST | `/poll-now` | `{ dates, notified }` 手动触发 |

target 输出格式：`{ id, date, weekdays, startTime, endTime, areaIds, areaNames, enabled, expired, createdAt, updatedAt }`（`areaNames` 由服务端按 areaIds 从最近一次 availability 数据或冗余存储解析；`expired` 服务端计算：单日模式且 date < 今天）。

## 客户端（VenueWatchView.vue）

三个区块（仿 VenueView 模式，全中文，Tailwind token）：

1. **状态与总开关**：显示推送通道（PushPlus 群组）、凭证是否就绪（pushConfigured/gymTokenConfigured 布尔指示灯）、轮询间隔；全局开关直接 PUT `/config {enabled}`。不再有凭证输入框。
2. **场次选择（新建/编辑目标）**：
   - **日期卡片**：今天起 4 天（放票窗口）一排 4 张卡片（"周六 8/29"，今天带徽标），点击即拉该日时段列表（`/availability`）。卡片同时是"仅此一天"的目标日期和重复模式的参照日期。
   - **重复规律**单选 chips：仅此一天 / 每天（[0-6]）/ 工作日（[1-5]）/ 每周末（[0,6]）/ 自定义（周一~日多选）。单日发 `date`，其余发 `weekdays` 数组。
   - **时段列表**：聚合所有场地按 startTime-endTime 去重，每行 `时段 · N 片可订`；所有时段可选（盯退订是核心场景）；仅"今天"卡片隐藏"距开场不足 12h 且已满"的行（锁死无意义）；12h 内仍可订的行保留可选（早退未订的场次可订到开打前）。
   - 已选摘要（"N 个时段 · HH:MM-HH:MM"）；availability 失败显示中文错误 + 重试，禁止盲建。
3. **监控目标列表**：每项显示规律徽标（"每天"/"工作日"/"每周末"/"每周三、五"/"8/29 周六"）、时段窗、场地（恒"任意场地"）、启用开关、过期徽标（单日过期置灰禁用）、编辑/删除（useConfirm）。
4. **推送历史**：倒序 + 加载更多，成功/失败 Badge。

路由 `/venue-watch`，首页"订场提醒"入口卡片（已有）。

## 安全

- 凭证只在 `server/.env`，DB 不再存 token；GET 接口不回任何凭证；日志不打印。

## 风险与权衡

- token 过期后的更新路径变成"改 .env + 重启容器"，比 UI 麻烦但更符合单管理员实际；401 告警会推送到群。
- 放票窗口 4 天：每周展开与单日校验都限定在今天起 4 天内；每天 9:00 放第 4 天的票时，新出现的可订 slot 由 0→1 规则自动捕获推送。
- 12h 退订规则只在 UI 层隐藏"12h 内且已满"的行（锁定无变化）；poller 全量跟踪，12h 内可订场次的变化（被订走/支付超时释放）照常捕获推送。

## 测试策略

- 服务端（node:test + supertest harness，stub fetch）：
  - env 配置缺失时跳过轮询；GET /config 不含凭证
  - 每周模式展开日期；过期单日目标跳过且输出 expired=true
  - areaIds 集合匹配（空=任意）
  - 既有 diff/401/合并推送/CRUD 测试更新适配
- 验证：`cd server && npm test`；`cd client && npm run build`；仅部署 test 环境验收，prod 部署需用户明确同意。
