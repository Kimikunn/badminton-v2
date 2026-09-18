# PWA 一键跳转场馆小程序入口

## Goal

在 PWA 内提供「打开场馆小程序」的入口，让「必须在小程序里完成」的三个动作（过图形验证、支付未付订单、换 token）不再靠用户自己去微信里找小程序；入口出现在需要它的场景里，而不是藏在设置深处。

## Background：已核实事实

**token 来源与不可自动化边界（解包确认）**

- 小程序点「一键登录」→ `wx.login()` 拿 code → `POST /gym/miniprogram/user/login {code, clientId}` → 返回 `{token, mobile}`；该 token 即请求头 `token-user`（16 字符）。
- code 只能在微信客户端 + 该小程序内产生，换 token 需要场馆的 appsecret → **服务端无法自行续期**，无 refresh 接口（2026-09-07 会话已确认）。
- 2026-09-18 实测：`server/runtime/gym-token`（09-12 写入）当日仍返回 200 有效，实际换 token 频率约 7 天一次。

**外链拉起小程序的三种方式（2026-09-18 微信官方文档核实）**

| 方式 | 生成条件 | 本项目可用性 |
|---|---|---|
| 明文 URL Scheme `weixin://dl/business/?appid=..&path=..&env_version=release` | 小程序方在 MP 后台「设置 → 隐私与安全 → 明文Scheme拉起此小程序」**声明过**即可，无需凭证 | ❌ **实测不可用**（见下） |
| 加密 URL Scheme `weixin://dl/business/?t=<TICKET>` | 需该小程序 access_token（appid + **appsecret**） | ❌ 无 secret |
| URL Link `wxaurl.cn/<xxx>` | 同上需 access_token | ❌ 无 secret |

- 场馆小程序 appid `wx2fdf924861911ddc`，首页 path `pages/index/index`（来源：解包 `config/env.js`、`app.json`）。appid 只能定位小程序，不能生成加密链接。

**明文 URL Scheme 实测结论（2026-09-18，真机 iPhone）**

- 测试入口：`server/uploads/mp-jump-test.html`（临时页，未索引）。逐个测试 6 个变体：`pages/index/index`（JS 跳转 + 普通链接两种触发方式）、`pages/venueDetail/index`、`pages/venueReservation/index`、`pages/order/index`、`pages/my/index`、不带 `path` 只带 appid。
- 结果：**全部跳到微信并显示「对不起，当前页面无法访问」**，无一进入小程序。
- 判读：该 appid 的明文 scheme 未被声明（非 path 白名单问题，因为无 path 变体同样失败）。
- appid 交叉验证：解包包中 `wx2fdf924861911ddc` 仅出现于 `config/env.js`，name=川沙、`baseHttp=https://shop.chuanshatiyuchang.cn/gym`（与本项目 token 使用的主机一致）→ 排除 appid 写错。
- **结论：不依赖场馆配合的前提下，PWA → 小程序 的一键直跳不可行。** 唯一解冻条件：场馆在 MP 后台开启「明文Scheme拉起此小程序」，或我们拿到场馆对外发布过的 `wxaurl.cn` URL Link。

**PWA 内现状：三个「得去小程序」场景，当前都没有入口**

| 场景 | 位置 | 时间压力 | 文案来源 |
|---|---|---|---|
| 需验证（放票风控被拦） | `client/src/components/venue/DaySheet.vue:366-369` 提示块（可见） | 重试窗口 4 分钟（`watchEngine.js` `rcRetryConfig`） | `watchEngine.js:170-171` |
| 待支付（锁场成功） | `DaySheet.vue:435-441` 锁场记录行，**默认折叠**（`DaySheet.vue:243` `showHistory = ref(false)`） | 5 分钟（`bookingLockService.js:532`） | 同上 |
| 换 token（凭证过期） | 无界面，仅推送告警 | 7 天一次 | `watchEngine.js:268` |

- 已具备的可复用件：`client/src/stores/intent.js` `fetchLocksByDate(date)` → `GET /api/intents/locks?date=...`（响应行含 `expireAt`）。**因此本任务不需要改服务端接口。**
- 客户端目前没有任何自定义 scheme / 外链跳转先例；无剪贴板封装。

