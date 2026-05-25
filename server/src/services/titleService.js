const { prepare } = require('../config/db');

function listTitles() {
  return prepare('SELECT * FROM titles ORDER BY sort_order').all();
}

function listPlayerTitles() {
  return prepare(`SELECT pt.*, t.name, t.level, t.condition_desc as conditionDesc
    FROM player_titles pt
    JOIN titles t ON pt.title_id = t.id
    ORDER BY pt.player_id, t.sort_order`).all();
}

function formatPlayerTitles(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.player_id]) grouped[row.player_id] = [];
    grouped[row.player_id].push({
      id: row.title_id,
      name: row.name,
      level: row.level,
      conditionDesc: row.conditionDesc,
      awardedAt: row.awarded_at
    });
  }
  return grouped;
}

module.exports = {
  listTitles,
  listPlayerTitles,
  formatPlayerTitles
};
