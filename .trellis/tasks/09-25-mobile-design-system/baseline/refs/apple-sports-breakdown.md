# Apple Sports 设计拆解 — 原则 / 逻辑 / 交互（不止是 UI）

> 来源：Apple HIG（designing-for-ios / navigation / sheets 官方文档）、Apple Sports 3.0
> 重设计官方说明与 release notes（v1.0→3.3 演进）、实机截图（gummble 54 屏库）、
> Cult of Mac / Apple Newsroom 报道。存档截图：本目录 apple-sports-*.png。

## 一、设计原则（HIG 落到 Apple Sports 上的具体化）

1. **速度与扫读优先**（官方 tagline "As fast as a sports app can be"）：
   - 无底部 tab、无搜索框、无设置噪音；整 app 是"一张可滚动记分板"
   - 一屏之内信息层级只有三档：大字 tab → 分组 header → 比分卡
2. **卡片即信息（glanceable）**：比分卡是全 app 唯一的信息原子。联盟名、双队、
   比分、状态全部在一卡内，扫一眼不点任何东西就知道一切。卡片点击进详情是唯一
   的层级推进方式。
3. **状态色语义化**：live=绿色系、Final/未开始=灰系、季后赛席位=联盟色条。
   颜色只表达状态，不表达装饰。数字一律 tabular 等宽。
4. **个性化层级**：星标队伍永远置顶；联盟区块可重排（v3.0 "Home is your new
   game hub, line them up your way"）。个性化是结构，不是皮肤。
5. **深度用颜色，不用阴影**：页面层级靠背景黑→卡灰→白字的对比与辉光色表达，
   没有投影堆叠。
6. **动效克制**：滚动基本无复杂动效，重点瞬间的反馈交给触觉（watch 比分变化
   haptics）与 Live Activities，而不是屏幕内动画。

## 二、交互逻辑清单（真实行为）

| 交互 | 行为 | 出处 |
|---|---|---|
| Yesterday / Today / Upcoming | 顶部**大字 tab**，可横滑切换（v2.4 "swipe left or right"） | 实机图 + release notes |
| 日期分组 | header 左：日期大写；右："Show less" 收起该组（默认展开今天的组，历史组收起） | 实机图 |
| 比赛卡 | 点击 → 比赛详情（大比分头 + Box Score / Play-by-Play / Lineup tab） | 实机图 |
| 联盟图标 rail | 首页顶部圆形联盟图标横滑，点击进该联盟视图 | 实机图 |
| My Leagues 菜单 | 右上 pill：关注管理、联盟直达、重排区块、Live Activities 管理 | Apple 支持文档 |
| 星标置顶 | 星标队伍永远在最上，不随重排移动 | v3.0 notes |
| 席位色标 | standings 行左缘色条表达季后赛/淘汰状态 | release notes |
| 深度导航 | 唯一方式 = 卡片/行点击 → push 详情 + 返回；无汉堡菜单 | 实机图 |
| Live Activities | 锁屏实时比分（外部系统能力，PWA 不可复制，对应物 = 推送/角标） | Reddit/Apple |
| 深色锁定 | 无浅色模式；联盟色辉光是全局氛围来源 | 实机图 |

## 三、对我们四个屏的映射（原则级，非皮肤级）

我们的结构差异：**Apple Sports 没有底部 tab、没有首页汇总**；我们是 4-tab PWA，
成员/荣誉/订场是核心功能。所以移植的是"屏内逻辑"，导航结构保留我们自己的
（已在 design-system.md §1/§2 契约化）。

| Apple Sports 逻辑 | 我们的落点 | 之前草图缺的 |
|---|---|---|
| 大字 tab + 横滑切换 | 比赛：已排程/进行中/已结束；积分榜：规则子视图 | 之前只做了"样子"，没有横滑与收起逻辑 |
| 日期/轮次分组 + Show less | 比赛、订场列表 | 草图做了样式没做"默认收起历史组" |
| 卡片点击 = 唯一层级推进 | 所有行/卡可点击 → 详情/Sheet；无第三种入口 | — |
| 状态色语义（live/final/upcoming） | 订场监控徽章、比赛状态、日历色 | 之前颜色各屏自发，需统一语义 token |
| 星标/个性化置顶 | 轮值人卡片、"我的"关注（可选） | 未做 |
| 一屏一主操作 | 场地页唯一绿色 CTA；比赛页唯一"创建新一轮" | 草图有但未上升为原则 |
| 深度用颜色 | 辉光+黑底+灰卡，无阴影 | — |
| 数字 tabular | 所有比分/分数/价格 | 部分做了 |

## 四、对实现阶段的约束（写回 design-system.md）

- 屏内 tab（大字 tab）≠ 底部 tab：页内视图切换逐步从 SegmentedControl 小胶囊
  升级为大字 tab（仍是同一组件，加大字号/字重）
- 分组 header 统一组件化（左标题 + 右操作/计数），配 Show less 折叠逻辑
- 状态色只允许语义用途：live=success、final/upcoming=fg-muted、当前用户/轮值=accent
- 每屏主 CTA 唯一化：一个实心主按钮（颜色 = 屏域色），其余一律次要样式
- 浅色模式适配策略：布局/层级照搬，表面色走 tokens（用户拍板深色优先 or 双模）

## 参考

- HIG: developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Apple Newsroom 2025-09-16 widgets 公告；Cult of Mac 2025-06-25 3.0 重设计报道
- App Store release notes v1.0→3.3；Apple 支持文档 HT116979
- 截图：gummble.com/apps/apple-sports-ios（54 屏库）
