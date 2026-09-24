# Journal - pi (Part 1)

> AI development session journal
> Started: 2026-07-17

---



## Session 1: Bootstrap spec 填充：backend+frontend 模式文档化

**Date**: 2026-07-17
**Task**: Bootstrap spec 填充：backend+frontend 模式文档化
**Branch**: `master`

### Summary

Inspected codebase (Express+sql.js server, Vue3+Pinia client). Wrote .trellis/spec/backend/{index,api-routes,auth,logging,testing}.md and filled all 6 frontend spec files + index. Only code-evidenced patterns documented (venues resource as canonical example, writeAuth admin-token model, pino logging, node:test harness, Sheet+Input+toast form pattern). Spec layers now: backend, frontend.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 安卓机型 PWA UI 适配

**Date**: 2026-08-07
**Task**: 07-17-android-ui-adaptation（已归档 archive/2026-08/）
**Branch**: `master`

### Summary

用户实测的"安卓 UI 遮挡"根因是安装引导弹层无法关闭（--safe-bottom 在安卓 Chrome 返回 0，关闭按钮被手势条覆盖）。范围定为：移除安装引导 + 全套 safe-area 适配。删了 App.vue 安装引导 Sheet 和 usePWAInstall.js；tokens.css 给 --safe-bottom 加 max() + standalone 16px 兜底；顺手修了 360px 下 header 标题溢出 15px（truncate + min-w-0）；Playwright 加 android-light/dark（360×640）两个 project，smoke 加 3 条断言。

### Main Changes

- client/src/App.vue: 删安装引导（script + template）；header 标题 truncate 修复
- client/src/composables/usePWAInstall.js: 删除
- client/src/styles/tokens.css: --safe-bottom = max(env(...), var(--safe-bottom-min, 0px))；standalone 下 --safe-bottom-min: 16px
- playwright.config.js: +android-light/android-dark（360×640）
- e2e/smoke.spec.js: 无横向滚动断言 / 安装引导不存在回归 / safe-bottom 管道测试
- spec 三处更新（见 commit）

### Git Commits

- 17c9c29 feat(client): 移除安装引导弹层，安卓 safe-area 兜底与 360px 适配
- docs(spec) commit + chore(task) archive commit

### Testing

- client npm run build 绿；全量 e2e 44 过 / 0 败 / 12 环境跳过（season-management 按 env flag 跳过，既有行为）；安卓 + iOS 视口截图人工核阅通过；trellis-check 终审通过

### 事故记录（教训）

docker-compose.yml 和 docker-compose.test.yml 同 service 名 app + 同默认 project 名，直接 `-f docker-compose.test.yml up -d` 把 prod 容器 badminton(:8088) recreate 删掉了。已即时用 dist 重建恢复。教训已写入 backend/testing.md：test 环境必须 `docker compose -p badminton-test -f docker-compose.test.yml`。

### Status

[OK] **Completed**

### Next Steps

- 真机验证 standalone 模式下 TabBar/Sheet 底部间距（e2e 无法模拟 display-mode: standalone，仅验证了管道）
- R4 顶部 header 在真机安卓 standalone 下的状态栏遮挡情况待真机确认（本次保持 env() 原样）


## Session 2: S6 赛季界面与规则系统（王选/灵魂契合/王之宝库）

**Date**: 2026-08-08
**Task**: S6 赛季界面与规则系统（王选/灵魂契合/王之宝库）
**Branch**: `master`

### Summary

