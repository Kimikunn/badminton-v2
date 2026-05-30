const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/gamesController');
const { asyncHandler } = require('../utils/asyncHandler');

// Match-specific games: GET /api/matches/:matchId/games
router.get('/', asyncHandler(ctrl.getByMatch, 'games.getByMatch'));

module.exports = router;
