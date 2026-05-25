const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');

function formatPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    racket: row.racket,
    shoes: row.shoes,
    displayedTitleId: row.displayed_title_id
  };
}

function listPlayers() {
  return prepare('SELECT * FROM players ORDER BY id').all();
}

function getPlayerById(id) {
  return prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function titleExists(id) {
  return !!prepare('SELECT id FROM titles WHERE id = ?').get(id);
}

function updatePlayer(id, patch) {
  const { sets, params } = buildUpdate(patch, {
    name: 'name',
    avatar: 'avatar',
    racket: 'racket',
    shoes: 'shoes',
    displayedTitleId: 'displayed_title_id'
  });

  if (sets.length > 0) {
    params.push(id);
    prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getPlayerById(id);
}

module.exports = {
  formatPlayer,
  listPlayers,
  getPlayerById,
  titleExists,
  updatePlayer
};
