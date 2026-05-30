# 后端优化备忘

> 记录日期：2026-05-24
>
> 目的：先沉淀后端当前可优化点，后续按优先级逐项处理。本文只记录问题和建议方向，不代表需要一次性重构。

## 1. 数据完整性与安全

### P0：删除规则事件外键问题

状态：已完成（2026-05-24）

- 现状：`game_rule_events` 引用 `games/matches/rounds/seasons`，但删除赛季、轮次、比赛时主要删除 `games -> matches -> rounds -> seasons`，没有统一处理规则事件。
- 风险：S5 order 局产生 `game_rule_events` 后，删除相关比赛、轮次或赛季可能触发外键约束失败。
- 建议：
  - 优先方案：为相关外键补 `ON DELETE CASCADE` 迁移。
  - 保守方案：删除 `games` 前显式删除对应 `game_rule_events`。
- 本次处理：
  - 增加规则事件删除 helper。
  - 比赛、轮次、赛季删除前显式删除对应 `game_rule_events`。
  - 补充 S5 规则事件删除回归测试。

### P0：写接口缺少鉴权

状态：代码已完成（2026-05-24，待部署时设置 `ADMIN_TOKEN`）

- 现状：项目已有 `users` 表和 JWT 依赖，但 API 路由尚未接入认证中间件。
- 风险：公网环境下，上传、删除、修改等接口都可被直接调用。
- 建议：
  - 先给写接口加简单 admin token/JWT 校验。
  - 或在反向代理层临时限制来源，但最终仍建议后端加保护。
- 本次处理：
  - 新增 `server/src/middleware/writeAuth.js`。
  - `POST/PUT/PATCH/DELETE` 写接口在配置 `ADMIN_TOKEN` 后需要写入权限令牌。
  - 支持 `x-admin-token` 请求头和 `Authorization: Bearer <token>`。
  - 未配置 `ADMIN_TOKEN` 时保持当前行为，避免直接破坏现有前端操作流。
  - 补充鉴权开启后的读接口放行、写接口拒绝、合法 token 放行测试。
- 后续启用：
  - 部署环境设置 `ADMIN_TOKEN`。
  - 前端写请求已支持 `x-admin-token`，首次遇到缺少 token 会提示输入并保存到本机 `localStorage`。
  - `docker-compose.yml` 与 `docker-compose.test.yml` 已接入 `ADMIN_TOKEN=${ADMIN_TOKEN:-}`，未设置时保持旧行为。

### P0：头像上传校验不足

状态：已完成（2026-05-24）

- 现状：`/api/upload/avatar` 只校验 base64 data URL，未限制文件类型、真实大小、文件签名。
- 风险：可能上传异常大文件或伪装格式文件。
- 建议：
  - 只允许 `jpg/png/webp`。
  - 限制解码后文件大小。
  - 使用 `crypto.randomUUID()` 生成文件名。
  - 返回统一错误结构。
- 本次处理：
  - 限制 `jpg/png/webp`。
  - 限制头像最大 2MB。
  - 校验图片文件签名。
  - 使用 `crypto.randomUUID()` 生成文件名。
  - 补充非法上传回归测试。

## 2. API 一致性与验证

### P1：统一错误处理

状态：已完成（2026-05-24）

- 现状：比赛、轮次、赛季部分接口使用 `sendControllerError`；`players/bookings/club/titles/venues/upload` 等仍有 `serverError(res, err.message)`。
- 风险：错误响应不稳定，可能暴露 SQLite 内部错误。
- 建议：
  - 所有 controller 统一使用 `sendControllerError`。
  - 保留日志里的真实错误，前端只收到稳定业务错误。
- 本次处理：
  - `players/bookings/club/titles/venues/upload` 已统一走 `sendControllerError`。

### P1：补齐写接口输入验证

状态：已完成（2026-05-24）

- 现状：比赛和比分验证较完整；赛季、订场、场地、选手更新等接口验证较松。
- 风险：非法 `status/ruleId/bestOf/participants/playerId/venueId` 可能写入数据库。
- 建议：
  - 扩展 `server/src/utils/validators.js`。
  - 所有写接口校验枚举值、数字范围、必填项和关联资源存在性。
- 本次处理：
  - 扩展通用验证工具：文本、正整数、非负数字、字符串数组、规则 ID、JSON 对象、日期。
  - 赛季创建/更新校验 `name/totalRounds/bestOf/status/ruleId/participants/comebackData/color`，并校验参赛选手存在。
  - 场地创建/更新校验 `name/address/hourlyRate/notes`。
  - 订场配置校验轮换名单和当前轮换序号。
  - 订场记录校验订场人、场地、日期、费用和备注。
  - 选手更新校验姓名、头像、装备和展示称号。
  - 修复订场记录创建时错误写入字符串 ID 到自增整数主键的问题。
