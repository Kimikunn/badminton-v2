const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { validateNonNegativeNumber, validateText } = require('../utils/validators');
const venueService = require('../services/venueService');

function validateVenuePayload(body, options = {}) {
  const { partial = false } = options;
  const nameError = validateText(body.name, '场地名称', { required: !partial, maxLength: 80 });
  if (nameError) return nameError;

  const addressError = validateText(body.address, '场地地址', { maxLength: 200, allowEmpty: true });
  if (addressError) return addressError;

  const rateError = validateNonNegativeNumber(body.hourlyRate, '场地时租', { max: 10000 });
  if (rateError) return rateError;

  const notesError = validateText(body.notes, '场地备注', { maxLength: 500, allowEmpty: true });
  if (notesError) return notesError;

  return null;
}

function getAll(req, res) {
  try {
    const rows = venueService.listVenues();
    success(res, rows.map(venueService.formatVenue));
  } catch (err) { sendControllerError(res, err, 'venuesController'); }
}

function create(req, res) {
  try {
    const payloadError = validateVenuePayload(req.body);
    if (payloadError) return validationError(res, payloadError);

    const row = venueService.createVenue(req.body);
    success(res, venueService.formatVenue(row), 201);
  } catch (err) { sendControllerError(res, err, 'venuesController'); }
}

function update(req, res) {
  try {
    const existing = venueService.getVenueById(req.params.id);
    if (!existing) return notFound(res, '场地不存在');

    const payloadError = validateVenuePayload(req.body, { partial: true });
    if (payloadError) return validationError(res, payloadError);

    const row = venueService.updateVenue(req.params.id, req.body);
    success(res, venueService.formatVenue(row));
  } catch (err) { sendControllerError(res, err, 'venuesController'); }
}

function remove(req, res) {
  try {
    const existing = venueService.getVenueById(req.params.id);
    if (!existing) return notFound(res, '场地不存在');

    success(res, venueService.deleteVenue(req.params.id));
  } catch (err) { sendControllerError(res, err, 'venuesController'); }
}

module.exports = {
  getAll,
  create,
  update,
  remove
};
