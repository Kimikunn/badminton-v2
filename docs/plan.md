# PWA 改进计划

> 基于 `alinaqi/claude-bootstrap@pwa-development` Skill 诊断，对比当前项目实现。
> 更新时间：2026-06-01

---

## 当前状态总览

| 能力 | 状态 | 说明 |
|------|:----:|------|
| `vite-plugin-pwa` + Workbox | ✅ | 已配置，`registerType: 'autoUpdate'` |
| Manifest 基础字段 | ✅ | name / short_name / icons / display: standalone / orientation |
| Apple meta tags | ✅ | `apple-mobile-web-app-capable` / `apple-mobile-web-app-status-bar-style` |
| 安全区适配 | ✅ | `env(safe-area-inset-top/bottom)` / `viewport-fit=cover` |
| Precaching | ✅ | `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']` |
| Runtime caching (API) | ✅ | `/api/` → NetworkFirst, 1h 过期, 100 entries |
| Runtime caching (图片) | ✅ | 图片 → CacheFirst, 30d 过期, 50 entries |
| SPA fallback | ✅ | NavigationRoute → `index.html` |
| 旧缓存清理 | ✅ | `cleanupOutdatedCaches()` |
| 触控标准 | ✅ | 44px min / `tap-highlight` / `user-select: none` |
| Liquid Glass 视觉 | ✅ | 已实现 header + tabbar 玻璃效果 |
| 动态视口 | ✅ | `100dvh` + safe-area padding |

---

## P0 — 必须改进（用户体验直接受损）

### 1. 缺失离线降级页面

**现状**：无 `offline.html`。用户断网访问未缓存路由时，浏览器显示默认错误页（白屏或 Chrome 恐龙）。

**Skill 参照**：离线页面应包含重试按钮、视觉友好的提示。

**改进**：

- 在 `client/public/` 创建 `offline.html`
- 在 Workbox 中配置 offline fallback
- 在 `vite.config.js` 的 `workbox` 中添加：

```js
workbox: {
  // ...现有配置
  navigateFallback: '/offline.html',
  // 或者更精细的控制：
  // navigateFallbackDenylist: [/^\/api\//],
}
```

- 在 precache 中包含 `offline.html`（通过 `globPatterns` 或 `includeAssets`）

**工作量**：小（~30 分钟）

---

### 2. 无安装引导（beforeinstallprompt）

**现状**：完全依赖浏览器默认行为。iOS 用户需手动 "添加到主屏幕"，无任何引导。Chrome 的自动提示可能出现时机不佳。

**Skill 参照**：
- 监听 `beforeinstallprompt` 事件
- 在用户完成核心操作后提示安装
- 检测 standalone 模式后隐藏提示

**改进**：

1. 创建 `client/src/composables/usePWAInstall.js`：
   - 捕获 `beforeinstallprompt` 事件
   - 提供 `canInstall` / `install()` / `isStandalone()` 方法
   - 使用 localStorage 记录 "用户已拒绝安装"

2. 在 App.vue 或合适位置添加安装引导 UI：
   - iOS：图文说明 "Safari 分享 → 添加到主屏幕"
   - Android/Desktop：调用 `deferredPrompt.prompt()`

3. 触发时机：用户完成至少 1 场比赛记分后（而非首次打开）

**工作量**：中（~2 小时）

---

### 3. SW 更新无用户提示

**现状**：`registerType: 'autoUpdate'` 静默更新 SW。用户不知道有新版本，可能一直用旧缓存直至下次刷新。

**Skill 参照**：
- 监听 `controllerchange` 或使用 Workbox 的 update flow
- 显示 "新版本可用，点击刷新" 提示

**改进**：

1. 创建 `client/src/composables/useSWUpdate.js`：
   - 使用 `workbox-window` 监听新 SW waiting 状态
   - 提供 `updateAvailable` / `refreshApp()` 方法

2. 在 App.vue 添加 update banner（非阻塞 toast 或 snackbar）

**工作量**：小（~1 小时）

---

### 4. 无在线/离线状态指示

**现状**：无 `navigator.onLine` 监听。用户离线操作时不知道为何数据不刷新。

**Skill 参照**：
- 监听 `online` / `offline` 事件
- 显示连接状态变化

**改进**：

1. 创建 `client/src/composables/useOnlineStatus.js`：
   - 响应式 `isOnline` 状态
   - 监听 `online` / `offline` 事件
   - 可选：定期 ping 轻量 API 排除 "假在线"（已连 WiFi 但无互联网）

2. 在 App.vue 或全局 layout 添加离线指示器（顶部小横条）

**工作量**：小（~1 小时）

---

### 5. Manifest lang 不正确

**现状**：`"lang": "en"`，但应用为中文。

**改进**：

在 `vite.config.js` manifest 中添加 `"lang": "zh-CN"`（该字段已存在于生成的 manifest 中，可能来自 plugin 默认值，需要在配置中显式覆盖）。

**工作量**：微（1 行）

---

## P1 — 应该改进（体验增强）

### 6. Manifest 字段补全

**现状**：仅有基础字段。缺少：

| 字段 | 建议值 | 用途 |
|------|--------|------|
| `categories` | `["sports", "utilities"]` | App Store / 分类 |
| `screenshots` | 桌面 + 手机截图 | 安装 UI 更丰富 |
| `shortcuts` | 快速记分 / 积分榜 | 长按图标快捷入口 |
| `id` | `/` 或固定值 | PWA 身份标识 |
| `dir` | `"ltr"` | 文本方向 |

**Skill 参照**：Enhanced Manifest 应包含 screenshots、shortcuts、categories。

**改进**：

- 补全 manifest 字段（vite.config.js 中）
- shortcuts 示例：

