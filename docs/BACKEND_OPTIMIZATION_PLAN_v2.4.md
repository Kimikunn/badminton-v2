# BAD Club v2 后端优化计划 v2.4.0

> 基于 `nodejs-backend-patterns` 最佳实践的第二轮后端深化优化

**当前版本**: v2.3.3  
**目标版本**: v2.4.0  
**日期**: 2026-05-30

---

## 版本号管理策略

```
v2.3.3  →  当前版本（v2.3.0 优化已完成）
v2.3.4  →  Phase 1: ESM 模块化迁移
v2.3.5  →  Phase 2: Repository 层抽取
v2.3.6  →  Phase 3: Service 单元测试基础设施
v2.3.7  →  Phase 4: API 文档 (OpenAPI/Swagger)
v2.4.0  →  Phase 5: 收尾发布
```

---

## 一、v2.3.0 回顾

v2.3.0 完成了基础设施层的全面升级：

| 领域 | 成果 |
|------|------|
| 安全 | helmet 安全头 + rate-limit 速率限制 |
| 性能 | gzip 响应压缩 |
| 可观测性 | pino 结构化日志 + 增强健康检查 |
| 错误处理 | 自定义 Error 类 + asyncHandler + 生产安全模式 |
| 代码质量 | -74 行 try/catch 样板 + 验证中间件 |
| 依赖 | 清理 3 个未使用包 |

v2.4.0 将深入**架构层**：模块系统现代化 → 数据访问分离 → 可测试性 → 文档化。

---

## 二、Phase 1: ESM 模块化迁移

**版本**: v2.3.3 → v2.3.4  
**风险**: 🟡 低（机械性改动，逐文件迁移）

### 问题

项目使用 CommonJS (`require` / `module.exports`)，而 Node.js 22 对 ESM 有完整支持。ESM 的优势：
- 静态 `import` 可被工具分析（tree-shaking、dead code detection）
- 与前端代码风格统一（Vue/Vite 使用 ESM）
- 顶层 `await` 支持

### 改动

1. `server/package.json` 添加 `"type": "module"`
2. 所有 `require()` → `import`，`module.exports` → `export`
3. `__dirname` → `import.meta.url` + `fileURLToPath`
4. `__filename` → `import.meta.url`
5. JSON 文件导入：`import config from './config.json' with { type: 'json' }` 或 `createRequire`

### 迁移顺序

```
utils/     → 底层工具（无内部依赖）
config/    → 配置模块
middleware/ → 中间件（依赖 utils）
routes/    → 路由（依赖 controllers）
controllers/ → 控制器（依赖 services）
services/  → 业务层（依赖 config/db）
server.js  → 入口（依赖 app.js）
app.js     → 最后（依赖所有）
```

### 验证
```bash
cd server && npm test  # 69 tests must pass
node src/server.js      # manual smoke test
```

---

## 三、Phase 2: Repository 层抽取

**版本**: v2.3.4 → v2.3.5  
**风险**: 🟡 低（内部重构，API 契约不变）

### 问题

当前 Service 层直接编写 raw SQL：

```js
// seasonService.js (当前)
function getSeasonById(id) {
  return prepare('SELECT * FROM seasons WHERE id = ?').get(id);
}
```

问题：
- SQL 散落在 18 个 service 文件中，难以统一优化
- Service 层无法脱离数据库做单元测试
- 同一查询模式（findById、list、create、update、delete）在不同 service 中重复

### 改动

为每个核心实体抽取 Repository，Service 只处理业务逻辑：

```
server/src/
├── repositories/
│   ├── baseRepository.js     # 通用 CRUD 基类
│   ├── seasonRepository.js   # 赛季数据访问
│   ├── matchRepository.js    # 比赛数据访问
│   ├── gameRepository.js     # 局数据访问
│   ├── roundRepository.js    # 轮次数据访问
│   ├── playerRepository.js   # 选手数据访问
│   ├── venueRepository.js    # 场地数据访问
│   ├── bookingRepository.js  # 订场数据访问
│   └── titleRepository.js    # 称号数据访问
```

**Repository 示例**：

```js
// repositories/baseRepository.js
export class BaseRepository {
  constructor(table, idField = 'id') {
    this.table = table;
    this.idField = idField;
  }

  findById(id) {
    return prepare(`SELECT * FROM ${this.table} WHERE ${this.idField} = ?`).get(id);
  }

  list(orderBy = 'created_at DESC') {
    return prepare(`SELECT * FROM ${this.table} ORDER BY ${orderBy}`).all();
  }

  delete(id) {
    return prepare(`DELETE FROM ${this.table} WHERE ${this.idField} = ?`).run(id);
  }
}
```

**Service 重构前 vs 后**：

