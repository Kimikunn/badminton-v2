/**
 * 结构化日志 — pino
 *
 * 基于 nodejs-backend-patterns 结构化日志模式。
 * - 开发环境: pino-pretty 彩色输出
 * - 生产环境: JSON 行输出（可被 ELK/Datadog 等系统采集）
 *
 * 保持与旧 logger.js 完全兼容的 API：
 *   logger.info(msg)        — 文本日志
 *   logger.info(obj, msg)   — 结构化日志
 *   logger.error(msg)
 *   logger.warn(msg)
 *   logger.debug(msg)
 */
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
