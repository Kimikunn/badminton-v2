# BAD Club v2 后端系统优化计划

> 基于 `nodejs-backend-patterns` 最佳实践的系统性分析与渐进式优化路线图

**当前版本**: v2.2.0  
**目标版本**: v2.3.0  
**分析日期**: 2026-05-30

---

## 版本号管理策略

本项目采用**渐进式补丁版本号**管理后端优化过程：

```
v2.2.0  →  当前版本（优化起点）
v2.2.1  →  Phase 1-1: 安全中间件 (helmet + compression)
v2.2.2  →  Phase 1-2: 速率限制 (rate-limit)
v2.2.3  →  Phase 2-1: 自定义 Error 类
v2.2.4  →  Phase 2-2: asyncHandler 消除 try/catch 样板
v2.2.5  →  Phase 2-3: 全局错误处理增强
v2.2.6  →  Phase 3: 结构化日志 (pino)
v2.2.7  →  Phase 4: 增强健康检查
v2.2.8  →  Phase 5-1: 验证中间件化 — 创建规则
v2.2.9  →  Phase 5-2: 验证中间件化 — 迁移路由
v2.2.10 →  Phase 6: 清理未使用依赖
v2.3.0  →  Phase 7: 收尾 — 最终验证、文档更新、整体发布
```

每次提交遵循以下规则：
- **版本号**: `server/package.json` 中的 `version` 字段递增
- **Git Tag**: 每个版本打 `vX.Y.Z` 轻量标签
- **提交信息**: 以 `feat:` 或 `fix:` 开头，描述改动内容

---

## 一、架构概览

### 当前技术栈

| 组件 | 技术选型 | 评价 |
|------|----------|------|
| 运行时 | Node.js 22 | ✅ 最新 LTS |
| 框架 | Express 4.21 | ✅ 稳定成熟 |
| 语言 | JavaScript (CommonJS) | ⚠️ 无类型安全 |
| 数据库 | SQLite via sql.js | ✅ 适合单机部署 |
| 认证 | Admin Token (共享密钥) | ⚠️ 适合信任环境 |
| 测试 | node:test + supertest | ✅ 11 个测试文件 |
| 日志 | console.log 封装 | ❌ 需升级为结构化 |

### 分层架构

```
Routes (Express Router) → Controllers → Services → DB (sql.js)
```

项目已具备清晰的**分层架构**、**Rule 插件系统**、**状态机模式**和**嵌套事务支持**。优化目标是在不破坏现有结构的前提下，补强安全性、可观测性、代码质量和可维护性。

---

## 二、现状评估

### 2.1 做得好的地方 🏅

| # | 领域 | 说明 |
|---|------|------|
| 1 | 分层架构 | Routes → Controllers → Services → DB，职责清晰，无跨层调用 |
| 2 | Rule 插件系统 | `rules/` 的 adapter 模式设计优雅，`normalizeRule` + 默认回退 |
| 3 | 数据库原子写入 | `saveDatabase()` 的 tmp-file + rename 模式是 crash-safe 的 |
| 4 | 嵌套事务 | `transaction()` 的 savepoint 嵌套实现正确 |
| 5 | 时序安全比较 | `writeAuth.js` 使用 `crypto.timingSafeEqual` 防时序攻击 |
| 6 | 状态机 | Season/Round/Match/Game 的状态转换在每个 lifecycle service 中显式定义 |
| 7 | 测试覆盖 | 11 个测试文件覆盖 API、状态机、数据完整性、规则系统、迁移 |
| 8 | 头像上传校验 | Base64 解码后验证 magic bytes，防止文件类型伪造 |

### 2.2 改进领域

| 优先级 | 领域 | 问题 |
|--------|------|------|
| 🔴 高 | 安全 | 缺少 helmet、rate limiting |
| 🔴 高 | 性能 | 缺少 gzip 压缩 |
| 🟡 中 | 日志 | console.log 封装，无结构化字段 |
| 🟡 中 | 错误处理 | 正则匹配 SQLite 错误，无自定义 Error 类 |
| 🟡 中 | 代码质量 | 每个 controller 手动 try/catch，样板代码多 |
| 🟡 中 | 验证 | 验证逻辑在 controller 内部，未中间件化 |
| 🟡 中 | 健康检查 | 仅返回 status:ok，不检查数据库 |
| 🟢 低 | 依赖 | bcryptjs、jsonwebtoken、node-cron 声明但未使用 |
| 🟢 低 | 语言 | JavaScript 无类型安全 |
| 🟢 低 | 模块系统 | CommonJS (非 ESM) |
| 🟢 低 | 依赖注入 | Service 直接 require db 单例 |