按三切片交付 S6：①赛季建档+上篇王选/形态（黛青开局分服务端自动化）②下篇组合 PA7+灵魂契合（掷骰/阶层/选奖/重铸/重投）③王之宝库 11 卡执行（暗选同亮/爆破 11 分/存储器带入/时空裂隙回溯/结算修正）。S4 星尘逻辑抽取共享模块 comboStardust.js；修复 PWA SW 缓存导致规则动作后 UI 回退（seasons 改 NetworkFirst + recordAction upsert）。服务端 103/103，e2e 5 规格×4 视口全绿。遗留：创建赛季后视图不切换（MatchHubView 本地 ref）、matches?roundId 不过滤、写密集 e2e 连跑触发限流。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e3e5e88` | (see git log) |
| `34496b1` | (see git log) |
| `e992451` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: S6 规则修正：月白抵抗局与逐人暗选

**Date**: 2026-08-08
**Task**: S6 规则修正：月白抵抗局与逐人暗选
**Branch**: `master`

### Summary

两处规则修正：①月白按 S5 秩序抵抗局处理（显式胜方/胜方≥21/30 封顶/分低者可获胜），抵抗校验提取共享 rules/resistance.js；②暗选改为 4 名选手各自提交本人已选卡片，归属校验+全员齐交同时亮出，存储器 carry 多条求和。服务端 107/107，e2e 全规格×4 视口全绿。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `00864c9` | (see git log) |
| `feb60c0` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: S6 王选改一次性王序 + 生产数据修复

**Date**: 2026-08-08
**Task**: S6 王选改一次性王序 + 生产数据修复
**Branch**: `master`

### Summary

规则修正：王选只在第 1 轮前投一次，从大到小定第 1-4 轮的王；同分组内重投不全局重排。s6_king_roll 改 {order:[...]} 一次性契约，王由 kingOrder 派生并兼容旧 topKings；2-4 轮仅形态选择。生产修复：kingOrder=p3(6)/p4(重投4)/p2(重投1)/p1(4)，round1 数据未动。服务端 110/110，e2e 全绿，已部署 :8088。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a742008` | (see git log) |
| `4a06f76` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: S6 王权每轮最后一名展示

**Date**: 2026-08-13
**Task**: S6 王权每轮最后一名展示
**Branch**: `master`

### Summary

排名页王选面板逐轮展示王权提供人：calcTopRoundKingRights 按轮标准结算求末位，王垫底顺延第三名；部分完赛标暂列。e2e 王垫底剧本验证顺延分支，4 视口全绿。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `3819c68` | (see git log) |
| `f349888` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: S6 排版修复：数字骰子芯片与网格对齐

**Date**: 2026-08-14
**Task**: S6 排版修复：数字骰子芯片与网格对齐
**Branch**: `master`

### Summary

PWA 手机端排版修复：Unicode 骰面字符在部分 Android 字体缺字形，新增 DiceChip 数字芯片组件全面替换；王选面板改固定四列网格（轮次/王/骰子/形态）实现跨行对齐，王权文案独立行。截图复查两种视口两色主题，e2e 全量回归零改动通过。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `cc13a09` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 修复排名排序：大分→小分→进球数

**Date**: 2026-08-20
**Task**: 修复排名排序：大分→小分→进球数
**Branch**: `master`

### Summary

standard/s2/s3 的 calcRankings 只按大分排序的 bug 修复：新增共享比较器 comparePlayerRankings（大分→小分→进球数→ID，与 S5 同口径），S1/S2/S3/S6 上篇全部生效。e2e 用三人同大分同小分按进球数分序的剧本锁定回归。全规格×4 视口绿，服务端 110/110。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `39b6a25` | (see git log) |
| `f8c1cd9` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 订场提醒与推送：从抓包到生产上线

**Date**: 2026-08-29
**Task**: 订场提醒与推送：从抓包到生产上线
**Branch**: `master`

### Summary

完成订场监控功能全流程：Stream 抓包验证小程序接口可行性（listAreaLease + token-user 重放）；服务端新增 venue-watch 模块（轮询器 0→1 状态 diff、401 告警去重、每日汇总排版接口）；凭证走 server/.env；监控目标支持 4 天放票窗日期卡片、重复规律（每天/工作日/每周末/自定义）、排除不可用日期；UI 并入订场页 VenueWatchPanel；推送通道从 PushPlus（需实名付费）切到 WxPusher Topic 群发；修复容器时区（Dockerfile 装 tzdata + TZ=Asia/Shanghai）；docker-compose.test.yml 固定 project 名避免与 prod 互相认领容器（期间 prod 曾短暂中断已恢复）；145 测试全绿，已部署 prod 并提交 6accf9f。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `6accf9f` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 监控锁场系统重构为订场意图模型

