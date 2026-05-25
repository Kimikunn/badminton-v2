const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const DEFAULT_PLAYERS = ['p1', 'p2', 'p3', 'p4'];

function inferMatchFormat(bestOf) {
  if (bestOf === 1) return 'bo1';
  if (bestOf === 7) return 'pa7';
  return 'bo3';
}

function createTestHarness(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DB_PATH = path.join(tempDir, 'test.db');
  process.env.NODE_ENV = 'test';

  const app = require('../../src/app');
  const { initDatabase, closeDatabase, prepare } = require('../../src/config/db');
  const api = request(app);

  async function setupTestDb({ players = [] } = {}) {
    await initDatabase();
    if (players.length) insertPlayers(players);
  }

  function closeTestDb() {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  function insertPlayers(ids = DEFAULT_PLAYERS) {
    for (const id of ids) {
      prepare('INSERT INTO players (id, name) VALUES (?, ?)').run(id, id);
    }
  }

  function insertSeason(input) {
    const options = typeof input === 'string' ? { id: input } : input;
    const {
      id,
      ruleId = 'standard',
      bestOf = 3,
      totalRounds = 7,
      status = 'ongoing',
      participants = DEFAULT_PLAYERS,
      comebackData = null,
      color = null
    } = options;

    prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id, comeback_data, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        options.name || `Season ${id}`,
        totalRounds,
        bestOf,
        status,
        JSON.stringify(participants),
        ruleId,
        comebackData ? JSON.stringify(comebackData) : null,
        color
      );
  }

  function insertS5Season(id, roundDice = { 1: { dice: 1, mode: 'mutation' } }) {
    insertSeason({
      id,
      ruleId: 's5',
      totalRounds: 10,
      comebackData: { s5: { roundDice, pierceCounts: {}, debtRecords: {}, pauseUses: [], debtSettlements: {} } },
      color: 'red'
    });
  }

  function insertRound(id, seasonId, status = 'pending', roundNo = 1) {
    prepare('INSERT INTO rounds (id, season_id, round_no, status) VALUES (?, ?, ?, ?)')
      .run(id, seasonId, roundNo, status);
  }

  function insertMatch(input) {
    const options = typeof input === 'string'
      ? { id: input, seasonId: arguments[1], roundId: arguments[2], bestOf: arguments[3], status: arguments[4], winner: arguments[5], matchFormat: arguments[6] }
      : input;
    const {
      id,
      seasonId = null,
      roundId = null,
      bestOf = 3,
      status = 'pending',
      winner = null,
      matchFormat = inferMatchFormat(bestOf),
      teamA = ['p1', 'p2'],
      teamB = ['p3', 'p4'],
      date = '2026-05-23'
    } = options;

    prepare(`INSERT INTO matches (id, season_id, round_id, type, team_a, team_b, best_of, match_format, status, winner, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        seasonId,
        roundId,
        'doubles',
        JSON.stringify(teamA),
        JSON.stringify(teamB),
        bestOf,
        matchFormat,
        status,
        winner,
        date
      );
  }

  function getDbMatch(id) {
    return prepare('SELECT * FROM matches WHERE id = ?').get(id);
  }

  function getDbRound(id) {
    return prepare('SELECT * FROM rounds WHERE id = ?').get(id);
  }

  function getDbGames(matchId) {
    return prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no').all(matchId);
  }

  function getDbMatchesByRound(roundId) {
    return prepare('SELECT * FROM matches WHERE round_id = ? ORDER BY id').all(roundId);
  }

  async function startMatch(id) {
    await api.post(`/api/matches/${id}/start`).expect(200);
    return getDbGames(id);
  }

  async function finishGame(gameId, scoreA, scoreB, payload = {}) {
    await api.put(`/api/games/${gameId}/score`).send({ scoreA, scoreB }).expect(200);
    await api.post(`/api/games/${gameId}/end`).send(payload).expect(200);
  }

  return {
    app,
    api,
    tempDir,
    prepare,
    setupTestDb,
    closeTestDb,
    insertPlayers,
    insertSeason,
    insertS5Season,
    insertRound,
    insertMatch,
    getDbMatch,
    getDbRound,
    getDbGames,
    getDbMatchesByRound,
    startMatch,
    finishGame
  };
}

module.exports = {
  createTestHarness,
  DEFAULT_PLAYERS
};
