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