**Date**: 2026-08-29
**Task**: 监控锁场系统重构为订场意图模型
**Branch**: `master`

### Summary

完成 intent-refactor 任务（7 步全绿）：迁移 016 把 venue_watch_*/venue_lock_orders 无损迁到 booking_intents/booking_intent_locks/watch_*（部分唯一索引修复失败占坑）；poller+rush 合并为单一 watchEngine（分钟 tick + 取数计划，09:00 burst 1s×10，digest 09:05 内部触发）；bookingLockService 实现连续时长满足判定（允许跨场）与两击降级；API /api/venue-watch→/api/intents，校验合并进 validators；前端 VenueWatchPanel 重写为 IntentPanel 卡片列表；测试重写 178/178 绿，e2e smoke 5/5。注意：放票窗口按 CONTEXT.md 从 5 天改为 4 天；PWA 旧 /api/venue-watch 缓存失效；生产库已备份到 server/database/backups/。实现中发现 db.js prepare() 包装单次性（run 后即 free，循环内需逐行 prepare）。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e766539` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 辅助订场实测反馈修正与生产部署

**Date**: 2026-08-30
**Task**: 辅助订场实测反馈修正与生产部署
**Branch**: `master`

### Summary

首轮实测后的问题修正：时区（UTC 存/本地渲染）；09:00 放票图形验证导致锁场全败 → 风控 fail-fast + 锁场失败即时推送；删除用户不需要的 09:05 场次汇总 digest；每日限订 2 笔（GYM_DAILY_ORDER_LIMIT 可配，取消返还，停手+推送）；锁到即停（整段满足自动停用意图，重开走 requestEvaluation 绕过 diff 直接评估）；不跟踪支付（删两击降级，迁移 017）；面板改名辅助订场、设置收纳、状态徽标移除、日志仅测试环境可见、表单改星期条（今天起 7 天滚动）统一每周模型。CONTEXT.md 补可订时段/放票风控/每日限订词条。生产（8088）与测试（8090）环境均已部署，生产库迁移前已备份。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `683ba82` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: token 失效治理：401 告警修复 + 自助换 token

**Date**: 2026-09-07
**Task**: token 失效治理：401 告警修复 + 自助换 token
**Branch**: `master`

### Summary

用户反馈监控停摆 5 天后报 token 失效且告警混乱。解包确认：无 refresh 机制，wx.login code 只能在微信客户端产生，服务端无法自动续期；风控验证码=腾讯防水墙滑块（verifyCaptcha 校验 ticket）。修复：401 双形态（业务码+网关 HTTP 401）统一识别、告警标记仅在拉到数据时清零。新增两条自助换 token 通道：mitmproxy 捕获代理（8899，docker-compose.tokenproxy.yml，小程序登录即自动捕获）+ POST /api/intents/token 更新接口（x-token-key 专用密钥，配 iOS 快捷指令一键上报）。token 改为读 server/runtime/gym-token 活文件，免重启。用户已实测换 token 成功，生产恢复。测试 183/183。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `274b068` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: 风控验证引导与锁场重试窗口

**Date**: 2026-09-17
**Task**: 风控验证引导与锁场重试窗口
**Branch**: `master`

### Summary

放票高峰 createOrder 被图形验证拦截后不再就地失败：引擎推「需要过验证」引导用户在小程序过一次验证（服务端与小程序共用 token-user，过验证后按会话免验证），随后 4 分钟窗口内每 12 秒重新拉取并绕过 diff 直接评估该意图，直到锁到/意图停用/总开关关闭/token 失效/窗口超时。风控中止不再由 bookingLockService 立刻推「锁场失败」，避免同一事件两条矛盾通知。附带：推送全量留痕（push ok/push fail）、锁齐时按每个锁到时段落 watch_notifications、runtime 活文件路径改为每次调用实时解析（GYM_RUNTIME_DIR 测试隔离，避免读写生产 token）、意图卡片按最近发生日排序且过期沉底。文档同步 CONTEXT.md 放票风控改写 + 锁场补签名说明、spec testing/auth 补 runtime 隔离与后台定时器测试约定、.codex/ 入 .gitignore。检查子代理修 4 处：重试窗口绕过监控总开关、rcRetryConfig 用例间不还原、intentService 死代码常量、AC4/AC6 测试缺口。验证 187/187 + client build 通过。同轮归档 08-29-auto-order（签名可行性验证已完成落地，遗留「真实放票时刻端到端 createOrder 实盘验证」标记为已知未验）。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `990bd1f` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: 订场监控并入日历：按天开启监控（单模型 + 状态机 + 迁移 018）

**Date**: 2026-09-17
**Task**: 订场监控并入日历：按天开启监控（单模型 + 状态机 + 迁移 018）
**Branch**: `master`

### Summary

把辅助订场监控从每周几改成日历上的某一天：点选日历某天即在当天 sheet 设置/开关监控，一天可多条（多时段），删除 IntentPanel，日历成为唯一入口。服务端收敛单模型：date 必填、允许任意未来日期提前设置、传 weekdays 一律 422；每周数据由迁移 018 展开为单日意图（窗口内无匹配则承接下一个发生日，不丢配置），删 weekdays 列，加 booking_intent_locks.error_code（失败原因结构化 RISK_CONTROL/SOLDOUT/LIMIT/UNPAID/OTHER，不再靠中文文案匹配）。新增 7 状态派生 deriveIntentStatus（expired→awaiting_verify→fulfilled→pending_release→waiting→watching→paused，顺序即契约），awaiting_verify 接上风控重试窗口（watchEngine.getRiskRetries 暴露 deadline 由 controller 注入），每日清扫过期意图为停用。状态与不可用是两个正交维度：不可用日走 X 覆盖、不显示监控徽标、引擎跳过，取消标记后自动恢复，不引入 blocked。前端拆出 DaySheet/VenueWatchSettingsSheet，store 派生 monitorsByDate 与 badgeFor（优先级常量数组），Sheet 加 zClass 支持叠加层级；顺带修掉无订场记录时日历不可达的空态缺口。测试 206/206，client 构建通过，真实库副本迁移演练通过（weekly 6 行→7 条 date 意图，锁场 15/通知 24 完好，幂等）。独立审查发现 1 个 P1 + 6 个 P2，P1 与 4 个 P2 已修，2 项记录为遗留。测试环境 8090 验收待部署。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `85ce254` | (see git log) |
| `cc274dc` | (see git log) |
| `fa457d7` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 按天监控收尾：默认值、同段不重复、图例校准与生产上线

**Date**: 2026-09-17
**Task**: 按天监控收尾：默认值、同段不重复、图例校准与生产上线
**Branch**: `master`

### Summary

承按天监控上线后的实测反馈做四处收尾并上生产。① 新增监控默认改 20:00-21:00 / 1 小时（编辑已有监控仍读自身值）。② 同一天同一时间段不可重复建监控：服务端 intentService.findByWindow() + validators 跨字段校验返回 422「该时段已有监控」（绕过 UI 的兜底），前端保存前本地先拦一次；部分重叠允许、编辑排除自身、跨天不受影响；按钮文案「+ 开启这天监控」改「+ 新增监控」。③ 日历网格下方图例补齐监控状态：按聚合优先级动态列出「当月真正出现」的状态（复用 MONITOR_PILL_CLASS / BADGE_PRIORITY，与格子同源），过去日不计入；随后按反馈把「已暂停 / 等待」这类安静状态移出图例（LEGEND_HIDDEN_STATES 常量），图例恢复原样但仍能解释需验证/已锁到/监控中/待放票。验证手段从代码推理升级为实际观测：Playwright DOM 断言（不可用日 unavail=true 且 pill=null，确认 X 与徽标二选一；同日两条聚合出 ×2 角标）、390×844 实拍截图核对图例、smoke e2e 20/20（light/dark × 390 与 360 宽，断言无横向滚动）、服务端 208/208（新增 findByWindow 与同日同时段 API 用例）、client build。部署：测试 8090 与生产 8088 均重建镜像并校验前端产物 hash 与本地 dist 一致；生产用已有日期+时段重放验证重复校验返回 422 且未写入（意图数仍 7）；无迁移、无 DB 改动、容器 RestartCount=0。教训（已记）：测试环境与生产共用同一个场馆 token，在 8090 建 enabled 的 auto_lock 监控会真下订单——验收监控功能必须用 enabled:false 或 mode:notify，本轮误建 3 条后立即删除，未产生订单。遗留观察：生产 3 条承接自旧 weekly 的 auto_lock 监控被手动启用（09-21/22/23，状态 waiting），将在各自进放票窗口那天 09:00 开抢（09-21→9/18、09-22→9/19、09-23→9/20），受每日限订 2 笔约束；8090 留有 3 条演示数据（含一条启用中的仅提醒监控）。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e8df3a6` | (see git log) |
| `0b0bb96` | (see git log) |
| `2e3494c` | (see git log) |
| `5419770` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: 锁场整单打包：一笔订单装整段片次（绕开未支付限制）+ 场馆反馈治理

