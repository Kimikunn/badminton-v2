const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/venuesController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(ctrl.getAll, 'venues.getAll'));
router.post('/', asyncHandler(ctrl.create, 'venues.create'));
router.put('/:id', asyncHandler(ctrl.update, 'venues.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'venues.remove'));

module.exports = router;
