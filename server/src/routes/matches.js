const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/matchesController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'matches.getAll'));
router.post('/', asyncHandler(ctrl.create, 'matches.create'));
router.get('/:id', asyncHandler(ctrl.getById, 'matches.getById'));
router.put('/:id', asyncHandler(ctrl.update, 'matches.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'matches.remove'));
router.post('/:id/start', asyncHandler(ctrl.startMatch, 'matches.startMatch'));
router.post('/:id/cancel', asyncHandler(ctrl.cancelMatch, 'matches.cancelMatch'));

module.exports = router;
