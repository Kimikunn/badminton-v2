const express = require('express')
const router = express.Router()
const { resetDb } = require('../controllers/adminController')
const { asyncHandler } = require('../utils/asyncHandler')

router.post('/reset-db', asyncHandler(resetDb, 'admin.resetDb'))

module.exports = router
