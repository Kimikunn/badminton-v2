# PRD：S7-王权之续（新增赛季类型）

## 背景
用户在 master（原始 UI，cfb6267）要求新增 S7 赛季类型：
- 名称：S7-王权之续；主题色 FF770F（橙焰）；对比色 000026
- 规则：与 S6 下半赛季（组合赛阶段）完全一致——灵魂契合 + 王之宝库 + 组合星尘
- 赛制：3 轮比赛（每轮 1 场 2v2 组合赛，PA7）

## 设计决策
- **复用方式**：copy-adapt（用户认可复用）。server/client 各自以 s6.js 为底本
  派生 s7.js：组合轮 1-3（原 5-7 平移）、无上篇/王选/王权/凯旋重投、数据键
  comebackData.s7、动作 id s7_soul_roll / s7_soul_pick / s7_card_activate /
  s7_card_use。s6 模块零改动（e2e 全量保护）。
- **组合轮换**（同 S6 固定轮换平移）：R1=AB/CD、R2=AC/BD、R3=AD/BC。
- **种子 A-D**：沿用 S6 下篇缺省口径——参赛选手按 playerId 排序持久化
  （首次灵魂投掷时落 comebackData.s7.seeds）。如需「继承上一赛季名次」后续再议。
- **每轮赛前要求**：两个组合的灵魂契合全部完成（掷骰+选奖）才能创建轮次
  （同 S6 下篇，服务端 lifecycle 校验）。
- **主题色**：useSeasonTheme 增 sunset 色板（FF770F → oklch），对比色 000026
  经 --season-contrast 下发（默认季回落 fg-inverse）；SEASON_COLOR_OPTIONS +
  seasonPresets 登记（S7 预设 color='sunset'，totalRounds=3）。

## Acceptance
- [ ] 服务端：RULE_ID.S7 + rules/s7.js（组合赛状态机）+ lifecycle/roundCreation
      挂接 + validators 白名单；现有 server 测试套件 0 fail
- [ ] 客户端：rules/s7.js + 注册 + seasonPresets + S7Rankings + MatchHub（s7 组合流）
      + ScoringView（s7 宝库/暗选）+ 主题色
- [ ] e2e：新增 s7 全流程 spec（建季→灵魂契合→建轮→开赛→记分→星尘/宝库呈现）；
      全量套件绿
- [ ] spec 回填：rules 注册模式注记

## Notes
- 赛季名由 SeasonPresetManager 自动生成：S7-王权之续
- S7 的 comebackData 键 = s7；规则接口方法与 s6 同名同义（除王选族）


## 增量记录：道具卡双生命周期重构（2026-09-28，s6/s7 一起改 + 公共提取）

- 用户反馈：①暗选应为每局硬门控（每局比赛前 4 人录入后才能开始）；
  ②名刀等随时卡实际玩法是局后结算使用。
- 服务端抽取共享模块 `rules/comboCardFlow.js`（卡目录/局前暗选/局后补记/
  存储器/裂隙/开局门控/爆破校验/组合开局分），s6.js 与 s7.js 薄包装（仅
  轮次边界与数据键）；规则接口新增 `canStartGame`（adapter 透传），由
  matchLifecycleService.recalculateMatch（自动推进）与 startMatch 控制器
  （比赛开始）调用实现硬门控。
- 记录语义：局前=pre_game（不变）；随时卡→局后记录 post_game（兼容旧
  timing='anytime' 展示），s6_card_use/s7_card_use 带 gameNo 且该局必须已完赛。
- 客户端：`rules/comboCards.js` 共享常量/展示工具（activationState 兼容双
  timing）；ScoringView 新增局后结算面板（局后补记带 gameNo）与「开始第 N 局」
  门控按钮；S6/S7Rankings 展示兼容。
- 测试：server 225 passed（卡牌语义更新：s6Treasury 逐局推进+局后补记重写；
  s6SoulBond/s7Flow 补局间暗选推进）；e2e s6-combo/s6-treasury/s6-top/s7
  全部更新为门控流（submitNullPicks + 逐局 resume）后 4 spec passed；
  全量默认 92 passed/32 skipped 不变。
