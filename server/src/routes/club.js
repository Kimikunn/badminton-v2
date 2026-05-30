const express = require('express');
const router = express.Router();
const { getClub, updateClub } = require('../controllers/clubController');
const { asyncHandler } = require('../utils/asyncHandler');

router.get('/', asyncHandler(getClub, 'club.getClub'));
router.put('/', asyncHandler(updateClub, 'club.updateClub'));

module.exports = router;
