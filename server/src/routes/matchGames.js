const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/gamesController');

// Match-specific games: GET /api/matches/:matchId/games
router.get('/', ctrl.getByMatch);

module.exports = router;
