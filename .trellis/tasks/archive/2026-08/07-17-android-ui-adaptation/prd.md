# PRD: 安卓机型 PWA UI 适配

## Goal

让 PWA 在主流安卓机型上 UI 正确适配：屏幕尺寸、按钮、导航不被系统区域（手势导航条、状态栏、挖孔）遮挡。当前 iPhone 体验良好，安卓存在遮挡问题。

## Confirmed Facts（代码证据）

当前实现 **完全依赖 `env(safe-area-inset-*)`**，iOS 上可靠，安卓浏览器/WebView 上返回值不一致（常返回 0）：

- `client/index.html:5` — `viewport-fit=cover` 已设置（safe-area 生效前提）
- `client/src/styles/tokens.css:143-144` — `--safe-top` / `--safe-bottom` 变量定义
- `client/src/App.vue:182` — 顶部 header `padding-top: env(safe-area-inset-top)`
- `client/src/App.vue:226` + `styles/global.css:188-190` — 底部浮动 TabBar（56px 胶囊 + 8px margin），容器 `.safe-bottom` = `padding-bottom: var(--safe-bottom)`
- `client/src/App.vue:217` — 主内容 `pb-[calc(80px+var(--safe-bottom))]`（有 TabBar 时）
- `client/src/components/ui/Sheet.vue:51` — 底部 Sheet 内容区 `pb-[calc(var(--space-5) + var(--safe-bottom))]`
- `client/src/views/ScoringView.vue:397` — 记分页 overlay 底部对齐，未见 safe-area 处理（待复核）
- 设计/测试基线仅 390×844（`playwright.config.js`），无安卓尺寸覆盖
- 全站使用 `backdrop-filter` 毛玻璃（liquid glass 风格）——Chrome 安卓 76+ 支持，低性能机可能掉帧（风险项）

**核心机制问题**：所有底部交互元素共用同一机制 `--safe-bottom`；若安卓 standalone 模式返回 `safe-area-inset-bottom: 0`，TabBar 距屏幕底仅 8px，手势条/虚拟键遮挡风险最高；Sheet 底部按钮同理。

**底部交互元素清单（全部依赖 `--safe-bottom`，修复时逐一核验）**：
1. `App.vue` 浮动 TabBar（所有 tab 页导航）
2. `components/ui/Sheet.vue` —— 所有底部 Sheet（场地/订场表单、管理工具、确认框、令牌输入等）
3. `views/ScoringView.vue` 编辑比分 overlay sheet（自定义实现，已有 safe-bottom padding）
4. `App.vue` 挂起 Sheet + 安装引导 Sheet

## Requirements（已确认）

- R0: 移除"添加到主屏幕"安装引导弹层（用户实测反馈：弹出后无法关闭，要求直接去掉）。代码位置：`client/src/App.vue:268-311` 安装引导 Sheet + `usePWAInstall.js` 相关逻辑。根因待查：Sheet 有"暂不需要"关闭按钮，疑似 `--safe-bottom` 在安卓 Chrome 返回 0 导致按钮被手势条覆盖而点不到
- R1: 底部导航 TabBar 在所有目标安卓环境不被手势条/虚拟键遮挡
- R2: 底部 Sheet 内按钮/内容不被遮挡
- R3: 小屏（360px 宽）布局不横向溢出、元素不挤压错位
- R4: 顶部 header 不被状态栏/挖孔遮挡（现有实现待验证）
- R5: 不破坏现有 iOS 体验（回归）

## Out of Scope（用户已明确）

- 图标/maskable、manifest、启动图 —— 本次不做
- 平板/桌面布局重做

## Target Environment（Q1 已确认）

- **主目标**：现代浏览器（Chrome / 系统默认 Chromium 内核浏览器）**安装到主屏幕的 standalone PWA**
- 微信内置浏览器（X5）不在适配矩阵 —— 微信里无法安装 PWA，非使用场景
- 已知风险：Android Chrome 在 standalone 模式下部分机型/版本 `env(safe-area-inset-bottom)` 返回 0（Chrome 历史 bug + OEM 差异），即使目标环境较好也需兜底

## Open Questions

- ~~Q2: 已实测观察到遮挡的具体页面~~ ✅ 已确认：实测问题是"添加到主屏幕"弹层无法关闭 → 见 R0
- ~~Q3: 最小支持屏宽与目标机型~~ ✅ 已确认：360px 起，主流机型
- ~~Q4: 验收方式~~ ✅ 已确认：Playwright 多视口自动化
- Q5: ~~safe-area 适配是否仍在范围内~~ ✅ 已确认：本任务 = R0 移除弹层 + R1-R5 全部适配

## Acceptance Criteria（已确认）

- 不再出现"添加到主屏幕"安装引导弹层；`usePWAInstall` 相关代码移除干净，无残留引用
- Playwright 新增安卓视口（360×640）项目并全绿
- 360×640 视口下所有页面无横向滚动条
- standalone 模式下底部交互元素（TabBar、Sheet 按钮）距屏幕底有足够安全间距（不依赖 `env()` 返回非 0）
- iOS 现有页面回归无变化（390×844 视口截图对比）
