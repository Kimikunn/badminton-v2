const { prepare } = require('../config/db');
const { parseJson, stringifyJson } = require('../utils/json');
const { buildUpdate } = require('../utils/updateBuilder');
const { bookingRecordId } = require('../utils/id');

function formatConfig(row) {
  return {
    rotation: parseJson(row.rotation, []),
    currentPersonIndex: row.current_person_index,
    updatedAt: row.updated_at
  };
}

function formatRecord(row) {
  return {
    id: row.id,
    playerId: row.player_id,
    venueId: row.venue_id,
    venueName: row.venue_name,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    cost: row.cost,
    notes: row.notes,
    createdAt: row.created_at
  };
}

function playerExists(playerId) {
  return !!prepare('SELECT id FROM players WHERE id = ?').get(playerId);
}

function venueExists(venueId) {
  return !!prepare('SELECT id FROM venues WHERE id = ?').get(venueId);
}

function missingPlayerIds(playerIds = []) {
  const missing = [];
  for (const playerId of playerIds) {
    if (!playerExists(playerId)) missing.push(playerId);
  }
  return missing;
}

function getConfigRow() {
  return prepare('SELECT * FROM booking_config WHERE id = 1').get();
}

function getConfig() {
  return formatConfig(getConfigRow());
}

function updateConfig(patch) {
  if (patch.rotation !== undefined) {
    prepare('UPDATE booking_config SET rotation = ? WHERE id = 1').run(stringifyJson(patch.rotation));
  }
  if (patch.currentPersonIndex !== undefined) {
    prepare('UPDATE booking_config SET current_person_index = ? WHERE id = 1').run(patch.currentPersonIndex);
  }
  return getConfig();
}

function listRecords() {
  return prepare(`SELECT br.*, v.name as venue_name
    FROM booking_records br
    LEFT JOIN venues v ON br.venue_id = v.id
    ORDER BY br.date DESC, br.created_at DESC`).all();
}

function getRecordById(id) {
  return prepare(`SELECT br.*, v.name as venue_name
    FROM booking_records br
    LEFT JOIN venues v ON br.venue_id = v.id
    WHERE br.id = ?`).get(id);
}

function createRecord(data) {
  const id = bookingRecordId();
  prepare('INSERT INTO booking_records (id, player_id, venue_id, date, start_time, end_time, cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, data.playerId, data.venueId || null, data.date, data.startTime || '', data.endTime || '', data.cost || 0, data.notes || '');

  const config = getConfigRow();
  const rotation = parseJson(config.rotation, []);
  if (rotation.length > 0) {
    const nextIdx = (config.current_person_index + 1) % rotation.length;
    prepare('UPDATE booking_config SET current_person_index = ? WHERE id = 1').run(nextIdx);
  }

  return getRecordById(id);
}

function updateRecord(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    playerId: 'player_id',
    venueId: 'venue_id',
    date: 'date',
    startTime: 'start_time',
    endTime: 'end_time',
    cost: 'cost',
    notes: 'notes'
  });

  if (sets.length) {
    params.push(id);
    prepare(`UPDATE booking_records SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getRecordById(id);
}

function deleteRecord(id) {
  const config = getConfigRow();
  const rotation = parseJson(config.rotation, []);
  if (rotation.length > 0) {
    const prevIdx = config.current_person_index === 0
      ? rotation.length - 1
      : config.current_person_index - 1;
    prepare('UPDATE booking_config SET current_person_index = ? WHERE id = 1').run(prevIdx);
  }
  prepare('DELETE FROM booking_records WHERE id = ?').run(id);
  return { deleted: true };
}

module.exports = {
  formatRecord,
  playerExists,
  venueExists,
  missingPlayerIds,
  getConfig,
  updateConfig,
  listRecords,
  getRecordById,
  createRecord,
  updateRecord,
  deleteRecord
};
