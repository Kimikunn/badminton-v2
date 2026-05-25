const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bookingsController');
const venuesCtrl = require('../controllers/venuesController');

// Backward-compatible venue routes. Prefer /api/venues for new code.
router.get('/venues', venuesCtrl.getAll);
router.post('/venues', venuesCtrl.create);
router.put('/venues/:id', venuesCtrl.update);
router.delete('/venues/:id', venuesCtrl.remove);

// Booking config
router.get('/config', ctrl.getConfig);
router.put('/config', ctrl.updateConfig);

// Booking records
router.get('/records', ctrl.getRecords);
router.post('/records', ctrl.createRecord);
router.put('/records/:id', ctrl.updateRecord);
router.delete('/records/:id', ctrl.deleteRecord);

module.exports = router;