**Date**: 2026-09-17
**Task**: 锁场整单打包：一笔订单装整段片次（绕开未支付限制）+ 场馆反馈治理
**Branch**: `master`

### Summary

场馆实测（2026-09-17）确立三条硬约束并据此重写锁场：① 一笔订单可装多个片次（实测 2-4 个连续时段与同小时多片场都返回 200，订单 153439 totalAmount=70 证明 2 个时段进同一笔），而场馆同时只允许 1 笔未支付订单，逐片次下多笔时第二笔必被拒（生产 2026-09-11 真实 UNPAID 失败记录）→ 改为整单打包：buildAreaItems 透传整单 raw、placeOrder 一次 check+create、attemptLockOrder 成功落 N 条 locked（同 order_id/expire_at）失败落 N 条 failed（同 error/error_code）；② LIMITED_BY_START_TIME 是软提示不是拦截（该码后 createOrder 仍 200，含义是距开场不足 12 小时不可退款）→ 照常下单 + 推送注明不可退款 + 不落 LIMIT；③ UNPAID → 推「需要先支付」+ 自动停用意图（skipped:'unpaid'），不再徒劳重试。配置按每日 2 片次硬上限收敛：时长 1-2、片场 1-2、乘积 ≤2（越界 422），前端联动以「最后一次选择生效」自动纠正（SegmentedControl 不支持禁选项）。恢复支付截止可视化：下单响应 expireTime（北京时间）转 UTC 存 booking_intent_locks.expire_at（迁移 019，hasColumn 幂等），推送与 /locks 输出、锁场记录面板展示。测试 214/214（新增 6 条：整单打包 2 例、UNPAID 停机、软提示、时区、019 幂等、引擎级一轮一单）；client build 通过。独立审查无 P0，P1（文档未同步）已修，P2 顺手修 3 条（落库不完整告警、跨轮支付截止取最晚、界面展示支付截止），UI 自动化证据用 Playwright 补齐（选项 1/2、联动收敛、2 小时×1 片可保存）。部署：测试 8090 与生产 8088 均重建镜像并验收（迁移 019 执行、产物 hash 一致、意图 7 条与锁场记录 16 条完好）。遗留：放票日 09:00 实战行为待观察（连打是否一笔订单装 2 片次、UNPAID 是否停用并推送）。测试环境保留一条 paused 的 2 小时样例供随时查看。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `6d598be` | (see git log) |
| `fb10fa0` | (see git log) |
| `8833adc` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: 图例校准收尾：彻底移除图例里的监控状态

