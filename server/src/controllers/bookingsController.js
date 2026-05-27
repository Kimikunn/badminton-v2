const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const bookingService = require('../services/bookingService');
const venueService = require('../services/venueService');
const {
  validateDateText,
  validateNonNegativeNumber,
  validatePositiveInteger,
  validateStringArray,
  validateText,
  validateTimeText
} = require('../utils/validators');

// === Bookings ===

function validatePlayerRef(playerId, label, options = {}) {
  const error = validateText(playerId, label, { required: options.required, maxLength: 80 });
  if (error || playerId === undefined || playerId === null) return error;
  return bookingService.playerExists(playerId) ? null : `${label}不存在`;
}

function validateVenueRef(venueId, options = {}) {
  const error = validateText(venueId, '场地ID', { required: options.required, maxLength: 120 });
  if (error || venueId === undefined || venueId === null || venueId === '') return error;
  return bookingService.venueExists(venueId) ? null : '场地不存在';
}

function validateBookingRecordPayload(body, options = {}) {
  const { partial = false } = options;

  const playerError = validatePlayerRef(body.playerId, '订场人', { required: !partial });
  if (playerError) return playerError;

  const venueError = validateVenueRef(body.venueId);
  if (venueError) return venueError;

  const dateError = validateDateText(body.date, '订场日期', { required: !partial });
  if (dateError) return dateError;

  const startError = validateTimeText(body.startTime, '开始时间');
  if (startError) return startError;

  const endError = validateTimeText(body.endTime, '结束时间');
  if (endError) return endError;

  if (body.startTime && body.endTime && body.startTime >= body.endTime) {
    return '结束时间必须晚于开始时间';
  }

  const costError = validateNonNegativeNumber(body.cost, '订场费用', { max: 100000 });
  if (costError) return costError;

  const notesError = validateText(body.notes, '订场备注', { maxLength: 500, allowEmpty: true });
  if (notesError) return notesError;

  return null;
}

function getConfig(req, res) {
  try {
    success(res, bookingService.getConfig());
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

function updateConfig(req, res) {
  try {
    const { rotation, currentPersonIndex } = req.body;
    const rotationError = validateStringArray(rotation, '订场轮换名单', { max: 32 });
    if (rotationError) return validationError(res, rotationError);

    const missingPlayers = bookingService.missingPlayerIds(rotation || []);
    if (missingPlayers.length) return validationError(res, `订场轮换选手不存在：${missingPlayers.join('、')}`);

    const currentConfig = bookingService.getConfig();
    const nextRotation = rotation !== undefined ? rotation : currentConfig.rotation;
    const indexError = validatePositiveInteger(
      currentPersonIndex === undefined ? undefined : currentPersonIndex + 1,
      '当前轮换序号',
      { max: Math.max(nextRotation.length, 1) }
    );
    if (indexError) return validationError(res, '当前轮换序号必须是有效的数组索引');

    success(res, bookingService.updateConfig({ rotation, currentPersonIndex }));
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

function getRecords(req, res) {
  try {
    const rows = bookingService.listRecords();
    success(res, rows.map(bookingService.formatRecord));
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

function resolveCost(venueId, date, startTime, endTime, explicitCost) {
  if (explicitCost !== undefined && explicitCost !== null && explicitCost !== 0) return explicitCost;
  if (!venueId || !date || !startTime || !endTime) return 0;
  const venue = venueService.getVenueById(venueId);
  if (!venue) return 0;
  const pricing = venue.pricing ? JSON.parse(venue.pricing) : [];
  const rate = venueService.matchPricing(pricing, date, startTime, endTime);
  const sh = parseInt((startTime || '').split(':')[0], 10);
  const eh = parseInt((endTime || '').split(':')[0], 10);
  const hours = Math.max(eh - sh, 1);
  return rate * hours;
}

function createRecord(req, res) {
  try {
    const { playerId, venueId, date, startTime, endTime, cost, notes } = req.body;
    const payloadError = validateBookingRecordPayload(req.body);
    if (payloadError) return validationError(res, payloadError);

    const finalCost = resolveCost(venueId, date, startTime, endTime, cost);
    const row = bookingService.createRecord({ playerId, venueId, date, startTime, endTime, cost: finalCost, notes });
    success(res, bookingService.formatRecord(row), 201);
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

function updateRecord(req, res) {
  try {
    const existing = bookingService.getRecordById(req.params.id);
    if (!existing) return notFound(res, '记录不存在');
    const { playerId, venueId, date, startTime, endTime, cost, notes } = req.body;
    const payloadError = validateBookingRecordPayload(req.body, { partial: true });
    if (payloadError) return validationError(res, payloadError);

    const finalDate = date ?? existing.date;
    const finalStart = startTime ?? existing.start_time;
    const finalEnd = endTime ?? existing.end_time;
    const finalVenue = venueId ?? existing.venue_id;
    const finalCost = resolveCost(finalVenue, finalDate, finalStart, finalEnd, cost);
    const row = bookingService.updateRecord(req.params.id, { playerId, venueId, date, startTime, endTime, cost: finalCost, notes });
    success(res, bookingService.formatRecord(row));
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

function deleteRecord(req, res) {
  try {
    const existing = bookingService.getRecordById(req.params.id);
    if (!existing) return notFound(res, '记录不存在');
    success(res, bookingService.deleteRecord(req.params.id));
  } catch (err) { sendControllerError(res, err, 'bookingsController'); }
}

module.exports = { getConfig, updateConfig, getRecords, createRecord, updateRecord, deleteRecord };
