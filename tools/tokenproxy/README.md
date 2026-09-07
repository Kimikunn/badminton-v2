# Token 捕获代理（换 token 专用）

小程序的 `token-user` 是短期凭证（约 5-6 天过期），过期后监控会推送"token 已失效"。
本代理让换 token 只剩一步：**在小程序里重新登录一次**。

## 原理

手机流量经过本代理（mitmproxy，端口 8899）时，凡发往
`shop.chuanshatiyuchang.cn` 且带 `token-user` 请求头的请求，插件自动把 token
写入 `server/runtime/gym-token`。App 每轮请求实时读这个文件
（`intentService.readTokenUser`），免重启生效。

## 手机端一次性配置（iPhone）

**服务器是云服务器（公网可达）时**，代理也走公网：Wi-Fi 代理填服务器的
**公网 IP / 域名**（端口 8899，有 Basic 认证保护）。注意 iOS 代理只对
Wi-Fi 生效，蜂窝网络用不了——出门在外请用下面的快捷指令方案。

1. Wi-Fi → 当前网络 → 配置代理 → 手动：
   - 服务器：`<本机局域网 IP>`，端口 `8899`
   - 认证打开：用户名 `tokenproxy`，密码见 `docker-compose.tokenproxy.yml`
3. 浏览器访问 `mitm.it` → 下载 iOS 证书 → 设置里安装描述文件 →
   「设置 → 通用 → 关于本机 → 证书信任设置」开启 mitmproxy 证书

## 备选：Stream + 快捷指令（蜂窝网络也能用，服务器在公网时推荐）

`POST /api/intents/token` 是受专用密钥保护的 token 更新接口（独立于
ADMIN_TOKEN，密钥在服务器 `server/runtime/token-update-key`，首次访问时生成）：

```
POST http://<服务器地址>:8088/api/intents/token
Header: x-token-key: <密钥>
Body (JSON): { "token": "<Stream 里复制的 token-user>" }
```

iPhone 快捷指令做法：新建快捷指令 →「获取 URL 内容」→ 方法 POST、
头部加 x-token-key、请求体 JSON 的 token 字段取「剪贴板」。
之后每次失效：Stream 复制 token → 跑一下快捷指令 → 完成。

## 每次换 token

1. 确认 Wi-Fi 代理还开着
2. 打开微信小程序（川沙体育场），token 已失效会跳登录页 → 勾选协议 → 登录
3. 完事。token 已自动入库，监控下一轮自动恢复（推送会停）

用完可以把 Wi-Fi 代理关掉（不关也行，只是流量都经过服务器）。

## 运维

```bash
docker compose -f docker-compose.tokenproxy.yml up -d   # 启动
docker logs badminton-tokenproxy                        # 看捕获日志
```

CA 证书持久化在 `tools/tokenproxy/mitmproxy-config/`（不入库），删除后手机需重装证书。
