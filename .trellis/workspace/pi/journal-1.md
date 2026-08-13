# Journal - pi (Part 1)

> AI development session journal
> Started: 2026-07-17

---



## Session 1: Bootstrap spec 填充：backend+frontend 模式文档化

**Date**: 2026-07-17
**Task**: Bootstrap spec 填充：backend+frontend 模式文档化
**Branch**: `master`

### Summary

Inspected codebase (Express+sql.js server, Vue3+Pinia client). Wrote .trellis/spec/backend/{index,api-routes,auth,logging,testing}.md and filled all 6 frontend spec files + index. Only code-evidenced patterns documented (venues resource as canonical example, writeAuth admin-token model, pino logging, node:test harness, Sheet+Input+toast form pattern). Spec layers now: backend, frontend.

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

(No commits - planning session)

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 安卓机型 PWA UI 适配

**Date**: 2026-08-07
**Task**: 07-17-android-ui-adaptation（已归档 archive/2026-08/）
**Branch**: `master`

### Summary

用户实测的"安卓 UI 遮挡"根因是安装引导弹层无法关闭（--safe-bottom 在安卓 Chrome 返回 0，关闭按钮被手势条覆盖）。范围定为：移除安装引导 + 全套 safe-area 适配。删了 App.vue 安装引导 Sheet 和 usePWAInstall.js；tokens.css 给 --safe-bottom 加 max() + standalone 16px 兜底；顺手修了 360px 下 header 标题溢出 15px（truncate + min-w-0）；Playwright 加 android-light/dark（360×640）两个 project，smoke 加 3 条断言。

### Main Changes

- client/src/App.vue: 删安装引导（script + template）；header 标题 truncate 修复
- client/src/composables/usePWAInstall.js: 删除
- client/src/styles/tokens.css: --safe-bottom = max(env(...), var(--safe-bottom-min, 0px))；standalone 下 --safe-bottom-min: 16px
- playwright.config.js: +android-light/android-dark（360×640）
- e2e/smoke.spec.js: 无横向滚动断言 / 安装引导不存在回归 / safe-bottom 管道测试
- spec 三处更新（见 commit）

### Git Commits

- 17c9c29 feat(client): 移除安装引导弹层，安卓 safe-area 兜底与 360px 适配
- docs(spec) commit + chore(task) archive commit

### Testing

- client npm run build 绿；全量 e2e 44 过 / 0 败 / 12 环境跳过（season-management 按 env flag 跳过，既有行为）；安卓 + iOS 视口截图人工核阅通过；trellis-check 终审通过

### 事故记录（教训）

docker-compose.yml 和 docker-compose.test.yml 同 service 名 app + 同默认 project 名，直接 `-f docker-compose.test.yml up -d` 把 prod 容器 badminton(:8088) recreate 删掉了。已即时用 dist 重建恢复。教训已写入 backend/testing.md：test 环境必须 `docker compose -p badminton-test -f docker-compose.test.yml`。

### Status

[OK] **Completed**

### Next Steps

- 真机验证 standalone 模式下 TabBar/Sheet 底部间距（e2e 无法模拟 display-mode: standalone，仅验证了管道）
- R4 顶部 header 在真机安卓 standalone 下的状态栏遮挡情况待真机确认（本次保持 env() 原样）


## Session 2: S6 赛季界面与规则系统（王选/灵魂契合/王之宝库）

**Date**: 2026-08-08
**Task**: S6 赛季界面与规则系统（王选/灵魂契合/王之宝库）
**Branch**: `master`

### Summary

按三切片交付 S6：①赛季建档+上篇王选/形态（黛青开局分服务端自动化）②下篇组合 PA7+灵魂契合（掷骰/阶层/选奖/重铸/重投）③王之宝库 11 卡执行（暗选同亮/爆破 11 分/存储器带入/时空裂隙回溯/结算修正）。S4 星尘逻辑抽取共享模块 comboStardust.js；修复 PWA SW 缓存导致规则动作后 UI 回退（seasons 改 NetworkFirst + recordAction upsert）。服务端 103/103，e2e 5 规格×4 视口全绿。遗留：创建赛季后视图不切换（MatchHubView 本地 ref）、matches?roundId 不过滤、写密集 e2e 连跑触发限流。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `e3e5e88` | (see git log) |
| `34496b1` | (see git log) |
| `e992451` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: S6 规则修正：月白抵抗局与逐人暗选

**Date**: 2026-08-08
**Task**: S6 规则修正：月白抵抗局与逐人暗选
**Branch**: `master`

### Summary

两处规则修正：①月白按 S5 秩序抵抗局处理（显式胜方/胜方≥21/30 封顶/分低者可获胜），抵抗校验提取共享 rules/resistance.js；②暗选改为 4 名选手各自提交本人已选卡片，归属校验+全员齐交同时亮出，存储器 carry 多条求和。服务端 107/107，e2e 全规格×4 视口全绿。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `00864c9` | (see git log) |
| `feb60c0` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: S6 王选改一次性王序 + 生产数据修复

**Date**: 2026-08-08
**Task**: S6 王选改一次性王序 + 生产数据修复
**Branch**: `master`

### Summary

规则修正：王选只在第 1 轮前投一次，从大到小定第 1-4 轮的王；同分组内重投不全局重排。s6_king_roll 改 {order:[...]} 一次性契约，王由 kingOrder 派生并兼容旧 topKings；2-4 轮仅形态选择。生产修复：kingOrder=p3(6)/p4(重投4)/p2(重投1)/p1(4)，round1 数据未动。服务端 110/110，e2e 全绿，已部署 :8088。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `a742008` | (see git log) |
| `4a06f76` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: S6 王权每轮最后一名展示

**Date**: 2026-08-13
**Task**: S6 王权每轮最后一名展示
**Branch**: `master`

### Summary

排名页王选面板逐轮展示王权提供人：calcTopRoundKingRights 按轮标准结算求末位，王垫底顺延第三名；部分完赛标暂列。e2e 王垫底剧本验证顺延分支，4 视口全绿。

### Main Changes

- Detailed change bullets were not supplied; see the summary above.

### Git Commits

| Hash | Message |
|------|---------|
| `3819c68` | (see git log) |
| `f349888` | (see git log) |

### Testing

- Validation was not recorded for this session.

### Status

[OK] **Completed**

### Next Steps

- None - task complete
