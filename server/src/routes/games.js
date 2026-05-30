const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gamesController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'games.getAll'));
router.get('/:id', asyncHandler(ctrl.getOne, 'games.getOne'));
router.put('/:id/score', asyncHandler(ctrl.updateScore, 'games.updateScore'));
router.post('/:id/end', asyncHandler(ctrl.endGame, 'games.endGame'));
router.post('/:id/revert', asyncHandler(ctrl.revertGame, 'games.revertGame'));
router.post('/:id/update-completed-score', asyncHandler(ctrl.updateCompletedScore, 'games.updateCompletedScore'));

module.exports = router;
