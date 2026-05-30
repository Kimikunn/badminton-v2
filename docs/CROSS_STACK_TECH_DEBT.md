# 跨端/后端待处理问题清单

> 创建日期：2026-05-25  
> 目的：记录前端优化过程中发现、但不适合在当前前端优化点内直接解决的后端边界、兼容路由、接口设计、数据模型和跨端一致性问题。后续进行后端重构或接口整理时，应优先检查本文档。

---

## 0. 使用规则

当出现以下情况时，记录到本文档：

1. 前端优化时发现后端接口边界不清晰。
2. 前端只能绕开或兼容，但根因在后端/跨端契约。
3. 为避免破坏现有数据或旧客户端，暂时不能删除的兼容逻辑。
4. 前后端重复实现，未来可能不一致。
5. 当前能修，但会扩大本轮优化范围，不适合顺手改。

每条问题需要包含：

- 发现来源
- 当前状态
- 风险
- 建议处理方案
- 何时处理
- 验证方式

---

## 1. 状态说明

| 状态 | 含义 |
|---|---|
| OPEN | 已记录，未处理 |
| IN_PROGRESS | 正在处理 |
| RESOLVED | 已解决 |
| WONTFIX | 明确不处理 |

---

## 2. 问题清单

### CS-001：`/api/bookings/venues` 兼容路由仍保留，场地 API 边界需要最终收敛

- **状态**：OPEN
- **发现来源**：
  - P1-05a 前端优化：将场地前端 API 从 `/api/bookings/venues` 统一到 `/api/venues`。
- **相关文件**：
  - `server/src/routes/bookings.js`
  - `server/src/routes/venues.js`
  - `server/src/controllers/venuesController.js`
  - `client/src/stores/venues.js`
  - `client/src/views/VenueView.vue`
- **当前状态**：
  - 后端正式场地 API 已存在：
    ```text
    GET    /api/venues
    POST   /api/venues
    PUT    /api/venues/:id
    DELETE /api/venues/:id
    ```
  - 但后端仍在 bookings 路由下保留兼容入口：
    ```text
    GET    /api/bookings/venues
    POST   /api/bookings/venues
    PUT    /api/bookings/venues/:id
    DELETE /api/bookings/venues/:id
    ```
  - 前端已切换到 `/api/venues`，不再使用 `/api/bookings/venues`。
- **为什么会有这个问题**：
  - 早期 `VenueView.vue` 同时承载“场地管理”和“订场记录/轮换”，场地 CRUD 被挂到 `/bookings/venues` 下。
  - 但领域边界上：
    - `venues` 是独立资源。
    - `bookings` 是订场配置和订场记录。
  - 后端后来新增了 `/api/venues`，但为了兼容旧前端保留了旧路径。
- **风险**：
  - 后续维护者可能误以为 `/api/bookings/venues` 仍是推荐入口。
  - API 文档和实际入口可能分叉。
  - 如果未来两个入口实现不再共用 controller，可能产生行为差异。
- **建议处理方案**：
  1. 短期：继续保留兼容路由，但在代码注释和文档中明确标记 deprecated。
  2. 中期：增加启动日志或测试，确认前端不再调用 `/api/bookings/venues`。
  3. 长期：确认没有旧客户端依赖后，删除 `/api/bookings/venues` 兼容路由。
- **何时处理**：
  - 后端 API 整理/版本化时。
  - 或准备发布破坏性变更前。
- **验证方式**：
  - 前端静态搜索：
    ```bash
    rg "bookings/venues" client/src
    ```
    应无结果。
  - 后端测试：
    - 删除兼容路由前，确认 `/api/venues` CRUD 测试覆盖完整。
  - E2E：
    - 场地列表、新增、编辑、删除均走 `/api/venues`。

---

### CS-002：创建轮次 pairings 规则已跨端联动，未来建议后端提供预览能力

- **状态**：OPEN
- **发现来源**：
  - P0-02 修正：前端随机预览 pairings 后，后端按提交 pairings 创建比赛。
- **相关文件**：
  - `client/src/views/MatchHubView.vue`
  - `server/src/controllers/roundsController.js`
  - `server/src/services/roundCreationService.js`
  - `server/test/roundCreation.test.js`
- **当前状态**：
  - 前端负责随机生成标准轮次 pairings。
  - 后端负责验证 pairings 并按提交结果创建比赛。
  - S4 第 5-7 轮组合赛仍由后端固定规则生成，前端镜像一份用于预览。
- **风险**：
  - 标准轮次随机 pairings 的“生成规则”在前端。
  - S4 组合赛的预览逻辑在前端镜像后端 `getS4ComboPairing()`。
  - 后端未来调整规则时，前端预览可能再次漂移。
- **建议处理方案**：
  - 增加后端预览接口，例如：
    ```text
    POST /api/rounds/preview
    ```
    输入：
    ```json
    {
      "seasonId": "S1",
      "roundNo": 1,
      "randomSeed": "... 可选 ..."
    }
    ```
    输出：
    ```json
    {
      "pairings": [
        { "teamA": ["p1", "p2"], "teamB": ["p3", "p4"] }
      ],
      "matchFormat": "bo3",
      "bestOf": 3
    }
    ```
  - 或者后端提供 `generatePairings` 的可测试共享契约，前端只负责展示。
- **何时处理**：
  - 当创建轮次交互继续增强，如手动调整、锁定某组搭档、按历史搭档次数均衡时。
- **验证方式**：
  - 后端单元测试覆盖 preview 与 create 生成一致。
  - Playwright 对比预览列表与创建后的真实比赛列表一致。

---

### CS-003：前后端记分验证逻辑重复实现，存在长期漂移风险

- **状态**：OPEN
- **发现来源**：
  - 阅读 `client/src/composables/useScoringValidation.js` 与 `server/src/services/scoringService.js`。
- **相关文件**：
  - `client/src/composables/useScoringValidation.js`
  - `server/src/services/scoringService.js`
  - `server/src/rules/*`
  - `client/src/rules/*`
- **当前状态**：
  - 前端和后端都实现了局分结束判断。
  - 前端用于实时提示和按钮状态。
  - 后端用于最终裁决。
- **风险**：
  - 新赛季规则或封顶规则变化时，前后端可能不一致。
  - 用户可能在前端看到“可结束”，但后端拒绝；或相反。
- **建议处理方案**：
  - 短期：建立共享测试用例表，前后端各自跑同一组输入/输出。
  - 中期：将规则描述抽成 JSON contract，例如 targetScore/maxScore/scoringMode/winnerOverride。
  - 长期：考虑把纯规则函数提取为可前后端共享的包，或由后端提供规则验证 dry-run API。
- **何时处理**：
  - 在拆分 `ScoringView.vue` 或新增 S2/S3/S4 后端规则时。
- **验证方式**：
  - 前后端对同一批比分用例输出一致。
  - Playwright 覆盖非法比分提示与后端拒绝结果一致。

---

