# Design — PWA 一键跳转场馆小程序入口

> 纯前端改动（`client/`）。不改 `server/`、不改 API 契约、不改数据库 → 无 PWA 缓存策略连带影响。

---

## 1. 跳转机制

### 1.1 使用明文 URL Scheme

```
weixin://dl/business/?appid=wx2fdf924861911ddc&path=pages/index/index&env_version=release
```

- 依据：微信官方《获取 URL Scheme》明文 scheme 段（2026-09-18 核实）。`path` 必须是已发布页面且**不可携带 query**，`pages/index/index` 是 tabBar 首页，满足约束。
- 加密 scheme（`?t=TICKET`）与 URL Link（`wxaurl.cn`）都需要场馆 appsecret，**明确排除**。
- 场馆是否声明过（MP 后台「隐私与安全 → 明文Scheme拉起此小程序」）未知（PRD O1）。未声明时 scheme 无效 → 由 §1.3 兜底承接，代码路径不区分——**不做可用性探测**（浏览器拿不到结果，页面内也测不出）。
- **实测修正（2026-09-18 真机）**：该 appid 未声明，6 个变体（多路径 + 无 path）全部回「对不起，当前页面无法访问」。因此：
  - **兜底分支是当前的实际主路径**，不是异常分支；实现上兜底提示必须默认就会出现（2.5s 后），不能当作罕见 case 处理。
  - scheme 仍保留在代码里（期权）：场馆开关一旦打开，同一份代码无需发版即可真跳转。
  - 文案需面向“实际就是打不开”的预期：先告诉用户该怎么办，而不是“失败了”的报错口吻。

### 1.2 入口配置落点

`client/src/constants/miniProgram.js`（新建，对齐 `seasonPresets.js` 的单用途常量文件模式）：

```js
export const GYM_MINI_PROGRAM = {
  appId: 'wx2fdf924861911ddc',
  name: '川沙体育场',
  homePath: 'pages/index/index'
}

export function miniProgramScheme({ appId, path } = GYM_MINI_PROGRAM) { ... }
```

文案与 appid 集中一处，后续换场馆（`config/env.js` 里还有沪羽飞旸、小柒篮羽等多个 appid）只改这个文件。

### 1.3 失败检测（启发式）

浏览器无法得知自定义 scheme 是否被系统接管，因此用可见性启发式：

```
点击 →
  armed = true; fallbackVisible = false
  location.href = scheme            // 交给系统
  timer = setTimeout(2.5s):
      if (armed && document.visibilityState === 'visible') fallbackVisible = true
visibilitychange →
  hidden: fallbackVisible = false; armed = false; clearTimeout(timer)   // 已切走 = 跳转成功
```

- **为什么 2.5 秒**：iOS 点击自定义 scheme 会先弹系统确认框（「在"微信"中打开？」），这期间页面仍然 visible。间隔取 1.2 秒会在系统框还开着时误报兜底。
- **为什么用 `visibilitychange` 而不是 `blur`**：iOS 上切 App 稳定触发 `visibilitychange → hidden`；`blur` 在弹系统框时也会触发，会误判为"已跳走"。
- 已知局限（接受）：用户切到微信后立刻切回，兜底不会重播；这是可接受的（他们显然已经看到微信了）。
- **实现约束**：`location.href = scheme` 必须在用户点击的同步调用栈里执行（iOS 会静默拦截非手势触发的自定义 scheme 跳转）。`openMiniProgram()` 内不得 `await` 任何异步操作在前，兜底定时器与状态置位都放在赋值之后。

## 2. 组件与数据流

### 2.1 新增件

| 文件 | 职责 |
|---|---|
| `client/src/constants/miniProgram.js` | 小程序 appid / 名称 / 首页 path + scheme 拼接 |
| `client/src/composables/useMiniProgramJump.js` | 跳转 + 失败启发式 + 复制小程序名（per-call state，非单例） |
| `client/src/components/venue/MiniProgramEntry.vue` | 渲染入口按钮 + 兜底提示块；props：`label` / `variant` / `size` / `block` / `hint` |

