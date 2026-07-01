const { prepare, transaction } = require('../config/db');
const { success, validationError } = require('../utils/response');
const { prefixedId } = require('../utils/id');

function getAll(req, res) {
  const rows = prepare('SELECT * FROM unavailable_days ORDER BY date DESC').all();
  success(res, rows);
}

function create(req, res) {
  const { playerId, date } = req.body;
  if (!playerId || !date) return validationError(res, 'playerId 和 date 必填');

  // Check not past
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return validationError(res, '不能标记过去的日期');

  const existing = prepare(
    'SELECT id FROM unavailable_days WHERE player_id = ? AND date = ?'
  ).get(playerId, date);
  if (existing) return validationError(res, '该日已标记不可用');

  const id = prefixedId('UD');
  const result = transaction(() => {
    // If there are bookings on this date, delete them
    const bookings = prepare(
      'SELECT id FROM booking_records WHERE date = ?'
    ).all(date);

    for (const b of bookings) {
      prepare('DELETE FROM booking_records WHERE id = ?').run(b.id);
    }

    prepare(
      'INSERT INTO unavailable_days (id, player_id, date) VALUES (?, ?, ?)'
    ).run(id, playerId, date);

    return { id, playerId, date, deletedBookings: bookings.length };
  });

  success(res, result, 201);
}

function remove(req, res) {
  const row = prepare('SELECT * FROM unavailable_days WHERE id = ?').get(req.params.id);
  if (!row) return success(res, { deleted: false });

  prepare('DELETE FROM unavailable_days WHERE id = ?').run(req.params.id);
  success(res, { deleted: true, date: row.date });
}

module.exports = { getAll, create, remove };
