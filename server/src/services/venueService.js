const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');
const { venueId } = require('../utils/id');
const { parseJson, stringifyJson } = require('../utils/json');

function formatVenue(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    pricing: parseJson(row.pricing, []),
    notes: row.notes,
    createdAt: row.created_at
  };
}

const DAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

/**
 * Match the applicable rate for a given date + time range.
 * Date is YYYY-MM-DD, start/end are HH:MM strings.
 * Returns the matched rate (number) or 0 if no match.
 */
function matchPricing(pricing, dateStr, startTime, endTime) {
  if (!Array.isArray(pricing) || !pricing.length) return 0

  const sh = parseInt((startTime || '').split(':')[0], 10)
  const eh = parseInt((endTime || '').split(':')[0], 10)
  if (isNaN(sh) || isNaN(eh) || eh <= sh) return 0

  // Determine day of week: 1=Mon ... 7=Sun
  let dow = 1
  try {
    const d = new Date(dateStr + 'T12:00:00')
    dow = d.getDay() === 0 ? 7 : d.getDay()
  } catch { /* keep default */ }

  // Find the first pricing slot that covers the selected hours on the given day
  for (const slot of pricing) {
    const days = slot.days || [1, 2, 3, 4, 5, 6, 7]
    if (!days.includes(dow)) continue
    if (sh >= (slot.startHour || 0) && eh <= (slot.endHour || 24)) {
      return slot.rate || 0
    }
  }

  // Fallback: return rate from first slot matching the day, regardless of hour coverage
  for (const slot of pricing) {
    const days = slot.days || [1, 2, 3, 4, 5, 6, 7]
    if (days.includes(dow)) return slot.rate || 0
  }

  return 0
}

/**
 * Human-readable price range, e.g. "¥45~65/h"
 */
function pricingLabel(pricing) {
  if (!Array.isArray(pricing) || !pricing.length) return ''
  const rates = pricing.map(s => s.rate).filter(r => typeof r === 'number')
  if (!rates.length) return ''
  const lo = Math.min(...rates)
  const hi = Math.max(...rates)
  return lo === hi ? `¥${lo}/h` : `¥${lo}~${hi}/h`
}

function listVenues() {
  return prepare('SELECT * FROM venues ORDER BY name').all();
}

function getVenueById(id) {
  return prepare('SELECT * FROM venues WHERE id = ?').get(id);
}

function createVenue(data) {
  const id = venueId();
  const pricing = Array.isArray(data.pricing) ? stringifyJson(data.pricing) : '[]';
  prepare('INSERT INTO venues (id, name, address, pricing, notes) VALUES (?, ?, ?, ?, ?)')
    .run(id, data.name.trim(), data.address || '', pricing, data.notes || '');
  return getVenueById(id);
}

function updateVenue(id, patch) {
  const fieldMap = {
    name: { column: 'name', transform: value => value.trim() },
    address: 'address',
    notes: 'notes'
  };

  const { sets, params } = buildUpdate(patch, fieldMap);

  // Pricing is handled separately (needs JSON serialization)
  if (patch.pricing !== undefined) {
    sets.push('pricing = ?');
    params.push(stringifyJson(Array.isArray(patch.pricing) ? patch.pricing : []));
  }

  if (sets.length) {
    params.push(id);
    prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getVenueById(id);
}

function deleteVenue(id) {
  prepare('DELETE FROM venues WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = {
  formatVenue,
  listVenues,
  getVenueById,
  createVenue,
  updateVenue,
  deleteVenue,
  matchPricing,
  pricingLabel,
  DAY_LABELS
};
