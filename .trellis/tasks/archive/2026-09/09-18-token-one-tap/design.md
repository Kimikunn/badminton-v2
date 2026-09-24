# Design — 换 token 全自动（借道 8088 的本地捕获）

> 服务端新增 1 个转接模块 + 3 条路由；客户端新增 1 个面板组件 + 1 处接入。需重新构建镜像部署（代码在镜像里）。

---

## 1. 链路与边界

```
手机 PAC:  shop.chuanshatiyuchang.cn → PROXY 38.55.194.167:8088 ; 其余 DIRECT
   │  CONNECT shop.chuanshatiyuchang.cn:443
   ▼
App(8088)  connect 钩子：域名在允许列表 → 连 upstream(172.17.0.1:8899) 并双向 pipe
   │                                 不在允许列表 → 403 并断开
   ▼
mitmproxy(8899)：用自己的 CA 做 MITM（手机信任该 CA）→ 读 token-user → 写 runtime/gym-token
   ▼
watchEngine 下一轮读新 token → 监控/锁场自动恢复（无需重启）
```

**为什么借道 8088**：手机网络阻断非常规端口（8899/8443/2083 全部不通，机房开端口也无效），8088 是唯一确认可达的端口；App 的 `http.Server` 原生支持 `connect` 事件，可在同一端口上并存。

## 2. 服务端

### 2.1 转接模块 `server/src/services/proxyRelay.js`

```js
attachProxyRelay(server, { upstreamHost, upstreamPort, allowHosts })
```

- 挂在 `server.js` 的 `app.listen()` 返回实例上（`server.on('connect', handler)`）——只处理 CONNECT，不影响既有 HTTP/静态资源/API。
- 行为：解析 `req.url`（`host:port`）→ 在 `allowHosts` 内则 `net.connect(upstream)`，把原始 CONNECT 请求行与 headers 转给 upstream，然后 `clientSocket.pipe(upstream)` + `upstream.pipe(clientSocket)`；不在列表内 → 回 `HTTP/1.1 403 Forbidden` 并断开。
- 容错：socket error/timeout 双向销毁；不抛未捕获异常（不能因代理流量崩掉生产 App）。
- 环境变量：`TOKEN_PROXY_UPSTREAM`（默认 `172.17.0.1:8899`）、`TOKEN_PROXY_ALLOW_HOSTS`（默认 `shop.chuanshatiyuchang.cn:443`）。

### 2.2 路由（挂 `intentRoutes`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/intents/token/proxy.pac` | 公开读 | 生成 PAC（`application/x-ns-proxy-autoconfig`）：场馆域名 → `PROXY <req.hostname>:<TOKEN_PROXY_PUBLIC_PORT|8088>`，其余 `DIRECT` |
| GET | `/api/intents/token/status` | 公开读 | `{ configured, source: 'file'\|'env'\|'none', updatedAt }`，**不含 token 片段** |
| GET | `/api/intents/token/ca.crt` | 公开读 | 下载 mitmproxy 根证书（`application/x-x509-ca-cert`），供手机"设置→通用→VPN与设备管理"安装；CA 路径 `TOKEN_PROXY_CA_FILE` → `runtime/tokenproxy-ca.pem` → 仓库 `tools/tokenproxy/mitmproxy-config/mitmproxy-ca-cert.pem`，缺失 → 503 |

> 用 `req.hostname` 生成 PAC 里的地址：手机访问 PWA 用的地址就是它，避免再配置一遍。

## 3. 客户端

### 3.1 「换 token」面板（`client/src/components/venue/TokenRefreshPanel.vue`）

在 `VenueWatchSettingsSheet.vue` 内就地展开（Sheet 叠 Sheet 会互相遮挡）：

```
辅助订场设置
─────────────────────────────
监控状态              ● 已就绪
小程序凭证            最近捕获 3 天前   [ 换 token ]
   └─ 展开 ─────────────────────────────
      ① 一次性准备（两个按钮）
         [ 1. 安装证书 ]   [ 2. 查看 PAC 地址 ]
         · 装完到 设置 → 通用 → 关于本机 → 证书信任设置 打开 mitmproxy
         · Wi-Fi → ⓘ → 配置代理 → 自动 → 粘贴 PAC 地址
      ② 打开微信小程序，点「一键登录」
      [ 开始等待捕获 ]    已等待 12s…
      ✓ 已捕获新 token（用时 18 秒）  ← 依据 /token/status 的 updatedAt 变化
      ─ 兜底：快捷指令通道（README）
```

- 「查看 PAC 地址」= 展示 `http://<当前地址>/api/intents/token/proxy.pac` 并提供一键复制（`navigator.clipboard`，失败 toast）。
- 轮询 3s × 40 次；基线为打开面板时的 `updatedAt`；超时给排查提示（是否连了那张 Wi-Fi / 证书信任是否打开）。
- 组件卸载清理定时器。

## 4. 兼容、风险与回滚

- **PAC 缓存**：iOS 会缓存 PAC，换地址时用新 URL（新文件名/查询串）。
- **代理链路不可用时**：手机侧只会影响场馆域名（其余 DIRECT），小程序会报网络错误——PWA 面板要给出"关掉 Wi-Fi 代理"的退路说明。
- **安全**：8088 只放行场馆域名的 CONNECT，mitmproxy 侧再放行一次（双保险）；公开路由不返回 token 片段。
- **部署**：`docker compose build && docker compose up -d`（代码在镜像内，需重建；期间 PWA 短暂不可用）。
- **回滚**：新增文件与少量接入；`git checkout -- <file>` 即回滚；不涉及数据库与数据迁移。
