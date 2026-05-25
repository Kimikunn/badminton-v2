const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');
const { venueId } = require('../utils/id');

function formatVenue(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    hourlyRate: row.hourly_rate,
    notes: row.notes,
    createdAt: row.created_at
  };
}

function listVenues() {
  return prepare('SELECT * FROM venues ORDER BY name').all();
}

function getVenueById(id) {
  return prepare('SELECT * FROM venues WHERE id = ?').get(id);
}

function createVenue(data) {
  const id = venueId();
  prepare('INSERT INTO venues (id, name, address, hourly_rate, notes) VALUES (?, ?, ?, ?, ?)')
    .run(id, data.name.trim(), data.address || '', data.hourlyRate || 0, data.notes || '');
  return getVenueById(id);
}

function updateVenue(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    name: { column: 'name', transform: value => value.trim() },
    address: 'address',
    hourlyRate: 'hourly_rate',
    notes: 'notes'
  });

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
  deleteVenue
};
