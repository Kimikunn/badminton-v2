const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gamesController');

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.put('/:id/score', ctrl.updateScore);
router.post('/:id/end', ctrl.endGame);
router.post('/:id/revert', ctrl.revertGame);
router.post('/:id/update-completed-score', ctrl.updateCompletedScore);

module.exports = router;
