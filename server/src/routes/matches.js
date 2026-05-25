const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/matchesController');

router.get('/', ctrl.getAll);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getById);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/start', ctrl.startMatch);
router.post('/:id/cancel', ctrl.cancelMatch);

module.exports = router;
