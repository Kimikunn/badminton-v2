const fs = require('fs')
const path = require('path')
const { closeDatabase, initDatabase } = require('../config/db')
const { success, error } = require('../utils/response')

const DB_DIR = path.join(__dirname, '..', '..', 'database')

function isTestDbPath(dbPath) {
  return path.basename(path.resolve(dbPath || '')) === 'test.db'
}

async function resetDb(req, res) {
  if (process.env.ENABLE_TEST_FEATURES !== 'true') {
    return error(res, '测试功能未启用', 'TEST_FEATURES_DISABLED', 403)
  }

  if (!isTestDbPath(process.env.DB_PATH)) {
    return error(res, '当前数据库不是测试库，拒绝重置', 'NOT_TEST_DATABASE', 403)
  }

  const prodPath = path.join(DB_DIR, 'badminton.db')
  const testPath = path.resolve(process.env.DB_PATH)

  if (!fs.existsSync(prodPath)) {
    return error(res, '生产数据文件不存在', 'PROD_DB_NOT_FOUND', 400)
  }

  try {
    // Close current DB (saves before closing)
    closeDatabase()

    // Copy prod data → test data
    fs.copyFileSync(prodPath, testPath)

    // Re-open with the new test data
    await initDatabase()

    return success(res, { message: '已从生产数据恢复测试环境' })
  } catch (err) {
    // Try to reopen DB even on error
    try { await initDatabase() } catch { /* ignore */ }
    return error(res, '数据重置失败: ' + err.message, 'RESET_DB_FAILED', 500)
  }
}

module.exports = { resetDb }
