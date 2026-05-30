const express = require('express');
const router = express.Router();
const { getAll, getById, update } = require('../controllers/playersController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(getAll, 'players.getAll'));
router.get('/:id', asyncHandler(getById, 'players.getById'));
router.put('/:id', asyncHandler(update, 'players.update'));

module.exports = router;