---

## 三、优化计划

### Phase 1-1: 安全中间件 — helmet + compression

**版本**: v2.2.0 → v2.2.1  
**优先级**: 🔴 高  
**预计耗时**: 15 分钟

**当前问题**: 应用缺少基础 HTTP 安全头和响应压缩。

**改动**:
```js
// server/src/app.js — 新增两行
const helmet = require('helmet');
const compression = require('compression');

app.use(helmet());
app.use(compression());
```

**依赖安装**:
```bash
cd server && npm install helmet compression
```

**验证**: 请求任一 API，检查响应头是否包含 `X-Content-Type-Options`、`X-Frame-Options` 等 helmet 头，以及 `Content-Encoding: gzip`。

---

### Phase 1-2: 速率限制

**版本**: v2.2.1 → v2.2.2  
**优先级**: 🔴 高  
**预计耗时**: 20 分钟

**当前问题**: 无任何 rate limiting，读接口完全开放，可被恶意请求消耗资源。

**改动**:
```js
// server/src/app.js
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 分钟窗口
  max: 100,                   // 每个 IP 最多 100 次
  standardHeaders: true,      // 返回 RateLimit-* 头
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' }
  }
});

app.use('/api', apiLimiter);
```

**依赖安装**:
```bash
cd server && npm install express-rate-limit
```

**验证**: 短时间内大量请求 `/api/health`，确认超过限额后返回 429 状态码。

---

### Phase 2-1: 自定义 Error 类

**版本**: v2.2.2 → v2.2.3  
**优先级**: 🟡 中  
**预计耗时**: 30 分钟

**当前问题**: 错误处理靠正则匹配 SQLite 消息字符串和 service 返回 `{ notFound: '...' }` 对象，不够语义化。

**改动** — 新建 `server/src/utils/errors.js`:
```js
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'SERVER_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 422, 'VALIDATION_ERROR');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '禁止访问') {
    super(message, 403, 'FORBIDDEN');
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError
};
```

**更新 errorHandler.js** — 优先处理 `AppError` 实例：
```js
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return error(res, err.message, err.code, err.statusCode);
  }
  // 保留原有 SQLite 消息映射作为 fallback
  const mapped = mapError(err);
  error(res, mapped.message, mapped.code, mapped.status);
}
```

**验证**: 现有测试全部通过，无回归。

---

### Phase 2-2: asyncHandler 消除 try/catch 样板

**版本**: v2.2.3 → v2.2.4  
**优先级**: 🟡 中  
**预计耗时**: 30 分钟

**当前问题**: 每个 controller 函数都被手动的 `try { ... } catch (err) { sendControllerError(res, err, 'xxx'); }` 包裹，在 12 个 controller 文件中重复几十次。

**改动** — 新建 `server/src/utils/asyncHandler.js`:
```js
const { error } = require('./response');
const { mapError } = require('./errorHandling');
const logger = require('./logger');

function asyncHandler(fn, context) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      const mapped = mapError(err);
      logger.error(`${context} - ${err.stack || err.message}`);
      return error(res, mapped.message, mapped.code, mapped.status);
    });
  };
}

module.exports = { asyncHandler };
```

**路由注册变化**（以 games 为例）:
```js
// 之前
router.put('/:id/score', ctrl.updateScore);

// 之后
const { asyncHandler } = require('../utils/asyncHandler');
router.put('/:id/score', asyncHandler(ctrl.updateScore, 'games.updateScore'));
```

Controller 函数移除 try/catch 包裹，代码量减少约 30%。

**验证**: 所有现有测试通过。

---

### Phase 2-3: 全局错误处理增强

**版本**: v2.2.4 → v2.2.5  
**优先级**: 🟡 中  
**预计耗时**: 20 分钟

