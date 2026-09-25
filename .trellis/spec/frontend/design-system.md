# Mobile Design System — 移动端设计系统规范

> 逐屏改版的行动指南。**改任何一屏之前先读本文件的"工作流"和对应屏型 recipe。**
> 色值/间距等具体数值一律引用 `client/src/styles/tokens.css`，本文件不重复 token 值。
> 提炼自真实代码（文件路径均真实存在）。修改此文件须经任务评审，不能随手改。

---

## 0. 工作流（每屏改版必经）

1. **查基线**：打开本任务基线截图（`baseline/`）+ e2e 行为清单，明确"哪些行为不能丢"
2. **查参考**：按屏型对照参考库候选（见 prd 选型结果），抄模式不抄像素。
   **已选型：Apple Sports（2026-09-25），原则与约定见 §10**
3. **改一屏**：只动该屏的 view/组件，token 层只加不改名；实现前先过
   **§12 handoff 检查单**（草图值 → token/组件/态的映射）
4. **回归**：`cd client && npm run build` → 测试环境部署 → `npx playwright test` 对应 spec
   全绿 + 截图 light/dark 双模式人工过目
5. **一屏一任务**：禁止一次改多屏

## 1. 布局契约（架构级，改动需 ADR）

来源：`client/src/App.vue`、`client/src/styles/global.css`。动机：iOS 26 WebKit bug
（WebKit #297779，document 滚动 + fixed 元素漂移）。

- `.app-shell` = `h-dvh flex flex-col overflow-hidden`——**window 永不滚动**
- `<main>` 是唯一滚动容器：`flex-1 min-h-0 overflow-y-auto overscroll-contain p-4`
- TabBar 为 `absolute bottom-0` 覆盖层（毛玻璃悬浮），main 预留
  `pb-[calc(84px+var(--safe-bottom))]`
- 头部为普通 flex 子元素（非 sticky），详情页可用 scroll 隐藏（`headerHidden`）
- 滚动恢复：前进→顶部，返回→恢复原位；实现于 App.vue `router.afterEach` +
  transition `@enter`（勿改用 `watch(route)`，route 是 reactive 对象，from===to）
- 固定弹层（Sheet/Toast/ConfirmSheet）Teleport 到 body，不受内滚影响

**禁止**：在 body/html 层做滚动；给 `position:fixed` 元素的祖先加
transform/filter/backdrop-filter（会劫持 fixed 的包含块）。

## 2. 导航形态

- **底部 TabBar**：4 项（首页/比赛/积分榜/场地），图标+文字标签（纯图标禁止），
  当前态 = 填充胶囊 + 强调色 + 字重 600（非颜色单一维度，见 `.tab-active`）
- **层级推进**：tab 页(depth 0, fade 过渡) → 详情页(depth 1-2, slide 过渡，无 TabBar)。
  详情页自带返回（系统手势/左上返回）
- **模态交互**：一律用 `Sheet.vue`（bottom sheet，auto/half/full 三档），
  不新建居中 modal；确认类用 `ConfirmSheet.vue`
- **页内切换**：`SegmentedControl.vue`（default=胶囊 / underline=下划线两种变体）。
  Apple Sports 风格屏升级为**大字 tab 形态**：`--text-lg` 字号、inactive =
  text-muted + weight-600、active = text 主色 + weight-800，横滑可切换

## 3. 触控与反馈（移动端约定）

- 触控目标 ≥ 44×44px（`--space-8`）；小图标按钮用 `w-9 h-9`（36px）仅限次要工具按钮
- 反馈只用 `:active`，**禁止依赖 hover** 的任何功能（tooltip/悬浮揭示/悬停按钮）
  - 按压反馈统一：`active:scale-[0.97]`（卡片）或 `active:bg-surface-hover`（列表行）
  - 时长用 `duration-fast`，缓动用 `var(--ease-out)`
- 列表行点击态用 `active:bg-surface-hover`，不做整行 scale
- `-webkit-tap-highlight-color: transparent` 已全局设置，勿破坏

## 4. Safe area & 键盘

- 顶部：header `padding-top: env(safe-area-inset-top)`；底部：`safe-bottom` 工具类
  （= `var(--safe-bottom)`，standalone 下含 16px 保底，见 tokens.css）
- viewport meta 已含 `viewport-fit=cover user-scalable=no`，勿改
- 键盘会盖住底部 1/3：底部主 CTA 放进 Sheet 内（Sheet 自带 safe-bottom），
  不要放在页面 fixed 底栏

## 5. Glass（液态玻璃）使用规则