**Date**: 2026-09-17
**Task**: 图例校准收尾：彻底移除图例里的监控状态
**Branch**: `master`

### Summary

用户反馈日历下方的图例仍显示「监控中」——5419770 只去掉了「已暂停/等待」，把「监控中」当需要留意的状态保留了，违背本意。本次彻底移除图例里的监控状态（删 monthMonitorStates / legendVisible / LEGEND_HIDDEN_STATES 与 .legend-pill 样式），Info bar 恢复为「● 有订场 · ✕ 不可用 · Nh」（两个条目各自按是否存在显示），格子上的监控徽标与 ×N 角标不受影响。验证：build / build:test 通过；测试环境 Playwright 实测图例行 =「有订场 不可用 3h」、图例内监控状态为空数组、格子徽标仍在（7×已暂停）；生产产物 hash 一致（index-DSD5drRJ.js）且产物内已无 legend-pill，health ok。部署：测试 8090 与生产 8088 均已更新。备注：图例显示范围这个点本轮反复了三次（补状态 → 去掉暂停/等待 → 全去掉），已向用户提议把约定写进 CONTEXT.md「监控状态」词条（图例只解释订场圆点与不可用标记，监控状态只在格子上呈现），待其确认后补一行。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `ebd6afd` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: 订场日历节假日（chinese-days 休/班 + 节日名）