## Requirements

- **R1** PWA 内提供「打开场馆小程序」入口，点击后尝试跳转到小程序（统一跳首页 `pages/index/index`）。
  - 约束（2026-09-18 实测）：当前必然走到兜底分支；scheme 仍然保留在代码里，作为「场馆哪天开了开关就自动生效」的期权（零维护成本）。
- **R2** 入口位置（2026-09-18 确认）：
  - 上下文入口一：`DaySheet.vue` 需验证提示块内。
  - 上下文入口二（两处）：`DaySheet.vue` 监控区新增可见的「待支付」块（未支付且未过期时），以及折叠的历史记录锁场行内各一个。
  - 常驻入口：`VenueWatchSettingsSheet.vue`「辅助订场设置」sheet 内。
- **R3** 跳转失败 / 环境不支持时给智能兜底：点击后约 2.5 秒页面仍可见 → 就地展开提示（打开微信 → 最近使用里点「川沙体育场」）+ 一键复制小程序名。
- **R4** 纯前端改动：不改服务端接口、不改数据库、不改 API 契约（避免 PWA 缓存策略连带调整）。
- **R5** 待支付块使用设计令牌配色，浅色/深色两套主题都正常；未支付订单不存在时该块不出现，过期后自动消失。

## Acceptance Criteria

- [ ] **AC1** 需验证提示块出现入口；点击后尝试跳转（有微信时为小程序首页；无微信/未声明时不报错）。
- [ ] **AC2** 当天存在 `status = locked` 且 `expireAt` 未过期的锁场记录时：监控区下方出现「待支付 · 支付截止 HH:MM」块 + 入口；该条件下历史记录锁场行内也有入口；无此类记录时两处都不出现。
- [ ] **AC3** 锁场记录过期（`expireAt` 已过）后待支付块自动消失，无需手动刷新页面。
- [ ] **AC4** 「辅助订场设置」sheet 内有常驻入口。
- [ ] **AC5** 兜底：点击入口后约 2.5 秒页面仍可见 → 展开兜底提示；「复制小程序名」成功时出 toast；切走再回来（成功跳转）时兜底提示不残留。
- [ ] **AC6** `cd client && npm run build` 通过；`npx playwright test` 现有用例无回归（需应用跑在 localhost:8089）。
- [ ] **AC7** 真机手测（用户执行）：iPhone Safari + 主屏独立模式各点一次入口，记录 O1 结论（明文 scheme 是否生效）。

## Open Questions

- **O1（已解决）**：明文 URL Scheme 不可用 —— 见 Background「明文 URL Scheme 实测结论」，2026-09-18 真机实测 6 个变体全部失败。
- **O3（待用户决定，阻塞开工）**：O1 失败后本任务的方向：
  - A 入口降级为引导卡（保留三个接入点，按钮改为「打开微信 + 复制小程序名 + 我的小程序提示」）；
  - B 转向 token 搬运自动化（一键 `.mobileconfig` + PWA 换 token 向导页）；
  - C 转向 Mac 微信 + 本地 mitmproxy 自动上报；
  - D 暂停。

## 后续可能的解冻条件（不在本任务内）

1. 场馆在 MP 后台开启「明文Scheme拉起此小程序」（他们侧一个开关）→ 本方案的直跳分支自动生效。
2. 拿到场馆对外发布过的 `wxaurl.cn` URL Link（短信 / 公众号文章 / 海报）→ 可直接替换 scheme，同样一键直跳。

## Out of Scope（本次）

- 路线 A：一键 `.mobileconfig`（Wi-Fi 代理 + CA 证书）把抓包变一次配置。
- 路线 B：PWA 内 token 粘贴框。
- 路线 C：Mac 微信 + 本地 mitmproxy 自动上报。
- 换 token 的入口（本任务只做「打开小程序」入口本身）。
- 小程序码图片兜底（O1 失败时再议）。
- 加密 URL Scheme / URL Link（需要场馆 appsecret，无解）。
