const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/seasonsController');
const actionCtrl = require('../controllers/seasonActionsController');
const s5Ctrl = require('../controllers/s5SeasonActionsController');
const { asyncHandler } = require('../utils/asyncHandler');
const { validate } = require('../middleware/validate');
const { createSeasonRules, updateSeasonRules } = require('../validators/seasonValidators');

router.get('/', asyncHandler(ctrl.getAll, 'seasons.getAll'));
router.post('/', createSeasonRules, validate, asyncHandler(ctrl.create, 'seasons.create'));
router.post('/:id/actions/:actionId', asyncHandler(actionCtrl.recordSeasonAction, 'seasonActions.recordSeasonAction'));
router.post('/:id/s5/pause-uses', asyncHandler(s5Ctrl.recordPauseUse, 's5SeasonActions.recordPauseUse'));
router.post('/:id/s5/debt-settlements', asyncHandler(s5Ctrl.recordDebtSettlement, 's5SeasonActions.recordDebtSettlement'));
router.get('/:id', asyncHandler(ctrl.getById, 'seasons.getById'));
router.put('/:id', updateSeasonRules, validate, asyncHandler(ctrl.update, 'seasons.update'));
router.delete('/:id', asyncHandler(ctrl.remove, 'seasons.remove'));

module.exports = router;