**Date**: 2026-09-22
**Task**: 订场日历节假日（chinese-days 休/班 + 节日名）
**Branch**: `master`

### Summary

订场日历与 DaySheet 显示中国法定节假日/调休：新增 client/src/utils/holiday.js（holidayFor，name 含逗号判定）、BookingCalendar 格子休/班 tag + DaySheet 节日行；chinese-days 离线包；e2e/holidays.spec.js 固定时钟 2026-10-01，全量 60 passed；360px 密集格 0 重叠 0 溢出，DaySheet 对比度修至 WCAG AA；spec 新增 date-holidays 并补充着色底对比度与 e2e 时钟/几何约定。生产部署（Step 7）待确认。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `f242db6` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: 订场日历换用 Vant 4 Calendar

**Date**: 2026-09-23
**Task**: 订场日历换用 Vant 4 Calendar
**Branch**: `master`

### Summary

用户判定自研日历太丑，选型换用 Vant 4 Calendar（2026-08 活跃、月下载 42.8 万、中文内建）：BookingCalendar 重写为 Vant 包装（poppable=false、64px 行高、formatter+三插槽渲染休/班、不可用 X、监控胶囊、订场圆点），删除自研 DayCell；可见月用 IntersectionObserver 跟踪（Vant monthShow 只发一次）驱动月摘要；e2e 重写 5 用例，全量 64 passed；check 发现并修复深色月份水印压字（showMark 关闭）、X 对比度、角标盒重叠；spec 同步 Vant 约定。生产部署待用户确认。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `2d7a5ee` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: 订场日历 v3：自绘固定单月 + 两态色条/填色统一视觉

**Date**: 2026-09-24
**Task**: 订场日历 v3：自绘固定单月 + 两态色条/填色统一视觉
**Branch**: `master`

### Summary

十二轮草图迭代定稿并上线：弃 Vant Calendar 改自绘固定单月（‹›切月、恒 6 行、相邻月灰字填充、容器高度=日历自然高度永不滚动）；监控日历收敛为两态色条（监控中深蓝/待放票浅蓝），瞬态交给推送、DaySheet 保留明细；订场记录列表回生产版结构（SegmentedControl 右上角、全量展示+内滚、等高切换不跳动）；图例分组固定并抽成 CalendarInfoBar 组件（0h 占位）；修 transition-all 拖住 visibility 的切页延迟；e2e 68 通过；生产 :8088 已部署新日历。ADR 0003 + CONTEXT.md 契约同步

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a05bb94` | (see git log) |
| `9d71f67` | (see git log) |
| `6e56857` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
