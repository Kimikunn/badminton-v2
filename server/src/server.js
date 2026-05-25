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
  if (server) {
    server.close(() => { closeDatabase(); process.exit(0); });
  } else {
    closeDatabase();
    process.exit(0);
  }
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();
