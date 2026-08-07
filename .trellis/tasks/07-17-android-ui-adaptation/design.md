# Design: 安卓机型 PWA UI 适配

对应 PRD: `./prd.md`（R0-R5 已确认）

## 总体思路

两块相互独立的工作：

1. **R0 移除安装引导** — 纯删除，无新机制
2. **R1-R4 safe-area 兜底** — 给 `--safe-bottom` 加一个 standalone 模式下的最小值下限，集中改在 `tokens.css` 一处，所有消费者（TabBar、Sheet、ScoringView overlay、主内容 padding）自动受益

## R0: 移除安装引导

### 现状

- `client/src/App.vue:268-311` — 安装引导 Sheet（Teleport 到 body，z-200）
- `client/src/App.vue:10,29,33,36-49` — import、状态、5 秒定时弹出、`handleDismissInstall`
- `client/src/composables/usePWAInstall.js` — 唯一消费者就是 App.vue（已 grep 确认）

### 方案

- 删除 App.vue 中全部安装引导代码（template 块 + script 逻辑 + import）
- 删除 `client/src/composables/usePWAInstall.js` 整个文件
- `localStorage` 里的 `pwa-install-dismissed` 残留 key 无害，不做清理逻辑
- `useSWUpdate.js`（SW 更新提示）是独立功能，保留不动

### 边界

- e2e 未引用安装引导（已 grep 确认），无需改测试
- manifest / SW 注册不在本次范围

## R1-R4: safe-area 兜底机制

### 问题根因

`tokens.css:143-144` 定义：

```css
--safe-top: env(safe-area-inset-top, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
```

Android Chrome standalone 模式部分机型/版本 `env(safe-area-inset-bottom)` 返回 0（Chrome 历史 bug + OEM 差异），导致 TabBar 距屏幕底仅 8px、Sheet 按钮被手势条覆盖 —— 用户实测的"弹层无法关闭"正是此根因的症状之一。

### 方案：CSS 最小值下限

`tokens.css` 改为：

```css
--safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-bottom-min, 0px));

@media (display-mode: standalone) {
  :root { --safe-bottom-min: 16px; }
}
```

行为：

- iOS standalone：`env()` 返回 ~34px，`max()` 不生效，体验不变（R5）
- Android standalone + env 正常：同 iOS
- Android standalone + env 返回 0：兜底 16px，TabBar/Sheet 不再贴底
- 浏览器（非 standalone）模式：不加下限（Chrome 浏览器自身 UI 会处理底部），行为不变

`--safe-top` 保持纯 `env()` 不动：Android standalone 的状态栏 inset 上报基本正常，加下限反而会无中生有多出 padding。R4 通过截图测试验证，若发现问题再开后续任务。

### 消费者清单（全部走 `--safe-bottom`，机制改动一处生效）

| 位置 | 用途 |
| --- | --- |
| `App.vue` 浮动 TabBar 容器 `.safe-bottom` | 底部导航 |
| `App.vue` 主内容 `pb-[calc(80px+var(--safe-bottom))]` | 内容不被 TabBar 遮 |
| `components/ui/Sheet.vue:51` | 所有底部 Sheet |
| `views/ScoringView.vue` `.sheet` padding | 编辑比分 overlay（自定义实现，同样引用 var） |

### 取舍

- **选 CSS `max()` + media query，不选 JS 探测**：无运行时代码、无闪烁；`display-mode: standalone` media query Chrome Android 支持良好
- **下限 16px**：手势条区域典型高度 16-24px，16px + TabBar 自身 8px margin 足够；取保守值避免过度留白
- **不覆盖浏览器模式**：PRD 目标环境是 standalone PWA；浏览器模式加下限会给所有安卓浏览器用户加无谓 padding
- **已知残留风险**：三键导航机型 standalone 下也会多出 16px 底部留白（env 返回 0 但无遮挡）——可接受的视觉代价

## R3 + 验收：Playwright 多视口

`playwright.config.js` 现状只有 390×844（light/dark）。新增：

- `android-light` / `android-dark`：viewport 360×640

现有 spec（smoke / screenshots / contrast）自动在所有 project 上跑，覆盖新视口。

新增断言（放 `e2e/smoke.spec.js`）：

1. **无横向滚动**：`document.documentElement.scrollWidth <= window.innerWidth`（R3）
2. **安装引导不存在**：页面加载 6 秒后不存在"添加到主屏幕"文案（R0 回归）
3. **safe-bottom 管道通畅**：手动 `documentElement.style.setProperty('--safe-bottom-min', '16px')` 后，TabBar 容器 computed `padding-bottom` 变为 16px —— 证明所有底部元素走 var 而非硬编码（机制回归；Playwright 无法模拟 standalone display-mode，故用覆盖方式验证管道）

## Rollout / Rollback

- 纯前端改动 + e2e 配置，无数据迁移
- 回滚 = revert commit
- 验证流程按 `spec/frontend/quality-guidelines.md`：`build:test` → 部署 → `npx playwright test`
