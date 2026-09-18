# Implement — PWA 一键跳转场馆小程序入口

> 纯前端。改动面：`client/src/constants/`、`client/src/composables/`、`client/src/components/venue/`（新建 3 个文件），`DaySheet.vue`、`VenueWatchSettingsSheet.vue`（接入）。

## Step 0 — 前置（已完成）

- [x] iPhone 真机测试明文 scheme（2026-09-18）：**6 个变体全部失败**，微信回「对不起，当前页面无法访问」→ 场馆未声明（PRD O1 已解决）。
  - 影响：实现路径不变，但“兜底分支”变成本次交付的主体；直跳分支保留为期权（等场馆开开关或拿到 `wxaurl.cn` 链接）。
  - 临时测试页仍在 `server/uploads/mp-jump-test.html`（供场馆声明后复测用，确认可删）。

## Step 1 — 常量与跳转逻辑

- [ ] 新建 `client/src/constants/miniProgram.js`：`GYM_MINI_PROGRAM`（appId / name / homePath）+ `miniProgramScheme()`（拼 `weixin://dl/business/?appid=..&path=..&env_version=release`）。ESM、无分号、单引号，注释写清"需场馆声明明文 scheme"的前提与文档来源。
- [ ] 新建 `client/src/composables/useMiniProgramJump.js`：per-call state，导出 `{ fallbackVisible, openMiniProgram, copyName }`；实现 design §1.3 的 armed + visibilitychange + 2.5s 定时器启发式；`navigator.clipboard.writeText` 失败走 `useToast.show(..., 'error')`；组件卸载清理定时器与监听。
- [ ] 验证：`cd client && npm run build`。

## Step 2 — 入口组件

- [ ] 新建 `client/src/components/venue/MiniProgramEntry.vue`：`<script setup>` + JSDoc props 头注释；props `label` / `variant` / `size` / `block` / `hint`；用 `Button` 原语（禁裸 `<button>`）；兜底提示块用设计令牌配色（对齐 `DaySheet.vue` 需验证块风格）。
- [ ] 验证：`cd client && npm run build`。

## Step 3 — DaySheet 三处接入

- [ ] 需验证块（`:366-369`）内加入口（`label="打开小程序过验证"`）。
- [ ] 监控区新增待支付块：`props.show && monitors.length` 时 `store.fetchLocksByDate(props.date)`（复用既有 action，失败静默）；计算 `pendingLock`（`status === 'locked'` 且 `expireAt > now`，取最早）；块内含截止时间与入口（`label="去小程序支付"`）。
- [ ] `now` 用 60s 间隔 ref 刷新，`expireAt` 过后块自动消失；面板关闭/换天重置（沿用现有 `watch([show, date])` 重置块）。
- [ ] 历史记录锁场行（`:435-441`）行内加入口（`label="去支付"`，`status === 'locked'` 且未过期时显示）。
- [ ] 验证：`cd client && npm run build`；浅色 + 深色各目视一次（`npm run dev`）。
- [ ] 风险点：`DaySheet.vue` 已较长，注意不要改动既有历史记录/表单逻辑；新增请求不得与 `toggleHistory` 的请求互相覆盖状态（两处状态分开存）。

## Step 4 — 设置 sheet 常驻入口

- [ ] `VenueWatchSettingsSheet.vue`：在「锁场优先级」之后加一行「打开场馆小程序」+ `<MiniProgramEntry block />`。
- [ ] 验证：`cd client && npm run build`。

## Step 5 — 收尾验证（AC6 / AC7）

- [ ] `cd client && npm run build` 通过。
- [ ] `npx playwright test` 现有用例无回归（需应用跑在 localhost:8089；无回归要求全绿）。
- [ ] 真机手测（用户）：iPhone Safari + 主屏独立模式下各点一次入口；确认兜底提示与复制按钮行为，并把 O1 结论回填 PRD。
- [ ] 无 `console.log` 残留；无 TypeScript 语法；无裸 `<button>`/`<input>`。

## Rollback points

- 纯前端、无数据迁移：任一步出问题 `git checkout -- <file>` 即可退回；Step 3 之前的所有改动（Step 1-2）是纯新增文件，删掉即完全回滚。
- 不触碰 `server/`、数据库、API 契约 → 无需服务端回滚，也无需调整 PWA 缓存策略。

## 实施后需要回填的东西

- PRD O1 结论（scheme 是否生效）与 AC7 真机结果。
- 若 O1 失败：把「小程序码图片兜底」作为后续小改动登记（不在本任务范围）。
