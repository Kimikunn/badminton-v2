# S6 实施计划

按 D4 三切片顺序执行；每切片完成后跑验证命令再进入下一片。

## 切片一：赛季建档 + 上篇

- [ ] 服务端：`constants.js` RULE_ID 加 S6；`seasonValidators.js` 与 `utils/validators.js:135` 白名单加 `s6`；`rules/index.js` 注册 s6 插件（先继承 standard）；`seasonService.js:61` s6 默认 7 轮
- [ ] 服务端插件 `server/src/rules/s6.js`：`recordSeasonAction`（s6_king_roll/s6_king_form）、`getGameConfig`（黛青开局 +2）
- [ ] 服务端：`seasonRuleLifecycleService` 支持 S6 上篇赛前王选强制
- [ ] 客户端：`client/src/rules/s6.js`（上篇复用 standard 结算）+ 注册 `rules/index.js`
- [ ] 客户端：`seasonPresets.js` 加 S6 预设（7 轮 BO3）
- [ ] 客户端：`MatchHubView.vue` 王选 Sheet（依次掷骰/同分重投/选形态）
- [ ] 客户端：`ScoringView.vue` ruleId 泛化 + 黛青开局分应用 + 绯红/月白提示
- [ ] 客户端：`S6Rankings.vue` 上篇部分 + `RankingsHubView.vue` 注册
- [ ] 测试：`apiValidation.test.js` ruleId 用例、`matchStateMachine.test.js` 王选/黛青用例
- [ ] 验证：`cd server && npm test`、`cd client && npm run build`、Playwright 截图 S6 上篇页面

## 切片二：下篇组合赛 + 灵魂契合

- [ ] 抽取 `client/src/rules/comboStardust.js`（S4 组合计分共享化，S4 行为不变）
- [ ] 服务端：`roundCreationService.js` S4 分支泛化到 s6（roundNo>=5 固定组合 PA7、拒绝随机）；`roundLifecycleService.calcSeasonChampion` 加 s6 分支（上篇前 4 轮定个人冠军、组合冠军写 `s6.comboChampion`）
- [ ] 客户端：`rules/s6.js` 加组合排名/星尘/tiebreak（引用共享模块）
- [ ] 服务端插件：灵魂契合动作（s6_soul_roll/s6_soul_pick）与选择约束校验；下篇赛前灵魂契合强制
- [ ] 客户端：`MatchHubView.vue` 灵魂契合 Sheet（投 1/2 次、总点数、阶层解锁、选奖、重铸、凯旋/贯穿碎片重投）
- [ ] 客户端：`S6Rankings.vue` 下篇区块（灵魂契合面板、宝库状态、组合星尘榜、最强组合）
- [ ] 测试：`roundCreation.test.js` S6 组合轮 + S4 回归；客户端星尘口径对比 S4 用例
- [ ] 验证：同上 + e2e `season-management.spec.js` 预设列表断言更新

## 切片三：宝库卡效果执行

- [ ] 服务端插件：`s6_card_activate`/`s6_card_use`/`s6_storage_record`/`s6_rift` 动作与次数/窗口校验；爆破局 11 分校验（validateGameEnd）；开局分（天选/存储器）进 getGameConfig
- [ ] 客户端：暗选流程（每局开始前双方录入 → 同时亮出）
- [ ] 客户端：记分页局中提示条（爆破/名刀/绯红/月白）、随时卡使用入口、存储器额外球录入
- [ ] 客户端：结算卡（阻碍/进击/星尘卡）并入星尘计算，高阶优先
- [ ] 客户端：S6Rankings 卡片库存/使用状态完善
- [ ] 测试：卡片全生命周期服务端测试（激活→使用→结算→冲突优先级）；时空裂隙 revert 与第 7 局禁用
- [ ] 验证：全量 `npm test`、`npm run build`、Playwright 完整流程（创建赛季→上篇一轮→下篇一轮含选奖与用卡）

## 验证命令

```bash
cd server && npm test
cd client && npm run build
npx playwright test e2e/smoke.spec.js e2e/season-management.spec.js
```

## 风险文件 / 回滚点

- `roundCreationService.js`、`roundLifecycleService.js`：S4 泛化，改前先确认 S4 回归测试在位
- `client/src/rules/s4.js` 抽取共享模块：纯搬移，diff 应只涉及导出位置
- `ScoringView.vue` ruleId 泛化：注意保持 S5 赛季行为不变（S5 测试赛季可回归验证）
- 每切片一个 commit 点，可独立回滚

## 启动前检查

- [ ] prd.md / design.md / implement.md 已就绪（本文件）
- [ ] 用户已审批规划产物
- [ ] 按 `.trellis/workflow.md` 决定 inline 或 sub-agent 派发；若派发，implement.jsonl / check.jsonl 需先补真实条目（`docs/SEASON_RULE_DESIGN.md`、`server/src/rules/README.md`、本任务 design.md）
