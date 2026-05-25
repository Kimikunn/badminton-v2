const express = require('express');
const router = express.Router();
const { getAll, getById, update } = require('../controllers/playersController');

router.get('/', getAll);
router.get('/:id', getById);
router.put('/:id', update);

module.exports = router;
