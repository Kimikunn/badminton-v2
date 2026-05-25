const crypto = require('crypto');

function prefixedId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function seasonId() {
  return prefixedId('S');
}

function roundId() {
  return prefixedId('R');
}

function friendlyMatchId() {
  return prefixedId('F');
}

function venueId() {
  return prefixedId('v');
}

function avatarFilename(ext) {
  return `avatar_${crypto.randomUUID()}.${ext}`;
}

module.exports = {
  prefixedId,
  seasonId,
  roundId,
  friendlyMatchId,
  venueId,
  avatarFilename
};