- 允许：app 级覆盖层（header、TabBar、Sheet、浮层 chip）——它们在滚动容器之外或之上
- **滚动容器内部禁用 backdrop-filter**（iOS 合成器 bug，参考 oikos 案例：
  scroll 容器内大量 backdrop-filter 层会导致整屏空白/滚动卡顿）；
  卡片用 `bg-surface + shadow-sm` 替代
- Glass 叠加处文字对比度按 quality-guidelines.md 的对比度规则校验

## 6. 组件清单与模式出处

| 组件 | 用途 | 参考模式 |
|---|---|---|
| `Card.vue` | 白卡容器（sm/md/lg padding） | iOS grouped card |
| `Sheet.vue` | bottom sheet（首选模态） | iOS sheet |
| `SegmentedControl.vue` | 页内视图切换 | iOS segmented control |
| `Button.vue` | primary/secondary/danger | — |
| `Badge.vue` / `Avatar.vue` / `RankingRow.vue` | 数据行/身份 | — |
| `EmptyState.vue` | 空态 | — |
| `ToastContainer.vue` | 轻提示（替代 alert） | — |

新增组件前先搜 `components/ui/`，避免第四种弹窗/第四种列表行。

## 7. 屏型配方（Recipe）——改版时的目标形态

每屏**一屏最多 3~4 个区块层级**；同权重白卡从头堆到尾 = 违反本规范（"Word 文档"反例）。

| 屏型 | 配方 | 参考模式 |
|---|---|---|
| Hero 区 | 0~1 个/屏，屏域色辉光（radial 渐变自屏顶融入黑底），承载最高权重信息 | Apple Sports 顶部联盟色辉光（apple-sports-home.png） |
| 数据展示 | 大数字直接做视觉（tabular 居中）+ 状态字；重点大块 + 次要小块（bento） | Apple Sports 比分卡（联盟名灰小字居中 + 大比分 + 状态） |
| 同类多项内容 | 日期/轮次分组列表 + 组右"收起/展开"开关，历史组默认收起 | Apple Sports 日期分组 + Show less（apple-sports-today.png） |
| 列表行 | 头像+主文+辅文+右侧数值（tabular）+ 静默删除钮，无 chevron 的行即整行可点 | 订场行定稿（venue-sketch-final.png ①） |
| 管理内容 | 收进右上入口 → Sheet，不占扫读区 | Apple Sports My Leagues 菜单模式 |
| 表单 | inset grouped：一张卡、label 左灰/值右、发丝分隔、组下灰色脚注 | iOS Settings / 提醒事项新建表单（venue-sketch-final.png ④） |
| 空态/骨架 | EmptyState 全量复用 | — |

**渐进披露**：一屏放不下的信息 → 横滑/展开开关/详情页，不平铺。

## 8. 逐屏替换的回归清单

- [ ] e2e smoke（4 视口无横向滚动 + safe-bottom）通过
- [ ] 该屏相关 spec 通过（holidays/season-management/contrast）
- [ ] light + dark 截图人工过目（对比度、暗色玻璃）
- [ ] 触控目标、`:active` 反馈、Sheet 化检查（§3 §4）
- [ ] 行为基线对照：原交互逐项不缺失（可点击目标、跳转路径）

## 9. 参考库使用约定

- 选型结果按屏回填 §7 表格，并注明出处（app 名 + 屏型，截图存 `baseline/refs/`）
- 原则：抄交互模式与信息层级，不抄品牌像素；参考仅作对照，不引外部 UI 库
- 当前出处：**Apple Sports v3.0**（截图 `baseline/refs/apple-sports-home.png` /
  `apple-sports-today.png`，拆解 `baseline/refs/apple-sports-breakdown.md`）；
  订场屏草图定稿 `baseline/refs/venue-sketch-final.png`

## 10. Apple Sports 风格契约（2026-09-25 选型定稿）

原则级（所有屏通用，逐屏替换时逐条对照）：

1. **一屏三档层级**：大字 tab → 分组 header → 卡/行。出现第四档 = 违反
2. **深度用颜色不用阴影**：黑底→灰卡（`--color-surface`）→白字对比表达层级；
   阴影只允许浮层（悬浮 CTA / Sheet / Toast）
3. **状态色只表达语义**：监控中=深蓝、待放票=浅蓝、已订=订场绿淡底、不可用=红淡底
   （ADR 0003 契约），禁止装饰性用色；数字一律 `tabular-nums`
4. **个性化是结构不是皮肤**：置顶卡 = 扁平卡 + **左缘 3px 屏域色条**
   （= 实机 standings 席位色标手法）；卡片禁渐变底/描边
