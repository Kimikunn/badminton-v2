# PRD: 订场监控与日历合并（按天开启监控）

## Goal

把「辅助订场监控」从"每周几"改成**日历上的天**：在订场日历里点选某一天，即为这一天设置/开启监控。7 天同等对待，没有「工作日 / 周末 / 每天」这类分组概念，也没有每周重复——一天一条（可多条并存的集合）。

配套要求：监控生命周期要有**显式状态机**并集中管理；风控拦截（09:00 抢票必触发图形验证）要在状态里体现；双模型（单次 / 每周）收敛为单模型。

## Background

### 服务端现状

- `booking_intents` 表支持双模式：`date`（单次某天）与 `weekdays`（每周重复），二选一（`server/src/db/schema.sql:151-164`）。
- 校验在 `server/src/validators/intentValidators.js:52-72`：date/weekdays 互斥、窗口先后、时长 ≤ 窗口，且**单次日期被限制在放票窗口内**（`:70-72`）。
- 展开在 `server/src/services/intentService.js:118-145` `expandIntentDates()`：单次返回 `[date]`（过期返回 `[]`）；每周返回放票窗口内匹配的具体日期；`unavailable_days` 一律排除。
- 放票窗口 `BOOKING_WINDOW_DAYS = 4`（`server/src/services/venueShared.js:8`），即今天 ~ 今天+3。
- 引擎取数计划只为窗口内每天建条目（`watchEngine.js:218-230`），**每天早上 09:00 放「今天+3」那天的票**（`releaseDate()` `:212-214`，`RUSH_HOUR=9` `:40`，`maybeStartBurst()` `:390-402` 只在 `>= 09:00` 开 burst）。窗口外日期的意图因此自然闲置、进窗口自动生效。
- 锁场记录 `booking_intent_locks` 的状态有 `locked / failed / expired` 三种（`markExpiredOnReturn()` `bookingLockService.js:190-197`），**失败原因只有中文 `error` 文本、没有结构化错误码**（表结构见 `schema.sql:166-179`）。
- 「整段满足」判定在 `bookingLockService.js:217-268`（`buildHourMap` + `findRun`），`occurrenceFulfilled()` `:178-180` 用 `buildHourMap(intent, date, [])` 只看 locked 记录。
- **锁到即停**（2026-08-30 决策）：整段锁齐后意图自动 `enabled=0`（`bookingLockService.js:8`、`:336`，文案 `:397`）。
- 风控重试窗口（2026-09-17 上线）：`createOrder` 返回 429/403004 判定风控（`bookingLockService.js:120-121`），引擎进入重试循环（`watchEngine.js:144-197`）：推「需要过验证」→ 4 分钟内每 12 秒重试 → 锁到即止 / 超时推失败。重试状态存在 `rcRetrying`（进程内 Set，`watchEngine.js:59`），**未暴露给任何 API**。

### 前端现状

- `client/src/components/venue/IntentPanel.vue`（587 行）：表单是"今天起 7 天滚动星期条"但语义是"每周几"（`weekStrip` `:210-232`）；卡片徽标把 `1,2,3,4,5` 收拢成「工作日」、`0,6` 收拢成「每周末」（`weekdaysLabel` `:59-66`）；面板还承载总开关与锁场场地优先级。锁场记录 / 通知历史受 `SHOW_LOGS` 门控，**生产构建不可见**。
- `client/src/components/venue/BookingCalendar.vue`（283 行）：月历格子已有订场圆点、`unavailable_days` X 标记、今天环、过去日灰显；点某天打开内部 sheet（当天订场记录 / 标记不可用 / 新增订场）。**完全不知道监控的存在**。
- `client/src/stores/intent.js`（94 行）：`config` / `intents` / `areas` 三个 ref + CRUD action，没有按日期索引、没有状态派生。

### 生产数据（2026-09-17 快照）

`booking_intents` 6 行，**全部 weekly 且全部 `enabled=0`**：`[3]`、`[0,6]`、`[2]`、`[4]`、`[1]`、`[5]`，窗口全是 20:00-21:00（周末那条 12:00-17:00）。用户已在"一天一条"地使用，且当前没有启用中的监控。

## Requirements

- **R1 日历即入口**：订场日历是监控的唯一设置入口。点某一天 → 打开当天 sheet → 设置/开启/关闭该天监控。`IntentPanel.vue` 删除。
- **R2 单日语义**：监控绑定具体日期（不再有每周重复），一天可有**多条**（多时段）。日历格子按聚合规则显示当天监控状态。
- **R3 提前设置**：任意**今天及以后**的日期都能设监控。窗口外（> 今天+3）为"待放票/等待"状态，进入窗口后自动生效、09:00 自动参与抢票。
- **R4 显式状态机**：每条监控有唯一 `status`，由服务端纯函数派生（单一事实来源），日历与 sheet 读同一份；前端只做聚合折叠。
- **R5 风控可见**：09:00 被图形验证拦截时，状态显示"需验证"并暴露重试截止时间；失败原因以**结构化错误码**落库，不靠中文文案匹配。
- **R6 单模型**：服务端只接受 `date` 模式；现有 weekly 数据迁移为单日意图，`weekdays` 列删除；`expandIntentDates` 每周分支删除。
- **R7 过期落幕**：`date < today` 的意图每日清扫为 `enabled=0`（保留行与历史）。
- **R8 全局设置可达**：总开关、锁场场地优先级移到日历页头的设置 sheet。
- **R9 历史按天**：锁场记录 / 通知历史改为按日期查询展示（仍受 `SHOW_LOGS` 门控）。

