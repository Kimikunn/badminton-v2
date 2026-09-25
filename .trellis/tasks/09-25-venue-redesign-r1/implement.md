# implement.md — 执行计划

> 顺序执行，每个 Phase 结束有可验证产物；中途发现契约冲突回到 design.md 修订，
> 不静默偏离。

## Phase 0 — 环境与基线
- [ ] 测试容器起好：`npm run build:test` → `docker compose -p badminton-test -f docker-compose.test.yml up -d --build`
- [ ] 打开订场屏现状（深/浅），对照 `09-25-mobile-design-system/baseline/venues-*.png` 与草图，明确改哪
- 产物：容器可访问 `http://localhost:8090`，e2e 现状基线绿（跑一遍 venue spec 记录跳过/失败项）

## Phase 1 — Token 增量（只加不改名）
- [ ] `tokens.css` 新增 `--color-monitor-active` / `--color-monitor-pending`（dark+light 两套）
- [ ] `npm run build` 通过
- 产物：design.md §2 表格里的新增 token 全部存在；diff 无改名

## Phase 2 — 图标替换
- [ ] `Trash2`→`Trash`（VenueView:363/:414、DaySheet:371）
- [ ] 订场屏范围 `grep Trash2` 清零；emoji/文本字形（⚙ ‹ › ▾ ＋ ★ ✎）清零
- [ ] ≤14px 图标 stroke-width 2.4–2.5（props 或 CSS）
- 产物：diff 只含图标行

## Phase 3 — 五视图换肤（每完成一帧与草图对照一次）
- [ ] ①列表：分组 header（--text-xs/600/text-muted）、BookingRow 换肤（头像/主辅文/价格 tabular/静默删除）、轮换卡（扁平+左缘色条+Star）、CTA sticky 纯文字、"更早的记录"折叠
- [ ] ②日历：BookingCalendar 卡片化（填色/双色条/图例换 token，逻辑零改动）
- [ ] ③DaySheet：逐块换肤（节假日 chip/订场行/监控列表/不可用钮），Pencil=accent、Trash=danger 常驻
- [ ] ④新增订场表单：inset grouped 重组（Sheet.vue 复用），费用自动匹配逻辑零改动
- [ ] ⑤VenueSettingsSheet（新组件）：场地管理收进 + 监控设置入口行；右上 Settings 圆钮挂接
- 每步自查 §12 handoff 检查单 A–H
- 产物：五帧与 `venue-sketch-final.png` 逐帧对照截图

## Phase 4 — 交互接线
- [ ] 删除全走 ConfirmSheet + Toast（记录/场地/监控）
- [ ] "更早的记录"展开/收起 + 组右开关
- [ ] 触控/`:active`/safe-bottom 抽查（§3 §4）
- 产物：交互基线清单（interactions.md）逐项过，无缺失

## Phase 5 — 回归与验收
- [ ] 全量 e2e：`PLAYWRIGHT_BASE_URL=http://localhost:8090 npx playwright test`（只允许改选择器不改行为断言；折叠交互补新断言）
- [ ] ADR 0003 契约断言确认：切月/填色/双色条/图例/月区间
- [ ] 深色截图 light? 不验收；dark 逐帧对照 prd AC
- [ ] `python3 ./.trellis/scripts/task.py` 上下文 validate
- 产物：e2e 全绿 + AC 逐条打勾

## Phase 6 — 收尾
- [ ] trellis-check 全项过（含 grep 无硬编码色/奇数 px 抽查）
- [ ] 提交（Phase 3.4 规范：本次 diff 一笔 fix/style 提交 + 任务工件一笔）
- [ ] 汇报：改动文件清单 + 草图对照差异说明
