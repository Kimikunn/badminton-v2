# PRD: 订场提醒与推送

## Goal

在现有羽毛球俱乐部管理应用中，内置"订场提醒 + 推送"功能：监控川沙体育中心小程序（`#小程序://川沙体育中心/预订/kCT9cFoM9KGwdTv`）的场地可订状态，用户指定的日期/场次出现可订变化时，立即通过 webhook 推送提醒，帮助用户及时抢场。

## Background / Confirmed Facts

- 小程序链接是微信内部协议，只能在微信内打开；公开网络无该场馆的开放 API 或 H5 预订页。订场数据只能通过抓包小程序 HTTPS 接口获取。
- 现有 `server/src/services/bookingService.js` 是内部订场记录模块（订场人轮换、费用），与本功能无冲突；服务端已有 routes/services 分层，新功能作为新模块加入。
- 客户端为独立前端（client/），有 Playwright e2e 设施。

## Requirements

- **R1 数据获取（抓包重放）**：用户手机端抓包小程序订场接口，提供请求样本（HAR 或请求/响应文本）；服务端据此实现定时轮询场地可订状态。若接口需要登录态，需评估 token 有效期与刷新方式。
- **R2 监控目标配置**：单日或每周重复两种模式；通过实时"场地×时段"可订网格点选场次（多场地、时段窗）；支持多条目标、启用/停用；过期单日目标自动失效置灰。
- **R3 状态变化检测与推送**：服务端按可配置频率轮询启用中的目标，检测到可订状态变化（不可订→可订，或新增可订时段）时立即推送；同一变化不重复推送。
- **R4 推送渠道**：PushPlus 群组推送（首选），凭证走服务端 .env（`GYM_TOKEN_USER`/`PUSH_TYPE`/`PUSH_TOKEN`/`PUSH_TOPIC`/`PUSH_URL`），**不提供界面配置**；界面只显示配置是否就绪。
- **R5 管理界面**：监控目标的网格点选与增删改查、全局总开关 + 逐项开关、推送历史与轮询状态查看。

## Acceptance Criteria

- AC1：配置 webhook 与监控目标后，人为制造一次可订状态变化（或用录制的接口响应回放），应用内能收到一条且仅一条推送，推送内容包含场馆、日期、时段、当前可订状态。
- AC2：轮询在目标范围内运行，非监控范围的日期/时段变化不触发推送。
- AC3：监控目标可增删改、停用后不再轮询；推送历史可查询。
- AC4：抓包接口失效（返回错误/结构变化）时，系统记录错误并可选推送一条告警，不静默失败。

## Out of Scope（首版）

- 自动下单 / 自动支付（先跑通提醒，下单后续再议）。
- 多场馆支持（仅川沙体育中心）。
- 微信公众号模板消息等需要资质的推送方式。

## Technical Notes（抓包分析结论，HAR: Stream-2026-08-28）

- **可行性已验证**：用抓包 token 在服务器上直接 `curl` 重放成功，返回真实场地可订数据。
- API 域名：`https://shop.chuanshatiyuchang.cn`，前缀 `/gym/miniprogram`。
- **核心接口**：`GET /venue/listAreaLease?venueSportId=1&date=YYYY-MM-DD`，返回该日全部 14 片羽毛球场的逐时段状态。响应结构：`data.areas[]`（areaId、areaName 如"一号场(3F)"），每场 `items[]`（startTime、endTime、price、status、showStatus、uniqNo 如 `41_20260828_09:00_10:00`）。
- **可订判定**：`status == "NORMAL" && showStatus == "AVAILABLE"` 为可订；`PAYED`/`VERIFIED` 为已订/已核销；存在 `NORMAL + UNAVAILABLE`（当日已过期时段）。
- **鉴权**：请求头 `token-user: <32位hex>`（另需 `x-gym-client-id: 1`）。无签名/时间戳，无 token 返回 `401 请先登录`。
- **token 有效期未知**：HAR 中未抓到登录接口（抓包时已处于登录态）。需在实现中支持手动更新 token，并在 401 时推送告警提醒更新。appId: `wx2fdf924861911ddc`。
- token 属于敏感凭证，实现时放服务端配置（.env），不入库提交、不进 git。
- 同一日期重复轮询响应约 60KB，频率需克制（建议 1-5 分钟），避免对场馆服务器造成压力。

## Open Questions

- 无阻塞性问题。token 实际有效期待运行中观察（设计按"可手动更新 + 401 告警"处理）。

## 下一步

进入设计阶段：编写 design.md（轮询调度、状态快照对比、推送去重、管理界面设计）和 implement.md，然后 `task.py start`。
