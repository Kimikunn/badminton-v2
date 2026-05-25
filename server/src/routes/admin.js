const express = require('express')
const router = express.Router()
const { resetDb } = require('../controllers/adminController')

router.post('/reset-db', resetDb)

module.exports = router
