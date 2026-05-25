const { prepare } = require('../config/db');
const { buildUpdate } = require('../utils/updateBuilder');

const DEFAULT_CLUB = { id: 1, name: 'BAD Club', description: '', avatar: null };

function getClub() {
  return prepare('SELECT * FROM club WHERE id = 1').get() || DEFAULT_CLUB;
}

function updateClub(patch) {
  const { sets, params } = buildUpdate(patch, {
    name: 'name',
    description: 'description',
    avatar: 'avatar'
  });

  if (sets.length > 0) {
    prepare(`UPDATE club SET ${sets.join(', ')} WHERE id = 1`).run(...params);
  }

  return getClub();
}

module.exports = {
  getClub,
  updateClub
};