**当前问题**: 全局 error handler 无法区分操作型错误和程序 bug，生产环境可能泄漏堆栈信息。

**改动** — 更新 `errorHandler.js`:
```js
function errorHandler(err, req, res, _next) {
  // 记录所有错误
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });

  // 自定义 AppError
  if (err.isOperational) {
    return error(res, err.message, err.code, err.statusCode);
  }

  // express-validator 错误（兼容）
  if (err.type === 'validation') {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '数据验证失败',
        details: err.errors?.map(e => e.msg)
      }
    });
  }

  // SQLite / 未知错误
  const mapped = mapError(err);
  const message = process.env.NODE_ENV === 'production'
    ? '服务器内部错误'
    : mapped.message;

  error(res, message, mapped.code, mapped.status);
}
```

**验证**: 测试通过；生产环境确认不泄漏内部错误细节。

---

### Phase 3: 结构化日志 (pino)

**版本**: v2.2.5 → v2.2.6  
**优先级**: 🟡 中  
**预计耗时**: 30 分钟

**当前问题**: `logger.js` 仅是对 `console.log` 的薄封装，无结构化字段，无法按字段搜索。

**改动** — 重写 `server/src/utils/logger.js`:
```js
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  })
});

module.exports = logger;
```

**注意**: 保持 `logger.info(msg)` / `logger.error(msg)` 的调用方式不变（pino 兼容），现有代码无需修改。后续逐步迁移到结构化调用 `logger.info({ key: val }, 'msg')`。

**请求日志增强** (`app.js`):
```js
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/api')) return;
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: Date.now() - start
    });
  });
  next();
});
```

**依赖安装**:
```bash
cd server && npm install pino pino-pretty
```

**验证**: 启动服务器，观察日志输出格式变化；`NODE_ENV=production` 时输出 JSON。

---

### Phase 4: 增强健康检查

**版本**: v2.2.6 → v2.2.7  
**优先级**: 🟢 低  
**预计耗时**: 15 分钟

**当前问题**: `/api/health` 只返回 `{ status: 'ok', timestamp }`，不检查数据库连接。

**改动** — 更新 `app.js` 中的健康检查路由:
```js
app.get('/api/health', (_req, res) => {
  const db = require('./config/db');
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (_) { /* database unavailable */ }

  const healthy = dbOk;
  res.status(healthy ? 200 : 503).json({
    success: true,
    data: {
      status: healthy ? 'healthy' : 'degraded',
      version: require('../../package.json').version,
      uptime: Math.floor(process.uptime()),
      checks: {
        database: dbOk ? 'ok' : 'fail'
      },
      timestamp: new Date().toISOString()
    }
  });
});
```

**验证**: 启动后访问 `/api/health`，检查返回字段完整性。

---

### Phase 5-1: 验证中间件化 — 创建规则

**版本**: v2.2.7 → v2.2.8  
**优先级**: 🟢 低  
**预计耗时**: 45 分钟

**当前问题**: 项目依赖中已有 `express-validator`，但验证逻辑在 controller 内部手动调用自定义函数。应将验证提取为声明式路由中间件。

**改动** — 新建 `server/src/middleware/validate.js`:
```js
const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '数据验证失败',
        details: errors.array().map(e => e.msg)
      }
    });
  }
  next();
}

module.exports = { validate };
```

**新建验证规则文件**（以赛季为例 `server/src/validators/seasonValidators.js`）:
```js
const { body } = require('express-validator');

const createSeasonRules = [
  body('name').isString().notEmpty().withMessage('赛季名称不能为空'),
  body('totalRounds').optional().isInt({ min: 1, max: 20 }).withMessage('轮次必须是 1-20'),
  body('participants').optional().isArray().withMessage('选手列表必须是数组'),
  body('ruleId').optional().isIn(['standard', 's2', 's3', 's4', 's5'])
    .withMessage('无效的规则ID'),
];

module.exports = { createSeasonRules };
```

**验证**: 测试通过；手动测试发送无效数据，确认返回 422 + 验证详情。

---

### Phase 5-2: 验证中间件化 — 迁移路由