```js
shortcuts: [
  {
    name: '快速记分',
    short_name: '记分',
    url: '/scoring',
    icons: [{ src: 'icon-192.png', sizes: '192x192' }]
  },
  {
    name: '积分榜',
    short_name: '积分',
    url: '/rankings',
    icons: [{ src: 'icon-192.png', sizes: '192x192' }]
  }
]
```

**工作量**：中（需截图，~2 小时）

---

### 7. 图标尺寸补全

**现状**：仅 192x192 和 512x512（后者兼做 maskable）。

**Skill 参照**：推荐 72/96/128/144/152/192/384/512 + 独立 maskable。

**改进**：

- 生成或复用以下尺寸图标：
  - 72x72（旧 Android / 低端设备）
  - 96x96
  - 128x128
  - 144x144
  - 152x152（iPad）
  - 384x384
- 单独提供 maskable 专用图标（比 any maskable 更佳）
- 可通过 `vite-plugin-pwa` 的 `includeManifestIcons: false` 后手动管理

**工作量**：小（图标已有，改配置 ~30 分钟）

---

### 8. API 缓存策略精细化

**现状**：所有 `/api/` 请求统一 `NetworkFirst`。GET 读操作适合缓存，但 POST/PUT/DELETE 不应该缓存，且过期时间 1h 对榜单类数据偏短。

**Skill 参照**：不同 URL 模式用不同策略。

**改进**：

```js
runtimeCaching: [
  // 榜单 / 赛季（变化慢）→ Stale While Revalidate, 5min
  {
    urlPattern: /\/api\/(rankings|seasons|players)/,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'api-rankings',
      expiration: { maxEntries: 30, maxAgeSeconds: 300 }
    }
  },
  // 比赛数据（变化较快）→ Network First, 30s
  {
    urlPattern: /\/api\/matches/,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'api-matches',
      expiration: { maxEntries: 50, maxAgeSeconds: 30 }
    }
  },
  // 通用 GET 兜底 → Network First, 1h（现有策略保留）
  // ...（需要更精确的 urlPattern 匹配，确保只缓存 GET）
]
```

注意：Workbox 的 `registerRoute` 默认只匹配 GET 请求，所以 POST 不会进缓存，但需确认配置中未设置 `method` 为通配。

**工作量**：中（需分析 API 端点清单，~1.5 小时）

---

### 9. 添加 standalone 模式检测

**现状**：无 `display-mode` 检测，无法区分浏览器打开 vs 已安装 PWA。

**Skill 参照**：`window.matchMedia('(display-mode: standalone)')` + iOS `navigator.standalone`。

**改进**：

1. 在 `usePWAInstall.js` 中加入 `isStandalone()` 方法
2. 用途：
   - 已安装 PWA 不再显示安装引导
   - 已安装 PWA 可调整 UI（如去掉浏览器相关提示）
   - 分析：区分 PWA 安装用户 vs 浏览器用户

**工作量**：小（并入 #2，~30 分钟）

---

### 10. 字体缓存策略

**现状**：Google Fonts 预连接但无缓存。每次离线重开可能丢失字体。

**Skill 参照**：字体应缓存。

**改进**：

```js
{
  urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
  handler: 'CacheFirst',
  options: {
    cacheName: 'google-fonts',
    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
  }
}
```

**工作量**：微（~15 分钟）

---

## P2 — 锦上添花（后续迭代）

### 11. iOS Splash Screen

iOS PWA 冷启动时显示启动画面，可通过 `<link rel="apple-touch-startup-image">` 实现。

目前项目无此配置。

**工作量**：中（需生成各尺寸启动图，~2 小时）

### 12. Background Sync

离线记分场景：用户在球场离线记分 → 恢复网络后自动同步。

**Skill 参照**：`workbox-background-sync`。

**评估**：当前业务以实时记分为主，离线场景少见。且需后端支持幂等和冲突处理。

**工作量**：大（前后端 ~8 小时）。**暂缓**。

### 13. Web Push Notifications

赛季更新、比赛提醒等推送。

**评估**：4 人小俱乐部，微信通知已足够。iOS PWA push 需用户主动添加到主屏幕，门槛较高。

**工作量**：大（后端 VAPID + 前端 + 权限引导，~12 小时）。**暂缓**。

### 14. Share Target

支持分享到 TPC（如从聊天分享比分）。

**评估**：当前无分享场景。

**工作量**：中。**暂缓**。

---

## 建议实施顺序

```
第 1 轮（1-2 天）
├── #5  Manifest lang 修正             ← 1 行
├── #4  离线/在线状态指示             ← 1h
├── #1  离线降级页面                  ← 30min
├── #10 字体缓存                      ← 15min
└── #3  SW 更新用户提示               ← 1h

第 2 轮（1 天）
├── #2  安装引导                      ← 2h
├── #9  standalone 检测               ← 并入 #2
├── #7  图标尺寸补全                  ← 30min
└── #8  API 缓存策略精细化            ← 1.5h

第 3 轮（可选）
├── #6  Manifest 字段补全（截图等）    ← 2h
└── #11 iOS Splash Screen             ← 2h

暂缓（待业务需要）
├── #12 Background Sync
├── #13 Web Push
└── #14 Share Target
```

---

## 文件变更清单

| 文件 | 操作 | 关联改进 |
|------|:----:|----------|
| `client/public/offline.html` | 新建 | #1 |
| `client/src/composables/useOnlineStatus.js` | 新建 | #4 |
| `client/src/composables/usePWAInstall.js` | 新建 | #2, #9 |
| `client/src/composables/useSWUpdate.js` | 新建 | #3 |
| `client/src/App.vue` | 修改 | #2, #3, #4 |
| `client/vite.config.js` | 修改 | #5, #6, #7, #8, #10 |
