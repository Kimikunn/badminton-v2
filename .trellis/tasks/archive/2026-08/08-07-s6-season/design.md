# S6 技术设计

## 架构总览

沿用 S5 的"客户端计算 + 服务端插件校验/持久化"双层范式：

- **服务端** `server/src/rules/s6.js`：规则插件，负责赛前生命周期校验（王选/灵魂契合强制掷骰）、局配置（开局分/目标分）、卡片动作持久化（`recordSeasonAction`）、局终校验
- **客户端** `client/src/rules/s6.js`：排名/星尘/卡片状态的全部计算，复用 S4 组合计分
- **状态**：全部存 `seasons.comeback_data.s6`（JSON blob），不新增表；逐球/逐局规则事件必要时用既有 `game_rule_events`
- **UI**：`S6Rankings.vue`（展示）+ `MatchHubView.vue`（赛前掷骰）+ `ScoringView.vue`（局开始效果/局中提示）

## comebackData.s6 数据契约

```js
{
  topKings: {
    [roundNo]: {
      rolls: [{ playerId, dice }],   // 含同分重投的追加轮次
      kingId,
      form: 'daiqing' | 'feihong' | 'yuebai' | null
    }
  },
  seeds: { A, B, C, D },              // 上篇前 4，缺省时客户端按上篇排名推导（同 S4 getComboSeedMap）
  soulBond: {
    [roundNo]: {
      [comboLabel]: {                 // 'AB' | 'AC' | 'AD' | 'CD' | 'BD' | 'BC'
        rolls: [{ playerId, dice, rollChoice: 1|2, used }],
        total,                        // 含同点 +1
        unlockTier: 1|2|3|'chosen',   // 3-6/7-9/10-12/13
        picks: [{ playerId, cardId }],// 受一人 1 次、同点后投者 2 次约束
        rerollsUsed: [{ playerId, source: 'triumph'|'s5_shard' }]
      }
    }
  },
  treasury: {
    [comboLabel]: {
      inventory: { [cardId]: remainingUses },
      activations: [{ cardId, roundId, matchId, gameId?, revealed, payload? }]
    }
  },
  storageCarry: { [matchId]: { side: 'a'|'b', points } },  // 存储器带入下一局
  comboChampion: { players: [...] }   // 赛季完结时写入（同 S4）
}
```

## 卡片目录（client 与 server 共享常量，`client/src/rules/s6Cards.js` 或并入 s6.js）

| id | 名 | 阶层 | 次数 | 启用条件 | 生命周期 | 效果实现 |
|---|---|---|---|---|---|---|
| pause | 暂停卡 | 1 | 3 | 随时 | 局中记录 | 仅记录使用 |
| blade | 名刀 | 1 | 3 | 随时 | 局中记录 | 记录 + 记分页提示"下一球对方得分无效" |
| block | 阻碍 | 1 | 1 | 局前暗选 | 结算 | 对方本局获胜不产生终结 +3 |
| charge | 进击 | 1 | 1 | 局前暗选 | 结算 | 本局获胜连胜计数额外 +1 |
| pause_plus | 高级暂停卡 | 2 | 3 | 随时 | 局中记录 | 记录（发球方/场地为线下行为） |
| reforge | 重铸 | 2 | - | 立刻 | 选奖流程 | 重投一次骰子二选一，占用一次选择 |
| storage | 存储器 | 2 | 2 | 局前暗选 | 局开始 | 本局胜/负后录额外 5/3 球得分，下一局开局自动加分 |
| rift | 时空裂隙 | 3 | 1 | 局前暗选 | 局开始 | 调 `POST /games/:id/revert` 回溯 1-2 局；第 7 局完成后禁用 |
| stardust | 星尘卡 | 3 | 1 | 局前暗选 | 结算 | 本局胜 +2 星尘、净胜 ≥7 再 +1；负则对方一次连胜不计 |
| blast | 爆破 | 3 | 2 | 局前暗选 | 局开始+局中 | 本局目标分 11（局终校验），提示"每球 2 分" |
| chosen | 天选 | 天选 | 自动 | 达成即触发 | 局开始 | 该组合本场每局开局 2:0 |

冲突裁决：同局双方激活的结算卡冲突时，高阶层先生效（D 自规则注）。

## 服务端设计

