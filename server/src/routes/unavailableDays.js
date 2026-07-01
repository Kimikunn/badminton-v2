const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/unavailableDaysController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'unavailableDays.getAll'));
router.post('/', asyncHandler(ctrl.create, 'unavailableDays.create'));
router.delete('/:id', asyncHandler(ctrl.remove, 'unavailableDays.remove'));

module.exports = router;
