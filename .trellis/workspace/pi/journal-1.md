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