### 规则插件 `server/src/rules/s6.js`（实现 `rules/README.md` 接口）
- `getGameConfig(ctx)`：按 comebackData 计算本局 `{ targetScore: 11|21, openingScoreA/B }`——开局分来源：黛青（王所在方 +2，上篇）、天选（+2，下篇该组合所有局）、存储器 carry（一次性，应用后清除）
- `validateGameEnd`：爆破局 11 分制校验；其余走 standard 21 分制
- `recordSeasonAction`：动作集 `s6_king_roll`、`s6_king_form`、`s6_soul_roll`、`s6_soul_pick`、`s6_card_activate`、`s6_card_use`、`s6_storage_record`、`s6_rift`；每个动作校验合法性（次数、启用窗口、选择约束）后返回 `{ nextData }`
- 局前生命周期：`seasonRuleLifecycleService` 泛化——S6 上篇轮次要求 `topKing` 掷骰完成、下篇轮次要求所有组合 `soulBond` 完成才允许创建轮次（类比 S5 roundDice 强制）

### 轮次创建
- 泛化 `roundCreationService.js:84-98` 的 S4 分支为 `(rule_id === 's4' || rule_id === 's6') && roundNo >= 5`：固定组合 PA7 对阵、拒绝随机。S6 种子从 `s6.seeds` 或上篇排名推导
- `seasonService.js:61`：s6 默认 `totalRounds: 7`

### 白名单
`constants.js` RULE_ID 加 `S6`；`seasonValidators.js`、`utils/validators.js:135` RULE_IDS 加 `'s6'`；`rules/index.js` 注册 s6 插件。

## 客户端设计

### `client/src/rules/s6.js`
- 上篇：`calcPlayerScore`/`calcRankings` 复用 standard 大分小分；`getSeasonBuffStatus` 返回王选/形态状态
- 下篇：**直接复用 S4 导出**——将 `s4.js` 中 `calcComboRoundStats`/`sortComboRankings`/`getComboGamePointDiffChain`/`getComboTieStatus` 抽为共享模块 `client/src/rules/comboStardust.js`，s4/s6 共同引用（不改 S4 行为，纯抽取）
- 结算卡修正：在 combo stats 之上叠加 `treasury.activations` 的效果（阻碍/进击/星尘卡），产出修正后星尘与标注
- `lifecycle`：`beforeRound` 按上/下篇分别要求王选/灵魂契合（供 MatchHubView 驱动）

### `S6Rankings.vue`（遵循 SEASON_RULE_DESIGN 因果链）
1. 上篇：轮次王选面板（每轮骰子 + 王 + 形态 chip，点击开 Sheet）→ 上篇排名（复用 RankingRow）
2. 阶段进度条（同 S4Rankings 样式）
3. 下篇：灵魂契合面板（每轮每组合总点数 + 解锁阶层）→ 宝库奖励/卡片库存状态 → 组合星尘榜（复用 S4 组合行样式）→ 最强组合卡
4. 规则 Sheet 中性色（`bg-surface-hover` + `border-line-light`），赛季名不进卡片标题

### `MatchHubView.vue`
- 创建 S6 轮次前：上篇走王选 Sheet（4 人依次掷骰、同分重投、选形态），下篇走灵魂契合 Sheet（逐组合双方掷骰、选奖、重铸/重投）；结果随 `beforeRoundSetup` 或服务端动作持久化
- S6 组合轮禁用随机对阵（同 S4）

### `ScoringView.vue`
- 把硬编码 `'s5'` 改为按当前赛季 `ruleId` 取 `getGameConfig`
- 局开始：展示并应用开局分（黛青/天选/存储器）；局前暗选入口（双方录入 → 亮出）
- 局中：生效中的爆破/名刀/绯红/月白提示条
- 局结束：存储器额外球得分录入（胜 5 球/负 3 球）

## 兼容与迁移

- 不改 S1-S5 任何行为；`comboStardust.js` 抽取须保持 S4 测试与页面表现不变
- 无 DB 迁移（复用 comeback_data + game_rule_events）
- S6 赛季创建沿用 `VITE_ENABLE_SEASON_CREATE` flag 流程（`docs/WORKFLOW_EXAMPLES.md`）

## 风险与回滚

- 最大风险点：卡片结算修正与 S4 星尘口径的一致性 → 用共享模块 + 单元测试锁定
- 服务端泛化 S4 分支时不得改变 S4 既有赛季行为 → `roundCreation.test.js` 补 S4 回归用例
- 每个切片独立可回滚：切片二/三均为增量，出问题可只回退对应 commit