5. **低频管理收进右上入口**：右上圆形图标钮 → Sheet（My Leagues 模式）；
   扫读区只放"扫读 + 唯一 CTA"
6. **一屏一主操作**：唯一实心主 CTA，色=屏域色（订场=`--color-success` 绿），
   底部全宽、纯文字无图标、`--radius-md`、投影减淡（shadow-lg 档即可）

已拍板的具体约定（用户 2026-09-25 拍板）：

| 项 | 契约 |
|---|---|
| 分组 header | `--text-xs` + `weight-600` + `text-muted`；正常中文，**禁 uppercase/letter-spacing** |
| 页内大字 tab | `--text-lg`；inactive=text-muted/600，active=主色/800 |
| 主 CTA | 底部全宽、无图标、屏域色实心 |
| Sheet 主钮 | 深色模式白底黑字、全宽（浅色模式待双模式拍板后补） |
| 右上入口 | 圆形图标钮（SVG + 34px 圆），不放文字 pill |
| Sheet 内表单 | inset grouped（见 §7 表单行） |

## 11. 图标规范（lucide-vue-next）

- 图标库唯一 = `lucide-vue-next`（几何最接近 SF Symbols）。
  **禁止 emoji / 文本字形当图标**（⚙ ‹ › ▾ ＋ ✎ 🗑 ★ 均为反例）
- 删除图标用 **`Trash`（干净桶身）**，禁用 `Trash2`（桶内两道竖线，Feather 画法非
  SF）；现有 `DaySheet.vue` 等使用 Trash2 处实现时替换
- 笔画光学加粗（模拟 SF 小尺寸 semibold）：≤14px 图标 `stroke-width: 2.4~2.5`；
  20px 以上用默认 2
- 颜色语义：编辑/修改 = `--color-accent`（蓝）；删除 = `--color-danger`（红）
  - **扫读行**：删除钮常驻但静默（`text-muted`），`:hover`/`:active` 转 danger，
    点击后**二次确认**。PWA 适配动机：不依赖左滑手势（桌面鼠标无法滑动、
    长按撞浏览器右键菜单）；hover 仅是增强，功能本体 = tap + confirm，
    不违反 §3"禁止依赖 hover"
  - **操作上下文**（Sheet 内行 / 长按菜单 / 编辑模式）：常驻语义色，
    同 iOS context menu（UIMenu）图标常显惯例

## 12. 对齐与 Handoff 检查单（草图→实现）

**双轨对齐**（对齐问题多是没有"轨道"概念导致）：

- **屏缘轨**：大标题 / 分组 header / CTA / 卡片外边距 = 同一水平边距
  （token 归栅后 `--space-3` 12px）
- **内容轨**：卡内统一水平 padding `--space-3`；header 右侧计数与卡右缘对齐
- **数字基线**：价格/比分/金额 `tabular-nums`，多元素并排用 `align-items: baseline`

**Handoff 检查单**（每屏实现前逐条过，实现后逐条验收）：

| # | 偏差点 | 处理契约 |
|---|---|---|
| A | 草图硬编码色值 | 映射 token；无对应 → 任务内新增 token（只加不改名），PR 说明 |
| B | 奇数 px 间距/字号/圆角 | 归 4px 栅格与 token 档位；视觉差 <1px 可接受 |
| C | 内联 SVG | 换 lucide 组件；Trash2→Trash（§11） |
| D | 手画 grabber/Sheet/segmented | 复用 `Sheet.vue` / `SegmentedControl.vue` / `ConfirmSheet.vue`，禁重写 |
| E | 草图写死数据 | 实现 0/1/n 条、空态（EmptyState）、长文本截断、加载态 |
| F | 草图无安全区 | 挂 App.vue 壳：main 内滚 + `pb-[calc(84px+var(--safe-bottom))]`，Sheet 自带 safe-bottom |
| G | 草图纯深色稿 | **已决（2026-09-25）**：深色优先——所有屏先做深色，浅色后补一批（届时= tokens.css `:root` 换一套浅色方案 + 辉光/淡底/阴影的浅色微调）。**前提：深色实现严禁写死深色值，必须全部走语义 token**，否则浅色阶段变成全量重构 |
| H | 草图只有静止态 | 实现 `:active` / hover 增强 / 删除 confirm / 加载骨架 |

方法参考：W3C Design Tokens CG 草案（每个草图值三选一：映射已有 token /
新增 token / 判定草图画错）；Apple HIG「Layout」。
