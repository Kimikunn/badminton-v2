# 后端规则插件接口

后端规则插件负责裁决一局比赛如何结束，以及一局结束或撤回后是否需要写入规则事件。

规则入口统一通过 `server/src/rules/index.js` 注册。业务代码应使用 `getRule(ruleId)` 获取规则，不直接引用具体规则文件。

## 插件结构

```js
module.exports = {
  id: 's5',
  getGameConfig(ctx) {},
  validateGameEnd(ctx, input) {},
  afterGameCompleted(ctx, result, input) {},
  onGameReverted(ctx) {},
  afterRoundRecalculated(ctx) {},
  recordSeasonAction(ctx, actionId, input) {}
};
```

## Hook 说明

`getGameConfig(ctx)`

- 返回当前局的记分配置。
- 常用字段：
  - `scoringMode`：记分模式，例如 `standard` 或 `resistance`。
  - `targetScore`：目标分。
  - `maxScore`：封顶分。
  - `requiresWinner`：是否需要手动指定胜方。
  - `supportsPierce`：是否支持贯穿等额外规则输入。

`validateGameEnd(ctx, input)`

- 校验当前比分是否可以结束。
- 必须返回：

```js
{ canEnd: true, winner: 'a', reason: '' }
{ canEnd: false, winner: null, reason: '错误原因' }
```

`afterGameCompleted(ctx, result, input)`

- 一局结束后调用。
- 用于写入规则事件、重算规则派生数据等副作用。
- 可选 hook；未实现时默认为 no-op。

`onGameReverted(ctx)`

- 已完成局被撤回时调用。
- 用于删除规则事件、回滚规则派生数据等副作用。
- 可选 hook；未实现时默认为 no-op。

`afterRoundRecalculated(ctx)`

- 轮次状态被重算后调用。
- 用于处理轮次结束后的派生数据，例如 S5 异变轮次的债务记录。
- 可选 hook；未实现时默认为 no-op。

`recordSeasonAction(ctx, actionId, input)`

- 赛季主动技能/动作入口，对应 `POST /api/seasons/:id/actions/:actionId`。
- 用于记录可主动使用的赛季能力，例如 S5 贯穿暂停、异变债务结算。
- 必须返回 `{ nextData }` 写回 `season.comeback_data`，或返回 `{ validationError: '...' }`。
- 可选 hook；未实现时默认返回“当前赛季不支持该操作”。

## 上下文

`ctx` 由 `gameService` 构建，包含：

- `game`：当前局记录。
- `match`：所属比赛记录。
- `round`：所属轮次记录，友谊赛可能为空。
- `season`：所属赛季记录，友谊赛可能为空。
- `ruleId`：当前规则 ID，缺省为 `standard`。
- `gameConfig`：当前规则返回的局配置。
- `rule`：当前规则对象。
- `recordSeasonAction` 额外收到 `data`（解析后的 `comeback_data`）和 `helpers`（`prefixedId`、`normalizeNote`、`parseJson`、`nowIso`）。

## 注册约定

- S1 使用 `standard`。
- S2/S3/S4 当前后端仍映射到 `standard`，前端规则面板独立展示。
- S5 使用 `s5`，支持 15 分异变局、21 分抵抗局、异变债务、抵抗和贯穿事件。
- 新规则应先在 `constants.RULE_ID` 增加枚举，再在 `rules/index.js` 注册。

`rules/adapter.js` 会为缺失的可选 hook 填充 no-op，并为缺失的核心 hook 回退到标准规则，避免插件不完整导致运行时异常。
