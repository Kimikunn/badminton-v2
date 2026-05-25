const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/titlesController');

router.get('/', ctrl.getAll);
router.get('/all-players', ctrl.getAllPlayerTitles);

module.exports = router;