- 后续剩余：
  - 继续补 `club/titles` 写入类接口的更细验证。
  - 视需要补更多业务状态限制，例如已开始赛季是否允许改规则。

### P1：统一场地 API 边界

状态：已完成（2026-05-24）

- 现状：`/api/venues` 是只读，`/api/bookings/venues` 才有 CRUD。
- 风险：接口职责不清，前端和后端后续维护容易分叉。
- 建议：
  - 将场地 CRUD 统一到 `/api/venues`。
  - `/api/bookings` 只保留订场配置和订场记录。
- 本次处理：
  - `/api/venues` 已支持 `GET/POST/PUT/DELETE`。
  - `/api/bookings/venues` 保留为兼容入口，并转发到同一套 `venuesController` 实现。
  - 新增场地 CRUD 和旧路由兼容测试。

## 3. 可维护性与可读性

### P1：统一 Controller 分层风格

状态：已完成（2026-05-24）

- 现状：`matches` 已接近 `controller -> service`；`bookings/players/club/titles` 等仍由 controller 直接写 SQL。
- 风险：controller 越来越厚，业务逻辑和响应逻辑混在一起。
- 建议：
  - 逐步统一为 `routes -> controllers -> services -> db`。
  - 优先拆 `bookingsController`，可分为：
    - `venueService`
    - `bookingConfigService`
    - `bookingRecordService`
- 本次处理：
  - 新增 `server/src/services/venueService.js`，下沉场地 CRUD、格式化和 ID 生成。
  - 新增 `server/src/services/bookingService.js`，下沉订场配置、订场记录、轮换推进、格式化和关联存在性查询。
  - `venuesController` 和 `bookingsController` 保留参数验证、响应和错误映射。
  - 新增 `server/src/services/playerService.js`，下沉选手查询、更新、格式化和称号存在性查询。
  - 新增 `server/src/services/clubService.js`，下沉俱乐部读取和更新。
  - 新增 `server/src/services/titleService.js`，下沉称号查询和玩家称号分组格式化。
  - `playersController/clubController/titlesController` 已精简为验证、响应和错误映射。
  - 新增 `server/src/services/seasonService.js`，下沉赛季 CRUD、格式化、参与者存在性查询和删除级联。
  - 新增 `server/src/services/roundService.js`，下沉轮次查询、创建前查询、更新、删除级联，并复用 `roundCreationService`。
  - `seasonsController/roundsController` 已精简为验证、响应和错误映射。
  - 清理 `routes/games.js` 中遗留的直接 SQL 查询，统一转到 `gamesController -> gameService`。

### P1：抽离核心记分编排

状态：已完成（2026-05-24）

- 现状：`gamesController.endGame/updateCompletedScore/revertGame` 中包含取上下文、规则校验、写 game、触发规则事件、重算 match/round 等核心流程。
- 风险：controller 业务编排偏重，后续规则扩展时可读性下降。
- 建议：
  - 新增 `gameService`。
  - 暴露 `endGame(gameId, input)`、`updateCompletedScore(gameId, input)`、`revertGame(gameId)`。
  - controller 只负责参数、响应和错误映射。
- 本次处理：
  - 新增 `server/src/services/gameService.js`。
  - 迁移 `updateScore/endGame/updateCompletedScore/revertGame` 的状态检查、事务写入、规则触发、match/round 重算。
  - `gamesController` 保留 HTTP 参数校验、响应映射和错误映射。

### P2：抽公共 formatter/serializer

状态：已完成（2026-05-24）

- 现状：多个 controller/service 手写 `snake_case -> camelCase`。
- 风险：字段格式不一致，新增字段容易漏。
- 建议：
  - 每个领域先放到对应 service 的 `formatXxx`。
  - 后续如重复明显，再抽 `serializers/` 或轻量 `mapFields` helper。
- 本次处理：
  - 各领域 formatter 已下沉到对应 service：`match/game/round/season/venue/booking/player/title`。
  - controller 不再承担主要字段格式化。

### P2：抽动态 UPDATE helper

状态：已完成（2026-05-24）

- 现状：多处重复 `sets/params` 动态拼接逻辑。
- 风险：重复代码多，字段漏改概率高。
- 建议：
  - 增加小型 helper，只负责从 patch 和字段映射生成 `sets/params`。
  - 不把业务规则塞进 helper，避免过度抽象。
- 本次处理：
  - 新增 `server/src/utils/updateBuilder.js`。
  - 接入 `playerService/clubService/venueService/bookingService/seasonService/roundService/matchService` 的动态更新路径。

### P2：后端常量集中管理

状态：已完成（2026-05-24）

- 现状：`pending/in_progress/completed`、`bo1/bo3/pa7`、`a/b`、`standard/s2/s3/s4/s5` 等 magic string 分散在代码里。
- 风险：拼写错误难发现，规则扩展时不清晰。
- 建议：
  - 新增 `server/src/constants.js` 或按领域拆分常量。
  - 包含 `MATCH_STATUS`、`ROUND_STATUS`、`SEASON_STATUS`、`MATCH_FORMAT`、`WINNER_SIDE`、`RULE_ID`。
