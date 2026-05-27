const { success, notFound, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { validateNonNegativeNumber, validateText } = require('../utils/validators');
const venueService = require('../services/venueService');

function validatePricing(pricing) {
  if (!Array.isArray(pricing)) return '价格配置必须是数组';
  if (!pricing.length) return '价格配置不能为空';
  for (let i = 0; i < pricing.length; i++) {
    const s = pricing[i];
    if (typeof s !== 'object' || !s) return `时段 ${i + 1} 格式错误`;
    if (s.startHour === undefined || s.endHour === undefined || s.rate === undefined) {
      return `时段 ${i + 1} 缺少 startHour、endHour 或 rate`;
    }
    if (!Number.isInteger(s.startHour) || s.startHour < 0 || s.startHour > 23) return `时段 ${i + 1} 开始小时无效`;
    if (!Number.isInteger(s.endHour) || s.endHour < 1 || s.endHour > 24) return `时段 ${i + 1} 结束小时无效`;
    if (s.endHour <= s.startHour) return `时段 ${i + 1} 结束时间必须晚于开始时间`;
    const rateErr = validateNonNegativeNumber(s.rate, `时段 ${i + 1} 价格`, { max: 10000 });
    if (rateErr) return rateErr;
    if (s.days !== undefined) {
      if (!Array.isArray(s.days)) return `时段 ${i + 1} days 必须是数组`;
      if (!s.days.length) return `时段 ${i + 1} days 不能为空`;
      const validDays = new Set([1, 2, 3, 4, 5, 6, 7]);
      for (const d of s.days) {
        if (!validDays.has(d)) return `时段 ${i + 1} 无效的星期: ${d}（仅限 1-7）`;
      }
    }
  }
  return null;
}

function validateVenuePayload(body, options = {}) {
  const { partial = false } = options;
  const nameError = validateText(body.name, '场地名称', { required: !partial, maxLength: 80 });
  if (nameError) return nameError;

  const addressError = validateText(body.address, '场地地址', { maxLength: 200, allowEmpty: true });
  if (addressError) return addressError;

  if (body.pricing !== undefined) {
    const pricingError = validatePricing(body.pricing);
    if (pricingError) return pricingError;
  } else if (!partial) {
    return '价格配置不能为空';
  }

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
