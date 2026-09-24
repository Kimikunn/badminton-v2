# 换 token 全自动：借道 8088 的本地捕获

> 父任务：`09-18-token-failure-control` ｜ 2026-09-18 第五次修订：云代理路线保留，但**代理入口借道已知可达的 8088 端口**（手机网络阻断非常规端口）

## Goal

让换 token **除"在小程序里点一次「一键登录」"之外全自动**：

```
手机（Wi-Fi 自动代理 PAC：只把场馆域名指过来）
   → 38.55.194.167:8088（App 端口，已验证手机可达）
   → App 内的 CONNECT 转接（只放行场馆域名）
   → 同机 mitmproxy:8899（CA 现成）
   → 读到 token-user → 写 runtime/gym-token（热更新）
   → 监控/锁场自动恢复，无需重启
```

## Background：已核实事实

- **手机网络阻断非常规端口**（2026-09-18 实测）：8899 = `ERR_CONNECTION_CLOSED`；8443 / 2083 = 超时；机房控制台开放端口后依旧不通 → **线路层限制**。唯一确认可达的端口是 **8088**（PWA 就在上面）。
- **App 容器可达宿主 8899**（实测 `172.17.0.1:8899` ✅）→ 转接可行。
- mitmproxy 容器 `badminton-tokenproxy` 已在运行：无 Basic 认证 + **只放行场馆域名**（非场馆 CONNECT 直接 403，实测通过）；CA 在 `tools/tokenproxy/mitmproxy-config/`。
- token 只能从客户端产生（`wx.login` code），**因此"在小程序里点一次登录"无法消除**；本任务消除的是登录之后的全部手动环节（翻请求 / 复制 / 快捷指令）。
- 无 token 时全部场馆接口返回 `code:401 请先登录`（实测）；TTL ≈6-7 天。

**已排除的路线（登记备查）**：代理 App 脚本（需付费 App）、云手机（风控/信任/成本）、Mac 本地代理（需电脑常开）、纯手动粘贴（仍需人工翻找）。

## Requirements

- **R1** 手机侧无需安装任何 App：只需（一次性）信任 mitmproxy 根证书 + 将 Wi-Fi 代理设为"自动"并指向我们提供的 PAC。
- **R2** PAC 只把场馆域名指向我们，其余流量直连；**App 的 8088 只接受该场馆域名的 CONNECT**，不成为通用代理。
- **R3** 捕获后 token 热更新（`setRuntimeToken`），引擎下一轮自动恢复，无需重启。
- **R4** PWA 提供「换 token」页（在「辅助订场设置」sheet 内就地展开）：显示凭证状态与最近捕获时间；两步引导（装证书 / 配 PAC）；「开始等待捕获」轮询并在捕获成功时显示 ✓ 与耗时。
- **R5** 既有通道不回归：`POST /api/intents/token`（快捷指令）与 mitmproxy 直连通道保持可用。

## Acceptance Criteria

- [ ] **AC1**（真机）配好 PAC + 信任证书后，打开小程序做任意请求 → 服务端 `docker logs badminton-tokenproxy` 出现该请求记录，`runtime/gym-token` 更新（若 token 变化）。
- [ ] **AC2** 手机其他 App / 网页**完全不受影响**（只有场馆域名经过我们）。
- [ ] **AC3** 非场馆域名的 CONNECT 打到 8088 → 被拒绝（403），不产生转发（测试断言）。
- [ ] **AC4** PWA「换 token」页：显示最近捕获时间；点「开始等待捕获」后在小程序点一次登录 → 60 秒内出现 ✓。
- [ ] **AC5** `cd server && npm test` 全绿（含转接与 PAC 用例）；`cd client && npm run build` 通过；`npx playwright test` 无回归。
- [ ] **AC6** 部署记录：`docker compose build && docker compose up -d` 后 AC1 复现成功。

## 已知限制（用户已知悉）

- **仅 Wi-Fi 生效**（iOS 代理不支持蜂窝）→ 换 token 时需连上配置过的那张 Wi-Fi。
- 需一次性信任 mitmproxy 根证书（任何 MITM 方案都绕不开这一步）。
- 只有场馆域名的明文会被我们经手（这正是捕获目的）；其余流量直连、不解密。

## Out of Scope

- token 服务端续期（微信设计上不可行）。
- 官方 URL Link 一键跳转（2026-09-18 已验证可行，作为独立小改动留待后续，不混进本任务）。
- 8:30 放票前体检（子任务 `09-18-token-precheck`）。