## 状态模型：两个正交维度（定稿）

**一天有两个互不干涉的维度，各自一个事实来源，永不叠加、永不互相覆写。**

| | 维度一：监控状态 | 维度二：日期标记 |
|---|---|---|
| 挂在哪 | 一条监控（一天可多条） | 一天（与监控数量无关） |
| 字段 | `status`（服务端派生）+ `enabled`（用户开关） | `unavailable` 布尔（`unavailable_days`） |
| 语义 | 引擎此刻在做什么 / 做成了什么 | 这天不在射程内 |
| 引擎怎么用 | 驱动锁场与推送 | `expandIntentDates()` 实时过滤掉（已有逻辑） |
| 界面怎么用 | 日历徽标（聚合）+ sheet 列表 | 格子 X 覆盖（现有渲染分支，二选一） |

**单条监控 `status`**（优先级从上往下、首个命中为准）：

| # | status | 判定 | UI 文案 |
|---|---|---|---|
| 1 | `expired` | `date < today` | 已过期（过去日不渲染徽标） |
| 2 | `awaiting_verify` | 引擎重试窗口正在跑（`${intentId}|${date}` ∈ `rcRetrying`） | 需验证（附截止时间） |
| 3 | `fulfilled` | 该意图当天 locked 记录能凑齐整段（复用 `findRun` 判定） | 已锁到 |
| 4 | `pending_release` | `enabled && date === today+3` 且当前时刻 < 09:00 | 待放票（今天 09:00） |
| 5 | `waiting` | `enabled && date > today+3` | 等待放票 |
| 6 | `watching` | `enabled && date ∈ [today, today+3]` | 监控中 |
| 7 | `paused` | 其余（`!enabled && date ∈ 窗口`） | 已暂停 |

**日历格子徽标**（当天多条监控的聚合，取优先级最高的一条 + 条数）：

`awaiting_verify > fulfilled > watching > pending_release > waiting > paused`

**不引入 `blocked` 状态、也不做日级状态枚举**：不可用是维度二，与监控状态同级别但不同维度；混进枚举会立刻产生"不可用压过 watching 还是反之"的优先级问题，以及"取消标记后该恢复成什么"的隐藏状态。保持正交 → 两边都是实时求值，零同步、零恢复逻辑。

**交互规则**：

- 给已有监控的日期打不可用标记 → 二次确认（说明监控会暂停）；标记后监控 `enabled` 不变，引擎下次展开自动跳过。
- 取消标记 → 下一次 tick 自动恢复参与抢票，无需恢复任何记忆。
- 不可用日的 sheet 里，监控区块换成提示「该日已标记不可用，监控不会生效」+「取消标记」入口（即不可达"新建监控"）；API 层不因此报错（校验层不去耦合日期表）。

**状态转移**：

```
waiting / pending_release ──(进窗口 / 到 09:00)──> watching
watching ──(整段锁到)──> fulfilled（引擎同时 enabled=0）
watching ──(风控拦截)──> awaiting_verify ──(锁到)──> fulfilled
                                        └─(窗口超时)──> watching（继续盯回流）
watching ──(用户关 / 过期清扫)──> paused / expired
paused ──(用户开)──> watching
```

进程重启边界：`rcRetrying` 与截止时间都在内存，重启后清空 → 状态自然回落 `watching`，不会残留假的"需验证"。

## Acceptance Criteria

