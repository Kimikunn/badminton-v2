# Implement — 换 token 全自动（借道 8088 的本地捕获）

> 服务端：新增 `proxyRelay.js` + 3 条路由；客户端：新增 `TokenRefreshPanel.vue` + 1 处接入。**部署需要重建镜像**（代码在镜像内）。

## Step 1 — 转接模块（核心）

- [ ] 新建 `server/src/services/proxyRelay.js`：`attachProxyRelay(server, { upstreamHost, upstreamPort, allowHosts })`
  - `server.on('connect', handler)`；解析 CONNECT 目标，允许列表外 → `HTTP/1.1 403 Forbidden` + 断开
  - 允许 → `net.connect(upstream)`，转发 CONNECT 请求行与 headers，随后双向 `pipe`
  - 所有 socket 挂 error/timeout 清理；任何异常只记日志（pino），不得冒泡到进程
- [ ] `server/src/server.js`：`app.listen()` 之后调用 `attachProxyRelay(server, ...)`（env 读取，默认 upstream `172.17.0.1:8899`、allow `shop.chuanshatiyuchang.cn:443`）
- [ ] 验证：`cd server && npm test`（既有用例不受影响）。

## Step 2 — 路由：PAC / 状态 / 证书

- [ ] `intentController`：
  - `getTokenProxyPac` → 文本 PAC（`req.hostname` + `TOKEN_PROXY_PUBLIC_PORT` 默认 8088）
  - `getTokenStatus` → `{ configured, source, updatedAt }`（`fs.stat` 取 mtime；不返回 token 片段）
  - `getTokenProxyCa` → 读 CA PEM（`TOKEN_PROXY_CA_FILE` → `runtime/tokenproxy-ca.pem` → 仓库路径），缺失 503
- [ ] `intentRoutes.js`：`GET /token/proxy.pac`、`GET /token/status`、`GET /token/ca.crt`（均公开读，Content-Type 分别为 `application/x-ns-proxy-autoconfig`、`application/json`、`application/x-x509-ca-cert`）
- [ ] 验证：`cd server && npm test`。

## Step 3 — 服务端测试

- [ ] 新建 `server/test/proxyRelay.test.js`（node:test + 原始 socket）：
  - 起一个假 upstream（`net.createServer`）记录收到的首行；用 `app.listen(0)` + `net.connect` 发 `CONNECT shop.chuanshatiyuchang.cn:443` → 断言 upstream 收到该 CONNECT 且双向透传
  - 发非允许域名 CONNECT → 收到 403 且 upstream **未**被连接
  - 关闭 server 后无悬挂定时器/句柄
- [ ] 新建 `server/test/tokenProxyApi.test.js`：
  - `/token/proxy.pac` 正文含场馆域名分支与 `DIRECT` 兜底、Content-Type 正确
  - `/token/status` 未配置 → `{configured:false}`；写入 runtime `gym-token` 后 `configured:true` 且 `updatedAt` 为 ISO；**正文不含 token 片段**（断言）
  - `/token/ca.crt` 有 CA 时 200 + 正确 Content-Type；`GYM_RUNTIME_DIR` 指向空目录且仓库路径不可用 → 503（可用 env 覆盖 CA 路径模拟）
- [ ] 验证：`cd server && npm test` 全绿。

## Step 4 — 客户端「换 token」面板

- [ ] 新建 `client/src/components/venue/TokenRefreshPanel.vue`：状态行（读 `/intents/token/status`）、步骤①（安装证书链接 + PAC 地址一键复制 + 证书信任提示）、步骤②（小程序点登录）、「开始等待捕获」轮询（3s × 40）→ ✓ 与耗时、超时排查提示、快捷指令兜底说明
- [ ] `VenueWatchSettingsSheet.vue`：「监控状态」下加「小程序凭证」行 + 展开面板
- [ ] 验证：`cd client && npm run build`。

## Step 5 — 真机验证（用户配合）

- [ ] 生成临时 PAC（指向 8088）供测试：`server/uploads/tk-<随机>-v3.pac`
- [ ] 用户：装/确认信任 CA → Wi-Fi 代理设为「自动」+ 填 v3 PAC → 打开小程序点一次「一键登录」
- [ ] 我：`docker logs badminton-tokenproxy` 看到场馆域名连接 + 捕获日志 = AC1 成立
- [ ] 失败排查顺序：① 手机能否访问 `http://38.55.194.167:8088/`（应正常）② 代理是否被 iOS 缓存（换 PAC 文件名）③ 证书信任是否打开

## Step 6 — 部署与收尾

- [ ] `docker compose build && docker compose up -d`（重建镜像；期间 PWA 短暂不可用）→ 复现 AC1
- [ ] 撤掉探测阶段多余端口：`docker-compose.tokenproxy.yml` 只保留 8899（与 8443 视验证结果）
- [ ] `tools/tokenproxy/README.md`：更新为「手机一键换 token（PAC + 借道 8088）」新流程，保留手动/快捷指令通道说明
- [ ] `cd server && npm test` / `cd client && npm run build` / `npx playwright test` 全绿
- [ ] 删除临时 PAC/探测页文件；回填 PRD 的 AC

## Rollback points

- 全部为新增文件 + `server.js`/`settings sheet` 少量接入：`git checkout -- <file>` 或删除新增文件即回滚。
- `docker-compose.tokenproxy.yml` 的端口改动可随时还原；`runtime/` 下为运行时数据，删除无影响。
