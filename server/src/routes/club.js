const express = require('express');
const router = express.Router();
const { getClub, updateClub } = require('../controllers/clubController');

router.get('/', getClub);
router.put('/', updateClub);

module.exports = router;
