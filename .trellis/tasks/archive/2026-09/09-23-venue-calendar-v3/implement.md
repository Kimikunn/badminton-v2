# Implement — 订场日历 v3

## Step 1 — intent.js 聚合改造 ✅ 前置

- [ ] `aggregateDayBadge` → `aggregateDayBars`：按 `BADGE_PRIORITY` 排序返回状态数组（去 expired）；`badgeFor` 返回数组；删 `MONITOR_CELL_LABELS` 依赖（格子不再有文字胶囊）
- [ ] 验证：`grep -rn aggregateDayBadge client/src` 无残留消费者

## Step 2 — BookingCalendar.vue 自绘重写

- [ ] 去 Vant：删 `Calendar` import / `vant/lib/calendar/style/index` / `--van-calendar-*` 覆盖
- [ ] 月份导航：`minMonth`=最早 records 月（无 records 则=今天所在月）、`maxMonth`=今天+6；`cur` 首屏=今天月；箭头夹紧 disabled
- [ ] 月网格 + `metaByKey`（monitor 改数组）+ 底色类/色条/休班小字，类名与 design.md §3 表一致
- [ ] 数字绝对居中；`.bars` absolute 贴底；`.holi` absolute 右上（AC5）
- [ ] 底部信息栏：动态图例 + `monthTotalHours`；删月摘要与 IO 跟踪
- [ ] `select-day` 语义不变：今天及以后（含不可用日）可点，过去日忽略

## Step 3 — VenueView.vue 接线

- [ ] `monitorStatusByDate` 适配数组形状（注释同步）
- [ ] 其余 props / DaySheet / Tab 结构不动

## Step 4 — e2e 更新

- [ ] `holidays.spec.js`：换选择器 + 箭头导航；AC2 休/班断言保留
- [ ] 新增 AC1（导航边界 disabled）/ AC3（多段色条、暂停无条）/ AC4（填色类）/ AC5（数字对齐 y 坐标）
- [ ] 跑全量日历相关 e2e

## Step 5 — 质量门槛

- [ ] `npm run lint`（如无 client lint 脚本则 build 通过即可：`npm run build`）
- [ ] 真机/浏览器核对深色模式（AC6）

## 回滚点

- 单任务单提交；回滚 = revert 该提交 + `git checkout` 恢复 CONTEXT.md（ADR 0003 保留，历史事实不删）
