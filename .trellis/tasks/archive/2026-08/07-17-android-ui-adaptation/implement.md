# Implement Plan: 安卓机型 PWA UI 适配

对应: `./prd.md` / `./design.md`

## 前置

- [ ] `task.py start` 后 status = in_progress 才动工

## Step 1: R0 移除安装引导

- [ ] 删 `client/src/App.vue` template 中安装引导 Sheet 块（约 268-311 行，含两层 transition + Teleport）
- [ ] 删 `App.vue` script 中：`usePWAInstall` import（:10）、解构（:29）、`showInstallGuide` ref（:33）、onMounted 定时器（:36-44）、`handleDismissInstall`（:46-49）
- [ ] 删 `client/src/composables/usePWAInstall.js` 文件
- [ ] 验证: `grep -rn "usePWAInstall\|showInstallGuide\|添加到主屏幕" client/src` 无结果；`cd client && npm run build` 通过

## Step 2: safe-area 兜底

- [ ] `client/src/styles/tokens.css:144` 改为 `max(env(safe-area-inset-bottom, 0px), var(--safe-bottom-min, 0px))`，并加 `@media (display-mode: standalone) { :root { --safe-bottom-min: 16px } }`
- [ ] `--safe-top` 不动
- [ ] 核查底部消费者无硬编码 padding：`App.vue` TabBar/主内容、`components/ui/Sheet.vue:51`、`views/ScoringView.vue` `.sheet`（均引用 var，改动一处即生效）
- [ ] 验证: `cd client && npm run build` 通过

## Step 3: Playwright 多视口

- [ ] `playwright.config.js` 新增 `android-light` / `android-dark` 两个 project，viewport 360×640，其余沿用 light/dark 配置

## Step 4: e2e 断言（`e2e/smoke.spec.js`）

- [ ] 每个页面加载后断言无横向滚动（`scrollWidth <= innerWidth`）
- [ ] 断言页面无"添加到主屏幕"文案（等 6s 覆盖原 5s 弹出时机）
- [ ] 断言 `--safe-bottom-min` 覆盖后 TabBar 容器 padding-bottom 生效（机制管道测试）

## Step 5: 全量验证

- [ ] 按 `spec/frontend/quality-guidelines.md` 流程起测试环境
- [ ] `npx playwright test` 全绿（4 个 project × 全部 spec）
- [ ] 人工查看 `e2e/screenshots/` 安卓视口截图：TabBar、Sheet 底部间距合理；390×844 截图与改动前对比无回归（R5）

## Review Gates

- Step 1 后: build 绿 + grep 无残留
- Step 4 后: 单跑 smoke spec 绿
- Step 5 后: 全量 e2e 绿 + 截图人工确认 → 进入 check（`trellis-check`）

## Rollback Points

- 任何一步出问题：git 工作区未提交，直接 `git checkout -- <file>` 回退单文件
- 整体回滚：revert 本任务 commit