**版本**: v2.2.8 → v2.2.9  
**优先级**: 🟢 低  
**预计耗时**: 1 小时

**改动**: 为所有资源路由（players, seasons, rounds, matches, games, venues, bookings）创建验证规则文件并注册到路由。

**路由注册示例**:
```js
// server/src/routes/seasons.js
const { createSeasonRules } = require('../validators/seasonValidators');
const { validate } = require('../middleware/validate');
const { asyncHandler } = require('../utils/asyncHandler');

router.post('/', createSeasonRules, validate, asyncHandler(ctrl.create, 'seasons.create'));
```

同时精简 controller 中的手动验证代码。

**验证**: 全部 11 个测试文件通过；无功能回归。

---

### Phase 6: 清理未使用依赖

**版本**: v2.2.9 → v2.2.10  
**优先级**: 🟢 低  
**预计耗时**: 10 分钟

**当前问题**: `bcryptjs`、`jsonwebtoken`、`node-cron` 在 `package.json` 中声明但代码中未实际使用。schema.sql 中 `users` 表也未使用。

**改动**:
```bash
cd server && npm uninstall bcryptjs jsonwebtoken node-cron
```

**注意**: 如果 `users` 表和 JWT 相关依赖是**计划未来使用**的，则保留。否则移除以减少依赖攻击面。

**验证**: `npm test` 通过；`node src/server.js` 正常启动。

---

### Phase 7: 收尾 — v2.3.0 发布

**版本**: v2.2.10 → v2.3.0  
**优先级**: 最终确认  
**预计耗时**: 30 分钟

**改动**:
1. 更新 `server/package.json` version 为 `"2.3.0"`
2. 更新 `CHANGELOG.md`（如有）或创建发布说明
3. 全量回归测试
4. 生产环境验证清单确认
5. Git tag `v2.3.0` + push

**发布检查清单**:
- [ ] `npm test` 全部通过
- [ ] 手动验证所有 API 端点
- [ ] Helmet 安全头确认
- [ ] Compression 生效
- [ ] Rate limiting 限制生效
- [ ] 健康检查返回完整信息
- [ ] 结构化日志正常输出
- [ ] Docker 构建成功 (`docker compose build`)

---

## 四、长期投资（v2.4.0+ 规划）

以下项目由于工作量大或需团队讨论，不在本优化周期内：

| # | 项目 | 说明 | 预计工作量 |
|---|------|------|-----------|
| 1 | TypeScript 迁移 | 渐进式，从 `allowJs: true` 开始 | 2-3 周 |
| 2 | Dependency Injection | 手动 DI 容器或 `awilix` | 1-2 天 |
| 3 | Repository 层抽取 | Service 不再直接写 SQL | 1 周 |
| 4 | ESM 迁移 | CommonJS → ES Modules | 1 天 |
| 5 | API 文档 (OpenAPI/Swagger) | 自动生成 API 文档 | 1-2 天 |
| 6 | 集成测试增强 | 更多边界场景 | 持续 |

---

## 五、优化效果预期

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| HTTP 安全头 | ❌ 无 | ✅ 11 个 helmet 头 |
| 响应体积 | 无压缩 | gzip 压缩，减少 60-80% |
| 恶意请求防护 | ❌ 无限制 | ✅ 15min/100req per IP |
| 日志可搜索性 | 纯文本 | ✅ JSON 结构化 |
| 错误处理 | 正则匹配字符串 | ✅ 语义化 Error 类 |
| Controller 样板代码 | 每个函数 try/catch | asyncHandler 消除重复 |
| 健康检查 | status:ok | ✅ DB 检查 + 版本 + uptime |
| 未使用依赖 | 3 个 | 0 个 |
| 验证方式 | 控制器内手动 | ✅ 路由级声明式 |

---

## 六、回滚策略

每个 phase 独立提交，如出现问题：

```bash
# 回滚单个 phase
git revert <phase-commit-hash>

# 或回到优化前
git checkout v2.2.0
```

由于每个 phase 是独立补丁版本，回滚粒度精确到单个改动。

---

*基于 nodejs-backend-patterns 最佳实践，由 Claude Code 分析生成*

Co-Authored-By: HAPI <noreply@hapi.run>