`useMiniProgramJump` 按 `hook-guidelines.md` 的「per-call state」模式实现（每个入口实例各有自己的兜底状态），复制用 `navigator.clipboard.writeText`，失败时 `useToast.show(..., 'error')`。

### 2.2 接入点

| 位置 | 形态 | 显示条件 |
|---|---|---|
| `DaySheet.vue` 需验证块（`:366-369`） | `<MiniProgramEntry label="打开小程序过验证" size="sm" variant="secondary" />` | `m.status === 'awaiting_verify'`（既有条件） |
| `DaySheet.vue` 监控区新增待支付块 | 独立警示块：`⏳ 待支付 · 支付截止 HH:MM` + 兜底说明 + `MiniProgramEntry label="去小程序支付"` | `pendingLock` 非空（见 §2.3） |
| `DaySheet.vue` 历史记录锁场行（`:435-441`） | 行内紧凑入口 `MiniProgramEntry label="去支付" size="sm" variant="ghost"` | 该行 `status === 'locked'` 且 `expireAt` 未过期 |
| `VenueWatchSettingsSheet.vue` 辅助订场设置 | 一行「打开场馆小程序」+ `MiniProgramEntry block` | 始终显示 |

### 2.3 待支付数据流（不新增接口）

```
DaySheet 打开 (props.show) 且当天有监控 →
  store.fetchLocksByDate(props.date)        // 复用既有 action → GET /api/intents/locks?date=
  → pendingLock = locks 中 status==='locked' && expireAt > now 的行（取 expireAt 最早的一条）
  → 渲染待支付块；无匹配 → 不渲染
```

- **为什么不用意图 payload**：`intentController.intentStatusFacts` 只回 `lastAttempt`（无 `expireAt`），加字段等于改 API 契约 + 触发 PWA 缓存注意事项；现有 locks 接口已支持 `?date=`，一次请求即可。
- **为什么锁场行内也放入口**：待支付块只覆盖"未过期"窗口，历史行保留入口用于刚过期/部分锁定的记录对照（用户已确认两处都做）。
- `now` 用 60 秒间隔的 `setInterval` 刷新的 ref，块在 `expireAt` 过去后自动消失（AC3）；组件卸载时清定时器。
- 拉取失败静默降级（不渲染待支付块，不弹错）；历史记录展开时既有逻辑照常再拉一次，两处互不依赖。

### 2.4 样式

- 待支付块沿用需验证块的既有样式语法（`bg-warning-subtle` / `text-warning` / `text-2xs` 等设计令牌），深色浅色都由令牌覆盖，不写字面色值。
- 图标用 `lucide-vue-next`（`AlertTriangle` / `Clock` 等既有图标集）。

## 3. 兼容性与验证

- **iOS Safari + 主屏独立模式**（`vite.config.js` manifest `display: standalone`）：自定义 scheme 由系统接管；独立模式下同样成立，但必须真机各测一次（AC7）。
- **桌面浏览器**：装了微信桌面版可能直接拉起；否则什么都不发生 → 2.5 秒后出兜底提示。不得抛 JS 异常。
- **验证命令**：`cd client && npm run build`（语法/导入）、`npx playwright test`（现有 e2e 不回归；需要应用在 localhost:8089 运行）。客户端无单元测试运行器，这是本层全部检查手段。

## 4. 权衡与回滚

- **权衡**：不做小程序码图片兜底（用户选了纯文案方案 A）。若 O1 验证失败，再加图片素材是一次独立的小改动，不影响本设计结构。
  - 已知现状（实际）：O1 已失败，所以“智能兜底”就是交付主体；后续若要补小程序码，只需给 `MiniProgramEntry` 的兜底卡片插图 + 引导话术。
- **回滚**：纯前端、无数据迁移。回滚 = revert 提交；服务端与数据库不受影响。
- **不做的事**：不做可用性探测（技术上不可行）、不在推送消息里带 scheme（微信推送在微信外，链接同样受声明约束，且超出了本任务范围）。
