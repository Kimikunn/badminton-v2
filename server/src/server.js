/**
 * Server Entry Point
 */
const app = require('./app');
const config = require('./config/config');
const { initDatabase, closeDatabase } = require('./config/db');
const logger = require('./utils/logger');

let server = null;

async function startServer() {
  try {
    await initDatabase();
    logger.info('数据库连接成功');

    const port = process.env.PORT || config.server.port || 8089;
    server = app.listen(port, () => {
      logger.info(`BAD Club v2 启动成功`);
      logger.info(`  地址: http://localhost:${port}`);
      logger.info(`  环境: ${config.server.env}`);
    });

  } catch (err) {
    logger.error('启动失败: ' + err.message);
    process.exit(1);
  }
}

function gracefulShutdown() {
  logger.info('正在关闭...');

  // 10s 后仍未正常关闭时，强制保存数据库后退出，避免数据丢失
  const forceExit = setTimeout(() => {
    logger.warn('正常关闭超时，强制保存数据库');
    closeDatabase();
    process.exit(1);
  }, 10000);

  if (server) {
    server.close(() => {
      clearTimeout(forceExit);
      closeDatabase();
      process.exit(0);
    });
  } else {
    clearTimeout(forceExit);
    closeDatabase();
    process.exit(0);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();
