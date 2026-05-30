const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/titlesController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'titles.getAll'));
router.get('/all-players', asyncHandler(ctrl.getAllPlayerTitles, 'titles.getAllPlayerTitles'));

module.exports = router;
