# design.md — 订场屏换肤技术设计

> 执行依据：`prd.md`（需求/AC）+ `.trellis/spec/frontend/design-system.md`
> §0/§2/§3/§10/§11/§12。目标形态 = 定稿草图
> `.trellis/tasks/archive/2026-09/09-25-mobile-design-system/baseline/refs/venue-sketch-final.png`。

## 1. 现状盘点（真实代码）

| 文件 | 行数 | 角色 |
|---|---|---|
| `client/src/views/VenueView.vue` | 566 | 主视图：SegmentedControl 列表/日历；**两分支 grid 叠放——容器高度=日历自然高度，列表内滚、日历永不滚（v3 契约，禁改结构）** |
| `client/src/components/venue/BookingCalendar.vue` | 268 | 自绘单月日历（ADR 0003）：切月/填色/双色条/月区间 |
| `client/src/components/venue/BookingRow.vue` | 48 | 列表记录行 |
| `client/src/components/venue/CalendarInfoBar.vue` | 69 | 图例 |
| `client/src/components/venue/DaySheet.vue` | 493 | 点日期面板：节假日 chip / 订场行 / 监控列表 / 不可用 |
| `client/src/components/venue/VenueWatchSettingsSheet.vue` | 121 | 监控设置 Sheet |
| `client/src/components/venue/HolidayBadge.vue` | 26 | 节假日徽标 |

图标现状：VenueView 引入 `ClipboardList, Pencil, Trash2, Settings`（Trash2 在
:363/:414，Pencil :411）；DaySheet 引入 `ChevronDown, Pencil, ShieldAlert, Trash2, X`
（Trash2 :371）。

## 2. Token 映射（§12-A/B：草图值 → token）

| 草图值（氛围稿） | 落点 token | 备注 |
|---|---|---|
| 卡灰 `oklch(0.17 0.004 240)` | `--color-surface` | 深色下 0.20，微色差接受 |
| Sheet 深底 `0.13` / 页底 `0.10` | `--color-bg` | dark 0.14 |
| 表单/行深底 `0.22` | `--color-surface-hover` | dark 0.24 |
| CTA 绿 `0.74 0.15 150` | `--color-success` | 屏域色=success（§10） |
| 订场淡底 / 左缘色条 | `--color-success-subtle` / `--color-success` | |
| 不可用淡底/描边 | `--color-danger-subtle` / `--color-danger` | |
| 监控中深蓝 `0.55 0.16 250` | **新增 `--color-monitor-active`** | ADR 0003 语义绑定 |
| 待放票浅蓝 `0.75 0.10 250` | **新增 `--color-monitor-pending`** | 同上 |
| 今天填色 `0.60 0.18 245` | `--color-badge-blue` | dark 0.65 0.15 250，近似 |
| 分组 header 灰 / 静默删除灰 | `--color-text-muted` | |
| 编辑铅笔蓝 | `--color-accent` | §11 |
| 删除红（动作态/操作上下文） | `--color-danger` / hover 用 `--color-danger-hover` | |
| 发丝分隔线 | `--color-border` / `--color-border-light` | |

**规则**：BookingCalendar/CalendarInfoBar 现有硬编码色若与上表等效，一律替换成
token；新增 token 仅限 `--color-monitor-active/pending` 两个（dark+light 各一套，
light 值在本任务先给深浅合理的占位，浅色批量任务再统一调）。

**归栅**：奇数 px（10/11/13px 间距、12.5/13/13.5px 字号、13/14px 圆角）→
`--space-2/--space-3`、`--text-xs/--text-sm`、`--radius-md`（§12-B，差 <1px 接受）。

## 3. 图标映射（§11）

| 现状 | 目标 | 处理 |
|---|---|---|
| `Trash2`（VenueView:363/:414、DaySheet:371） | `Trash` | 换组件名，桶身无竖线 |
| `ClipboardList`（列表 CTA 图标） | 移除 | CTA 纯文字（§10） |
| `Pencil` | 保留 | 色 → `--color-accent` |
| `Settings` | 保留 | 右上圆形图标钮 |
| `ChevronDown/ShieldAlert/X`（DaySheet） | 保留 | |
| 新增：`ChevronRight`（设置行）、`Plus`（新建监控/新增场地）、`Star`（轮换卡置顶标） | 引入 | fill 版 star |
| ≤14px 全部 | stroke-width 2.4–2.5 | SF 小尺寸光学加粗 |

禁 emoji/文本字形；VenueView 模板里如有 `＋`/`▾`/`★` 文本残留一并清零。

## 4. 结构决策

1. **右上设置 Sheet（新组件 `VenueSettingsSheet.vue`）**：现有散在列表页的
   场地信息管理（增删改）收进该 Sheet；Sheet 内含「场地信息 N 行
   （Pencil/Trash 行操作）＋ 新增场地（Plus）」和「监控设置 ›」入口行（点击打开
   现有 `VenueWatchSettingsSheet`）。场地编辑表单复用现有 Sheet 逻辑换肤，不重写。
2. **列表 CTA 定位**：主滚动容器是 `<main>`（§1 壳契约），禁 `position:fixed`；
   用容器内 `sticky bottom-0` 实现"唯一绿色 CTA"，列表内容加等高 padding-bottom
   防遮挡；TabBar 覆盖区已由 App.vue `pb-[calc(84px+var(--safe-bottom))]` 预留。
3. **两分支叠放机制禁改**：VenueView :341/:561 注释明确"容器高度=日历自然高度、
   列表内滚、日历永不滚"；换肤只动样式，不动 grid 结构与 `contain:size`。
   注意 :554 注释坑：**不用 `transition-all`**（切视图垃圾桶会渐隐叠在日历上）。
4. **"更早的记录"折叠**：新增交互（历史组默认收起，组右"展开/收起"开关）——
   行为增加需在 e2e 补断言；最近一组默认展开。
5. **删除流程**：所有删除（记录/场地/监控）统一 `ConfirmSheet.vue` 二次确认 +
   `ToastContainer` 反馈；扫读行删除钮静默灰，`:hover`/`:active` 转 danger。
6. **轮换卡**：数据源沿用现有轮换/连任逻辑；形态=扁平卡+左缘 3px
   `--color-success` 条；置顶标 Star。

## 5. 风险与 Gotcha

- BookingCalendar 268 行自绘逻辑（切月边界、月区间、BADGE_PRIORITY 段序）**只换
  肤不动逻辑**；改前读组件头注释的契约说明。
- DaySheet 493 行信息密度高，换肤按块（节假日 chip → 订场行 → 监控列表 →
  不可用按钮）逐块过，防漏状态。
- e2e 可能断言现有类名/DOM 文案：换肤后跑全量 venue spec，**只允许改选择器，
  不允许改行为断言**。
- PWA 缓存：build 后旧 sw 可能缓存旧资源，测试环境验证注意 hard refresh
  （quality-guidelines.md PWA cache caution）。
- 布局壳（App.vue/router）本任务禁改——上一任务已提交，勿顺手动。

## 6. 验证

- 部署：`cd client && npm run build:test` → 测试容器
  `docker compose -p badminton-test -f docker-compose.test.yml up -d --build`
  （conflict 时 `docker rm -f badminton-test`）
- e2e：`PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test`（venue/
  holidays 相关 spec 全量 + smoke 4 视口）
- 视觉：深色截图与草图五帧逐帧对照（浅色截图本任务不验收，见 prd Out of Scope）
