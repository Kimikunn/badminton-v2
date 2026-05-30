# PWA 媲美原生 App 开发指南

更新日期：2026-05-28

## 适用对象

本文面向希望在 iOS 上开发 PWA，并尽量获得接近原生 App 体验的开发者、产品负责人和独立开发者。

本文重点讨论：

- 如何让 PWA 在 iPhone 上更像一个真正的 App
- iOS PWA 和原生 App 的关键差距
- 安装、离线、触控、系统集成和视觉体验的优化方法
- 如何模拟 iOS 26 Liquid Glass 风格
- 上线前应完成的真机测试清单

本文不讨论：

- App Store 上架流程
- SwiftUI、UIKit、React Native、Flutter 的完整开发教程
- 企业证书、MDM、欧盟替代分发的具体合规流程

## 一句话结论

PWA 可以做到很像 App，但前提是按 App 的标准设计和实现，而不是只给网页加一个 manifest。真正决定体验的不是框架，而是启动速度、离线能力、触控细节、系统集成、弱网表现和 iOS 适配。

如果应用主要是内容、表单、课程、商城、预约、会员系统、轻量聊天、CRM 或后台工具，PWA 是值得认真考虑的路线。

如果应用依赖重度系统能力，例如长期后台任务、蓝牙、NFC、Widget、Live Activities、复杂相机、音视频处理、地图定位、游戏、多指绘图或强 iOS 原生质感，原生或混合开发会更稳。

## PWA 和原生 App 的主要差距

### 系统能力

原生 App 可以更完整地调用 iOS 系统能力，例如：

- 相机和相册深度控制
- 蓝牙、NFC、后台定位
- 后台任务和后台刷新
- Widget、Live Activities、App Intents
- Siri、Shortcuts、Spotlight
- 系统分享扩展、文件提供器
- StoreKit、HealthKit、HomeKit 等系统框架

PWA 可以使用部分 Web API，但在 iOS 上边界更明显。普通业务足够用，深度系统集成则不适合强行用 PWA。

### 后台能力

原生 App 可以做更稳定的后台刷新、上传、定位、音频和通知处理。

PWA 主要依赖 Service Worker、缓存、Web Push 和前台同步。它不能像原生 App 一样长期在后台运行逻辑。

### 安装体验

iOS 上的 PWA 需要用户通过 Safari 手动选择“添加到主屏幕”。这比 App Store 的安装路径更绕，也没有 App Store 搜索、评价、榜单和内购体系。

因此，iOS PWA 的安装引导必须产品化，而不是只放一句“请添加到主屏幕”。

### 触控和转场

PWA 可以做到顺滑的点击、滑动、列表滚动和底部导航，但在以下方面通常不如原生：

- 系统级侧滑返回
- 半屏弹窗拖拽
- 原生弹性滚动和转场
- Taptic Engine 触觉反馈
- 键盘弹起后的稳定布局
- 边缘手势冲突处理
- 复杂多指操作

### 视觉一致性

PWA 可以模拟 iOS 视觉风格，但不能直接调用真正的 SwiftUI/UIKit 系统控件和系统材质。

这意味着 PWA 可以做到“看起来接近 iOS App”，但很难做到“和 iOS 原生控件完全一致”。

## iOS 26 Liquid Glass 能不能用 PWA 实现

可以做到视觉上接近，但不能做到系统级一致。

Apple 的 Liquid Glass 是系统级动态材质。原生 SwiftUI/UIKit 可以直接使用系统材质、导航栏、Tab Bar、弹窗和控件，因此会自动跟随 iOS 26 的真实设计语言。

PWA 只能用 Web 技术模拟，例如：

```css
.glass {
  background: rgba(255, 255, 255, 0.28);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
}
```

这种方式可以做出半透明、模糊、玻璃感和浮层效果，但有几个限制：

- 不能调用真正的系统 Liquid Glass 材质
- 不能自动获得系统控件的动态高光、折射和响应
- 不能影响系统键盘、系统弹窗、分享面板等区域
- 大量使用 `backdrop-filter` 会影响性能
- 不同 iOS 和 Safari 版本可能存在表现差异

建议把 Liquid Glass 作为 PWA 的视觉方向，而不是试图一比一复制系统效果。

