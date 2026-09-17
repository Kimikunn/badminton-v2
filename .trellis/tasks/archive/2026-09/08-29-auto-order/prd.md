# PRD: 自动下单可行性验证

## Goal

验证能否通过抓包接口重放实现川沙体育中心小程序的自动下单（含支付环节），为"监控到可订→自动锁场/下单"功能探路。

## 接口链（HAR 取证）

`createOrderCheck → createOrder → prePay → pay → getPayResult`（退款：`refundOrderCheck → refund/:id`）

## 已验证事实

- token 抓包次日仍有效（>19h 未过期，生命周期乐观）。
- `createOrderCheck` 无签名，重放成功（body 只需 venueSportId + areaItems 核心字段）。
- **`createOrder` 是全链路唯一带签名的接口**：`X-Ca-Timestamp` / `X-Ca-Nonce` / `X-Ca-Signature`（阿里云 API 网关风格，签名值 256 字节 → RSA-2048 私钥签名，密钥内嵌小程序包）。无签名重放返回 `403 签名错误`。
- `prePay`/`pay`/`refund`/全部 GET 均**无签名**。
- `pay` 用 `paymentChannel: WX_PAY` 时返回 `miniPayRequest`（prepay_id + paySign）——必须在微信客户端内调起支付，服务端无法完成。
- 订单有 `availableBalance` 字段——疑似支持**余额支付**（若存在 `paymentChannel` 的余额选项，充值后可脱离微信客户端全自动支付，未验证）。
- 未支付订单约 5 分钟自动过期释放（expireTime）。

## 结论

- 自动下单的唯一硬门槛 = createOrder 的 RSA 签名。
- 破解路径：Android 模拟器（已 root）装微信打开小程序 → 提取 wxapkg → 反编译找签名算法与密钥 → Node 复现签名。
- 支付环节两条路：A) WX_PAY 只能"自动锁场 + 推送用户手动支付"（锁场 5 分钟，抢场价值已很大）；B) 余额支付若存在则可全自动（需先能 createOrder 后实测）。

## 进展更新（2026-08-29，签名已破解并落地）

用户通过 PC 微信路线提取并解包了小程序包。已确认事实：

- **签名算法**（`pages/venueReservation/chunk_0.appservice.js`）：`stringToSign = timestamp\nnonce\nade2223c47623d82ecbc413fa5cc6dc1\n`（秒级时间戳、6~8 位 [a-z0-9] nonce、内嵌 APP_SECRET、末尾带 `\n`，**body 不参与签名**），RSA-2048 SHA256withRSA（PKCS#1 v1.5），hex→base64。
- **私钥**（`config/signKey.js`，PKCS#8 PEM）：已写入 `server/.env` 的 `GYM_SIGN_PRIVATE_KEY`。
- **接口**（`services/api.js`）：`POST /gym/miniprogram/areaOrder/createOrderCheck`（无签名）、`/areaOrder/createOrder`（签名头）。成功判定：createOrder `body.code===200`（429/403004=风控验证码）；createOrderCheck `body.data.success==='Y'`（'N' 时原因在 `data.code`，如 LIMITED_BY_START_TIME）。订单号取 `data.areaOrderId`。
- **areaItems**：直接透传 listAreaLease 返回的原始 item 对象。
- **实测验证**：假 uniqNo 调 createOrder 返回业务 400 而非 403 签名错误 → 签名被服务端接受；真实 slot 的 createOrderCheck 返回结构符合预期。
- 实现落点：`server/src/services/venueLockSigner.js` / `gymOrderClient.js` / `venueLockService.js`，poller 0→1 命中 autoLock 目标时自动锁场，测试 `server/test/venueLock.test.js`。

剩余未验证：真实可用 slot 的完整 createOrder 成功路径（需放票时实测，会下出真实订单）。

## Open Questions

- 用户是否有条件走 Android 模拟器提取小程序包？

## 结论与归档说明（2026-09-17）

可行性验证已完成并落地：签名算法反编译确认、`venueLockSigner.js` / `gymOrderClient.js` / `bookingLockService.js` 实现、poller 命中 autoLock 目标自动锁场、测试覆盖（见提交 `683ba82` 及其后的意图模型重构）。

**遗留一项**：真实放票时刻的端到端成功路径（真实 slot 的完整 `createOrder`）未实盘验证 —— 需放票窗口实测且会下出真实订单，不宜在无监督环境跑。相关运行时行为已有生产实测反馈支撑（风控验证、每日限订、锁到即停），本项作为已知未验风险归档，不另开任务；若后续实盘暴露签名/风控问题，按新问题开任务处理。

**已转移到文档**：签名算法与常量位置记入 `server/src/services/venueLockSigner.js` 头注释，域词条补入 `CONTEXT.md` 的「锁场」小节；风控后续处理见任务 `09-17-risk-retry-window`。
