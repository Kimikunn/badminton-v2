const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/venuesController');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { createVenueRules, updateVenueRules } = require('../validators/venueValidators');

router.get('/', asyncHandler(ctrl.getAll, 'venues.getAll'));
router.post('/', createVenueRules, validate, asyncHandler(ctrl.create, 'venues.create'));
router.put('/:id', updateVenueRules, validate, asyncHandler(ctrl.update, 'venues.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'venues.remove'));

module.exports = router;
