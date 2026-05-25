const fs = require('fs')
const path = require('path')
const { closeDatabase, initDatabase } = require('../config/db')
const { success } = require('../utils/response')

const DB_DIR = path.join(__dirname, '..', '..', 'database')

async function resetDb(req, res) {
  const prodPath = path.join(DB_DIR, 'badminton.db')
  const testPath = path.join(DB_DIR, 'test.db')

  if (!fs.existsSync(prodPath)) {
    return res.status(400).json({ success: false, error: { message: '生产数据文件不存在' } })
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
    return res.status(500).json({ success: false, error: { message: '数据重置失败: ' + err.message } })
  }
}

module.exports = { resetDb }