- 本次处理：
  - 新增 `server/src/constants.js`。
  - 集中 `MATCH_STATUS/ROUND_STATUS/SEASON_STATUS/MATCH_FORMAT/WINNER_SIDE/RULE_ID/SCORING_MODE`。
  - 接入 validators、规则插件、比赛/轮次/赛季/记分相关 service 与 controller。

### P2：统一 JSON 解析入口

状态：已完成（2026-05-24）

- 现状：`JSON.parse(row.team_a || '[]')`、`JSON.parse(season.comeback_data)` 等分散各处。
- 风险：历史脏数据会直接导致 500。
- 建议：
  - 增加 `parseJson(value, fallback)` 和 `stringifyJson(value)`。
  - 用于 `participants/team_a/team_b/comeback_data/rotation/payload`。
- 本次处理：
  - 新增 `server/src/utils/json.js`。
  - 接入 `participants/team_a/team_b/comeback_data/rotation/payload` 相关读写路径。

### P2：规则插件接口文档化

状态：已完成（2026-05-24）

- 现状：`standard` 和 `s5` 已有类似接口，但 S2/S3/S4 后端暂时映射到 standard。
- 风险：后续实现多个规则时接口自由发挥。
- 建议：
  - 明确规则插件接口：
    - `getGameConfig(ctx)`
    - `validateGameEnd(ctx, input)`
    - `afterGameCompleted(ctx, result, input)`
    - `onGameReverted(ctx)`
  - 可加默认 rule adapter，未实现的 hook 使用 no-op。
- 本次处理：
  - 新增 `server/src/rules/README.md`，记录规则插件结构、hook 返回值、上下文字段和注册约定。
  - 新增 `server/src/rules/adapter.js`，为缺失的可选 hook 填充 no-op，为缺失的核心 hook 回退到标准规则。
  - `rules/index.js` 统一返回 normalize 后的规则对象。
  - 补充规则 adapter 和 `getRule` 回退行为测试。

## 4. 持久化与测试维护

### P2：ID 生成统一

状态：已完成（2026-05-24）

- 现状：赛季、轮次、友谊赛、订场记录、头像文件多处使用 `Date.now()`。
- 风险：快速连点或并发请求可能撞 ID。
- 建议：
  - 增加统一 ID helper。
  - 使用 `crypto.randomUUID()` 或带前缀的稳定随机 ID。
- 本次处理：
  - 新增 `server/src/utils/id.js`。
  - 统一赛季、轮次、友谊赛、场地和头像文件名的 ID 生成入口。
  - 后端业务 ID 生成路径已移除直接 `Date.now()`。

### P2：sql.js 原子写盘

状态：已完成（2026-05-24）

- 现状：`saveDatabase()` 直接覆盖 DB 文件。
- 风险：进程崩溃或磁盘中断时有数据库文件损坏风险。
- 建议：
  - 先写入临时文件。
  - 成功后 `rename` 原子替换。
  - 保留现有备份策略，并考虑定期备份。
- 本次处理：
  - `saveDatabase()` 先写入当前 DB 文件旁的临时文件。
  - 写入成功后使用 `fs.renameSync` 原子替换正式 DB 文件。
  - 保留现有备份和延迟保存策略。

### P2：测试 helper 抽离

状态：已完成（2026-05-24）

- 现状：后端测试中多处重复临时 DB、插入赛季、插入比赛、完成局等逻辑。
- 风险：新增测试成本高，测试数据构造不一致。
- 建议：
  - 新增 `server/test/helpers/`。
  - 抽出：
    - `setupTestDb`
    - `insertPlayers`
    - `insertSeason`
    - `insertRound`
    - `insertMatch`
    - `startMatch`
    - `finishGame`
- 本次处理：
  - 新增 `server/test/helpers/backendTestHarness.js`。
  - 抽出测试 DB 生命周期、默认选手、赛季、S5 赛季、轮次、比赛、开始比赛、完成局、常用查询 helper。
  - 重构 `matchStateMachine.test.js` 和 `roundCreation.test.js`，保留业务断言，移除重复初始化和构造代码。
  - 调整 `server/package.json` 测试脚本为 `node --test test/*.test.js`，避免 helper 文件被测试发现器当作空测试执行。

## 建议执行顺序

1. 先做 P0：规则事件删除、写接口鉴权、上传校验。
2. 再做 P1：统一错误处理、补齐验证、统一场地 API、拆 `bookingsController` 和 `gamesController` 核心编排。
3. 最后做 P2：常量、JSON helper、update helper、formatter、ID helper、原子写盘、测试 helper。

原则：不要一次性大重构。每次只处理一个清晰问题，并补对应测试。
