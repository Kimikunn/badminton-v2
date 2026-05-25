const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/seasonsController');
const actionCtrl = require('../controllers/seasonActionsController');
const s5Ctrl = require('../controllers/s5SeasonActionsController');

router.get('/', ctrl.getAll);
router.post('/', ctrl.create);
router.post('/:id/actions/:actionId', actionCtrl.recordSeasonAction);
router.post('/:id/s5/pause-uses', s5Ctrl.recordPauseUse);
router.post('/:id/s5/debt-settlements', s5Ctrl.recordDebtSettlement);
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
