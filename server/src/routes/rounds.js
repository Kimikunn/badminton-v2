const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roundsController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'rounds.getAll'));
router.post('/', asyncHandler(ctrl.create, 'rounds.create'));
router.get('/:id', asyncHandler(ctrl.getById, 'rounds.getById'));
router.put('/:id', asyncHandler(ctrl.update, 'rounds.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'rounds.remove'));

module.exports = router;