## 核心实现方法

### 1. 使用 App Shell 架构

PWA 应该像 App 一样快速打开。首屏结构、底部导航、顶部栏、基础 CSS、关键 JavaScript 和图标资源都应该被预缓存。

目标是：

- 第二次打开接近秒开
- 弱网下仍能进入主界面
- 断网时不是白屏
- 页面框架先出现，数据随后刷新

App Shell 通常包括：

- 顶部导航或标题栏
- 底部 Tab Bar
- 页面容器
- 加载骨架屏
- 离线提示
- 核心路由资源

### 2. 做离线优先

离线能力是 PWA 接近 App 的关键。建议按资源类型选择不同缓存策略：

- 静态资源：Cache First
- 页面框架：Cache First 或 Stale While Revalidate
- 列表数据：Stale While Revalidate
- 强实时数据：Network First
- 表单提交：离线队列加后台重试

可以使用 Workbox 管理 Service Worker、预缓存、运行时缓存和离线 fallback。

### 3. 配置可安装能力

至少需要准备：

- `manifest.webmanifest`
- Service Worker
- App 图标
- 启动画面适配
- iOS standalone 配置
- 主题色和背景色

iOS 建议加入：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
```

示例 manifest：

```json
{
  "name": "Example App",
  "short_name": "Example",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 4. 认真处理 iPhone 安全区

iPhone 有刘海、Dynamic Island 和 Home Indicator。PWA 如果不处理安全区，会很容易出现顶部文字被遮挡、底部按钮贴边、Tab Bar 被 Home Indicator 干扰等问题。

基础配置：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

CSS 示例：

```css
.app-header {
  padding-top: env(safe-area-inset-top);
}

.app-tabbar {
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.floating-action {
  bottom: calc(16px + env(safe-area-inset-bottom));
}
```

### 5. 触控体验要按 App 标准打磨

移动端 PWA 最容易暴露“网页感”的地方是触控。

建议：

- 主要点击区域不小于 44px
- 按下状态必须立刻反馈
- 避免点击后出现蓝色高亮
- 避免按钮文字被选中
- 避免图片和链接长按出现不必要菜单
- 使用 Pointer Events 处理拖拽和滑动
- 避免滚动穿透
- 对底部弹窗和抽屉做手势边界控制

基础 CSS：

```css
button,
.tap-target {
  min-height: 44px;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
```

滚动控制：

```css
.app-scroll {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
```

### 6. 处理键盘和动态视口

iOS 上输入框聚焦后，键盘会改变可视区域。很多 PWA 会出现底部按钮被遮挡、页面跳动、弹窗高度异常等问题。

建议：

- 使用 `100dvh`，不要只依赖 `100vh`
- 底部固定按钮加安全区 padding
- 表单页保留足够底部滚动空间
- 输入框聚焦后滚动到可见区域
- 弹窗内滚动和页面滚动分离

示例：

```css
.app {
  min-height: 100dvh;
}

.form-page {
  padding-bottom: calc(96px + env(safe-area-inset-bottom));
}

.bottom-submit {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

### 7. 加入系统集成能力

能用的 Web 能力应该尽量补齐：

- Web Push：通知
- Badging API：主屏幕角标
- Web Share API：系统分享
- Share Target：作为分享目标
- File API：文件选择和上传
- Media Capture：拍照和选择图片
- Clipboard API：剪贴板
- Geolocation API：定位
- Shortcuts：manifest 快捷入口

注意：iOS 对这些能力的支持有版本和场景限制，必须真机测试。

### 8. 安装引导要产品化

iOS 没有标准的 PWA 安装弹窗。用户需要从 Safari 分享菜单中选择“添加到主屏幕”。

建议：

- 不要在用户第一次打开页面时立刻打断
- 在用户完成一次核心操作后提示安装
- 用图文说明 Safari 的安装路径
- 检测是否处于 standalone 模式
- 已安装用户不再提示
- 把安装利益说清楚，例如更快打开、离线使用、通知提醒

检测 standalone：

```js
const isStandalone =
  window.navigator.standalone === true ||
  window.matchMedia("(display-mode: standalone)").matches;
```

### 9. 性能以真机为准

PWA 是否像 App，第一感受是速度。

建议目标：

- 首屏尽量 1 秒内出现可用框架
- 关键交互响应低于 100ms
- 列表滚动稳定 60fps
- 弱网下有骨架屏和重试状态
- 大图延迟加载
- 路由和页面组件按需加载
- 避免全局大包
- 避免过量 `backdrop-filter`

建议使用 Lighthouse、WebPageTest、Safari Web Inspector 和 iPhone 真机一起检查。

## 推荐技术栈

### 前端框架

常见选择：

- React + Vite
- Vue + Vite
- SvelteKit
- Next.js
- Nuxt

如果重点是移动端应用体验，建议优先选择轻量、首屏快、路由清晰、状态管理简单的方案。

### PWA 工具

推荐工具：

- Workbox：Service Worker 和缓存策略
- vite-plugin-pwa：Vite 项目的 PWA 集成
- PWABuilder：检查和生成 PWA 配置
- Lighthouse：性能、可访问性和 PWA 审计

### 本地存储

建议：

- 简单设置：localStorage
- 较复杂数据：IndexedDB
- 更好的 IndexedDB 封装：Dexie
- 离线队列：IndexedDB 加重试机制

## iOS PWA 验收清单

### 安装和启动

- 可以从 Safari 添加到主屏幕
- 主屏幕图标清晰，没有黑边或裁切错误
- 启动后是 standalone 模式
- 启动时没有明显白屏
- 断网后仍能打开基础界面
- 杀掉进程后重新打开状态正常

### 布局

- 顶部内容没有被刘海或 Dynamic Island 遮挡
- 底部导航没有被 Home Indicator 干扰
- 横竖屏布局稳定
- 小屏 iPhone 上文字不溢出
- 深色模式下仍可读
- 弹窗不会超出屏幕

### 触控

- 按钮点击区域足够大
- 点击有即时反馈
- 列表滚动顺滑
- 底部弹窗没有滚动穿透
- 左右滑动不会误触系统返回
- 长按不会出现不必要的浏览器菜单
- 拖拽、排序或滑动操作稳定

### 输入

- 键盘弹出后输入框可见
- 底部提交按钮不会被键盘遮挡
- 表单错误提示位置正确
- 自动填充表现正常
- 数字、电话、邮箱等输入类型正确

### 网络和离线

- 弱网有加载状态
- 请求失败有重试入口
- 离线时有明确提示
- 已缓存内容可以访问
- 表单提交失败不会丢数据
- 恢复网络后可以同步

### 系统能力

- 通知授权流程清晰
- 已添加到主屏幕后 Web Push 可用
- 角标行为符合预期
- 分享功能可用
- 相机、相册、定位等权限提示正常

### 性能

- 首屏加载足够快
- 页面切换没有明显卡顿
- 滚动不掉帧
- 图片不会撑爆内存
- 玻璃效果不会导致明显发热或卡顿
- 长时间使用后状态稳定

## 推荐实施顺序

1. 先完成移动端核心页面，而不是桌面网页缩小版。
2. 加入 manifest、图标、standalone 和基础 iOS meta。
3. 使用 Service Worker 和 Workbox 做可离线启动。
4. 用 App Shell 让第二次打开接近秒开。
5. 处理 iPhone 安全区、键盘和底部导航。
6. 打磨触控反馈、弹窗、滚动和页面转场。
7. 加入 Web Push、角标、分享、快捷入口等系统能力。
8. 模拟 Liquid Glass 风格，但控制模糊层数量。
9. 使用 Lighthouse 做初步审计。
10. 用 iPhone 真机完整测试安装、启动、弱网、断网和交互。

## 参考资料

- [web.dev PWA 学习路径](https://web.dev/learn/pwa/progressive-web-apps)
- [MDN Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [MDN PWA Best Practices](https://developer.mozilla.org/docs/Web/Progressive_web_apps/Guides/Best_practices)
- [web.dev Workbox](https://web.dev/learn/pwa/workbox/)
- [Apple: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
- [Apple: Sending Web Push Notifications in Web Apps and Browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [WebKit: Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
- [Apple: Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Chrome Lighthouse](https://developer.chrome.com/docs/lighthouse)
- [PWABuilder Docs](https://docs.pwabuilder.com/)

