const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bookingsController');
const venuesCtrl = require('../controllers/venuesController');
const { asyncHandler } = require('../utils/asyncHandler');

// Backward-compatible venue routes. Prefer /api/venues for new code.
router.get('/venues', asyncHandler(venuesCtrl.getAll, 'venues.getAll'));
router.post('/venues', asyncHandler(venuesCtrl.create, 'venues.create'));
router.put('/venues/:id', asyncHandler(venuesCtrl.update, 'venues.update'));
router.delete('/venues/:id', asyncHandler(venuesCtrl.remove, 'venues.remove'));

// Booking config
router.get('/config', asyncHandler(ctrl.getConfig, 'bookings.getConfig'));
router.put('/config', asyncHandler(ctrl.updateConfig, 'bookings.updateConfig'));

// Booking records
router.get('/records', asyncHandler(ctrl.getRecords, 'bookings.getRecords'));
router.post('/records', asyncHandler(ctrl.createRecord, 'bookings.createRecord'));
router.put('/records/:id', asyncHandler(ctrl.updateRecord, 'bookings.updateRecord'));
router.delete('/records/:id', asyncHandler(ctrl.deleteRecord, 'bookings.deleteRecord'));

module.exports = router;