- **AC1**（R1/R2）：日历上任选一天（今天起）都能打开 sheet 并新建监控；同一天可加多条时段；`IntentPanel.vue` 不存在于代码库。
- **AC2**（R1/R3）：可设置今天之后任意日期；`date < today` 返回 422；过去日期在日历上不可点。
- **AC3**（R2）：日历格子显示当天监控聚合徽标（含条数），过去日期不显示徽标。
- **AC4**（R4）：`GET /api/intents` 返回的每条意图带 `status`，与服务端派生规则逐条一致（`intentService.test.js` 覆盖 7 种状态 + 优先级边界）。
- **AC5**（R5）：风控拦截时该意图 `status === 'awaiting_verify'` 且带截止时间；锁场失败记录落 `error_code`（`RISK_CONTROL`/`SOLDOUT`/`LIMIT`/`UNPAID`/`OTHER`）。
- **AC6**（R6）：迁移后 `booking_intents` 无 weekly 行、`weekdays` 列不存在；`POST /api/intents` 传 `weekdays` 返回 422；旧锁场记录/通知记录仍可按日期查询。
- **AC7**（R7）：每日清扫把过期意图置为 `enabled=0`，未过期的不受影响，锁场记录不被改动。
- **AC8**（R8）：总开关与锁场场地优先级在日历页头设置 sheet 中可读写，行为与改动前一致。
- **AC9**（R9）：`GET /api/intents/locks?date=` 与 `GET /api/intents/notifications?date=` 返回该日记录。
- **AC10**：`cd server && npm test` 全绿（含新增用例）；`cd client && npm run build` 通过。
- **AC11**（正交维度）：不可用日格子显示 X、不显示监控徽标；给有监控的日期打标记需二次确认；取消标记后下次 tick 监控自动恢复（无需恢复状态）；不可用日 sheet 内给出"监控不会生效"说明与取消标记入口。

## Out of Scope

- 批量设置（多选多天套用同一配置）——留待后续，单个按钮级改动即可加。
- 每周重复 / 周期性监控——按 D1 明确去除。
- 自动过图形验证（服务端无法完成，需用户在小程序内配合）。
- 支付环节自动化。

## Decisions

- **D1（用户决策 2026-09-17）**：监控语义 = **仅这一天**，不做每周重复。依据：锁到即停（`bookingLockService.js:8`、`:336`）使"循环"在成功路径上不成立；生产数据也全是一天一条。
- **D2（用户决策）**：允许提前在任意未来日期设置监控，进窗口自动生效；放开 `intentValidators.js:70-72` 的窗口限制，改为"不早于今天"。
- **D3（用户决策）**：一天允许多条监控（多时段），逻辑要严谨。
- **D4（用户决策）**：删除 `IntentPanel.vue`，日历为唯一入口；全局设置进页头设置 sheet；锁场记录/通知历史改为按天展示。
- **D5（用户决策）**：不做批量设置。
- **D6（用户决策）**：彻底单模型——weekly 迁移为单日意图，校验只收 `date`。
- **D7（用户决策）**：过期意图每日清扫为 `enabled=0`，记录保留。
- **D8（用户决策）**：区分 `pending_release`（今天+3 且 09:00 前），状态按钟点切换而非按数据到达（服务端无法区分"未放票"与"放票但已抢空"）。

## 风险

- **迁移不可逆**：删除 `weekdays` 列并重建 weekly 行为单日意图。部署前必须备份 `server/database/*.db`（既有惯例：`server/database/backups/`），回滚 = 恢复备份 + 回退镜像。
- **提前设置后遗忘**：窗口外设置的监控会在放票日 09:00 自动抢；兜底是未支付订单 5 分钟自动释放 + 推送告知。
- **09:00 后票被抢空**：状态仍显示"监控中"（引擎在盯回流），这是诚实但可能被误读为"还有机会"；在 sheet 内用 `lastAttempt` 显示最近尝试结果缓解。

## 验收记录（2026-09-17）

| 项 | 证据 |
|---|---|
| AC4/AC5/AC6/AC7/AC9/AC10 | `cd server && npm test` → **206/206 pass**（含状态派生逐状态与优先级边界、lockRun 9 例、error_code 五分类、`?date=`/`?from,to=` 与 422、清扫去重、迁移展开/承接/幂等/真实库演练） |
| AC10（前端） | `cd client && npm run build` 通过（vite + PWA 产物） |
| AC1/AC3/AC8/AC11 | 独立审查逐项核对通过（徽标与 X 分支二选一、不可用日不可新建、打标记二次确认、总开关与优先级两种视图可达、`SHOW_LOGS` 门控保留）；审查另发现并已修：订场记录为空时日历不可达（P1） |
| 迁移安全 | 真实库副本演练：weekly 6 行 → 7 条 date 意图（3 条窗口内无匹配承接为下一个发生日 09-21/22/23），`weekdays` 列消失，`error_code` 列新增，锁场 15 条 / 通知 24 条完好，二次启动幂等 |
| 部署后环境验收 | **待做**：测试环境（8090）点日期建监控、徽标与状态一致、提前设置显示"等待放票"、迁移日志 `018_single_date_intents` |

### 审查处置（独立 review 子代理）

P1-1 空态日历不可达（已修）、P2-1 迁移不再删无匹配行（改为承接下一发生日）、P2-2 回填补 `已被预订→SOLDOUT`、P2-3 重试窗口起算点回到"引导推送后"、P2-4 迁移用例空转与 SOLDOUT 覆盖缺口（已修）、P2-6 删除死代码 `isDateBookable`。遗留未修（已记录）：过去日期的历史记录在 UI 上不可达（`SHOW_LOGS` 生产恒为 false，仅测试环境可见）；016 的 v1 导入路径保留旧的"无匹配即丢弃"规则（该路径对生产已是历史）。