```js
// 重构前: service 直接写 SQL
function getSeasonById(id) {
  return prepare('SELECT * FROM seasons WHERE id = ?').get(id);
}

// 重构后: service 调用 repository
const seasonRepo = new SeasonRepository();

export function getSeasonById(id) {
  return seasonRepo.findById(id);
}
```

### 验证
```bash
cd server && npm test  # 69 tests must pass (API 响应不变)
```

---

## 四、Phase 3: Service 单元测试基础设施

**版本**: v2.3.5 → v2.3.6  
**风险**: 🟢 极低（新增测试，不修改业务代码）

### 问题

当前 11 个测试文件全部是集成测试（通过 HTTP 调用），没有 Service 层的纯单元测试。这导致：
- 测试运行慢（每个测试文件创建完整数据库 + schema + migration）
- 难以覆盖业务逻辑边界条件（需要构造复杂 HTTP 请求）
- Service 层的 Bug 要通过 Controller → Route → HTTP 链路才能发现

### 改动

利用 Phase 2 的 Repository 抽取，实现 Service 的可测试性：

```js
// services/scoringService.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canEndGame, checkMatchComplete } from '../services/scoringService.js';

describe('canEndGame', () => {
  it('accepts standard 21-point wins', () => {
    assert.equal(canEndGame(21, 15, { targetScore: 21 }), true);
  });

  it('rejects scores below target', () => {
    assert.equal(canEndGame(20, 15, { targetScore: 21 }), false);
  });

  it('handles deuce (needs 2-point lead)', () => {
    assert.equal(canEndGame(22, 21, { targetScore: 21 }), false);
    assert.equal(canEndGame(23, 21, { targetScore: 21 }), true);
  });
});
```

**新增测试文件**：

| 文件 | 内容 |
|------|------|
| `test/unit/scoringService.test.js` | 计分规则（canEndGame, checkMatchComplete） |
| `test/unit/rules.test.js` | 规则插件系统（已有，加强） |
| `test/unit/roundCreation.test.js` | 轮次创建逻辑 |
| `test/unit/validators.test.js` | 验证函数（validateScorePatch 等） |
| `test/unit/seasonService.test.js` | 赛季业务逻辑 |

### 验证
```bash
cd server && npm test  # 新增单元测试 + 原有 69 个集成测试
node --test test/unit/*.test.js  # 单元测试单独运行（快速）
```

---

## 五、Phase 4: API 文档 (OpenAPI/Swagger)

**版本**: v2.3.6 → v2.3.7  
**风险**: 🟢 极低（纯文档生成，不影响业务）

### 问题

当前无 API 文档。新开发者或外部工具集成时需要阅读源码了解接口。

### 方案

使用 `swagger-jsdoc` + `swagger-ui-express` 从 JSDoc 注释自动生成 OpenAPI 文档：

```bash
cd server && npm install swagger-jsdoc swagger-ui-express
```

```js
// app.js
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'BAD Club API', version: '2.4.0' },
    servers: [{ url: '/api' }]
  },
  apis: ['./src/routes/*.js']  // 从 JSDoc 注释生成
});

// 仅在非生产环境暴露文档
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
```

```js
// routes/seasons.js — JSDoc 标注
/**
 * @openapi
 * /seasons:
 *   get:
 *     summary: 获取所有赛季
 *     responses:
 *       200:
 *         description: 赛季列表
 *   post:
 *     summary: 创建新赛季
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateSeason'
 */
router.get('/', asyncHandler(ctrl.getAll, 'seasons.getAll'));
```

### 验证
```bash
# 访问 http://localhost:8090/api/docs 查看 Swagger UI
```

---

## 六、优化效果预期

| 指标 | v2.3.3 | v2.4.0 |
|------|--------|--------|
| 模块系统 | CommonJS | **ESM** |
| 数据访问 | Service 内嵌 SQL | **Repository 层** |
| 单元测试 | 0 个纯单元测试 | **5+ Service 单元测试** |
| API 文档 | 无 | **Swagger UI (`/api/docs`)** |
| Service 可测试性 | 依赖 db 单例 | **Repository 可注入** |
| 代码复用 | SQL 模式重复 | **BaseRepository 通用 CRUD** |

---

## 七、长期展望 (v2.5.0+)

| 项目 | 说明 |
|------|------|
| TypeScript 迁移 | 从 `allowJs: true` 开始渐进迁移 |
| DI 容器 | `awilix` 或手动 DI，正式实现依赖注入 |
| 集成测试加速 | SQLite 内存模式，避免文件 I/O |
| 请求超时 | `express-timeout` 或自定义超时中间件 |
| 错误追踪 | Sentry / 自定义错误聚合 |

---

## 八、回滚策略

每个 Phase 独立 git commit + tag。回滚命令：

```bash
git revert <phase-commit-hash>
docker compose -p badminton up -d --build
```

---

*基于 nodejs-backend-patterns 最佳实践，由 Claude Code 分析生成*

Co-Authored-By: HAPI <noreply@hapi.run>
