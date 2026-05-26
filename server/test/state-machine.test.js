/**
 * State Machine Test — table-driven
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestHarness, DEFAULT_PLAYERS } = require('./helpers/backendTestHarness');

const h = createTestHarness('badminton-sm-');
let _seq = 0;
function uid(p) { return `T-${p}-${++_seq}`; }

before(async () => { await h.setupTestDb({ players: DEFAULT_PLAYERS }); });
after(() => { h.closeTestDb(); });

// ═══ Helpers ═══
async function completeAllGames(matchId) {
  let games = h.getDbGames(matchId);
  while (games.some(g => g.status === 'in_progress')) {
    const g = games.find(g2 => g2.status === 'in_progress');
    await h.finishGame(g.id, 21, 15);
    games = h.getDbGames(matchId);
  }
  return games;
}

// ═══════════════════════════════════════════════
// Season
// ═══════════════════════════════════════════════
describe('Season', () => {
  const transitions = [
    { name: 'pending → ongoing (first round created)',  from: 'pending',   via: 'create_round',        to: 'ongoing' },
    { name: 'ongoing → completed (all rounds done)',     from: 'ongoing',  via: 'complete_all_rounds',  to: 'completed' },
    { name: 'completed → ongoing (game reverted)',       from: 'completed',via: 'revert_last_game',     to: 'ongoing' },
    { name: 'ongoing → pending (all rounds deleted)',    from: 'ongoing',  via: 'delete_all_rounds',    to: 'pending' },
  ];

  for (const { name, from, via, to } of transitions) {
    it(name, async () => {
      const sid = uid('S');

      // ═══ Setup ═══
      h.insertSeason({ id: sid, ruleId: 'standard', totalRounds: from === 'completed' ? 1 : 2, status: from });

      if (from === 'ongoing' && via !== 'delete_all_rounds') {
        // Pre-create 1 round so season shows as active
        await h.api.post('/api/rounds').send({ seasonId: sid, roundNo: 1 });
      }

      if (from === 'completed') {
        // Insert directly: 1 round, 1 completed match, 1 completed game
        h.insertRound('DBG-RD', sid, 'completed', 1);
        h.insertMatch({ id: 'DBG-M', seasonId: sid, roundId: 'DBG-RD', bestOf: 1, matchFormat: 'bo1', status: 'completed', winner: 'a' });
        h.prepare("INSERT INTO games (id, match_id, game_no, score_a, score_b, winner, status) VALUES ('DBG-G','DBG-M',1,21,15,'a','completed')").run();
        h.prepare("UPDATE seasons SET status='completed' WHERE id=?", sid).run();
      }

      // ═══ Trigger ═══
      if (via === 'create_round') {
        await h.api.post('/api/rounds').send({ seasonId: sid, roundNo: 1 });
      }

      if (via === 'complete_all_rounds') {
        // Round 1 already exists from setup. Complete it first.
        let rounds = h.prepare("SELECT id FROM rounds WHERE season_id=? ORDER BY round_no").all(sid);
        for (const rd of rounds) {
          const matches = h.getDbMatchesByRound(rd.id);
          for (const m of matches) {
            await h.startMatch(m.id);
            await completeAllGames(m.id);
          }
        }
        // Now create and complete round 2
        await h.api.post('/api/rounds').send({ seasonId: sid, roundNo: 2 });
        rounds = h.prepare("SELECT id FROM rounds WHERE season_id=? ORDER BY round_no").all(sid);
        for (const rd of rounds) {
          const matches = h.getDbMatchesByRound(rd.id);
          for (const m of matches) {
            if (m.status === 'pending') await h.startMatch(m.id);
            await completeAllGames(m.id);
          }
        }
      }

      if (via === 'revert_last_game') {
        await h.api.post('/api/games/DBG-G/revert');
      }

      if (via === 'delete_all_rounds') {
        const { deleteRound } = require('../src/services/roundService');
        await h.api.post('/api/rounds').send({ seasonId: sid, roundNo: 1 });
        const rounds = h.prepare("SELECT * FROM rounds WHERE season_id=?").all(sid);
        for (const rd of rounds) deleteRound(rd);
      }

      // ═══ Assert ═══
      const season = h.prepare("SELECT * FROM seasons WHERE id=?").get(sid);
      assert.equal(season.status, to, `${name}: expected ${to}, got ${season.status}`);
    });
  }
});

// ═══════════════════════════════════════════════
// Round
// ═══════════════════════════════════════════════
describe('Round', () => {
  const transitions = [
    { name: 'pending → in_progress (match started)', from: 'pending',     via: 'start_match',       to: 'in_progress' },
    { name: 'in_progress → completed (all done)',     from: 'in_progress', via: 'complete_all_games', to: 'completed' },
    { name: 'completed → in_progress (reverted)',     from: 'completed',   via: 'revert_last_game',   to: 'in_progress' },
  ];

  for (const { name, from, via, to } of transitions) {
    it(name, async () => {
      const sid = uid('S'), rid = uid('R'), mid = uid('M');
      h.insertSeason({ id: sid, totalRounds: 3, status: 'ongoing' });
      h.insertRound(rid, sid, 'pending', 1);
      h.insertMatch({ id: mid, seasonId: sid, roundId: rid, bestOf: 1, matchFormat: 'bo1', status: 'pending' });

      if (via === 'start_match') {
        await h.api.post(`/api/matches/${mid}/start`);
      }

      if (via === 'complete_all_games') {
        await h.startMatch(mid);
        await completeAllGames(mid);
      }

      if (via === 'revert_last_game') {
        await h.startMatch(mid);
        await completeAllGames(mid);
        const games = h.getDbGames(mid);
        const lastCompleted = [...games].reverse().find(g => g.status === 'completed');
        if (lastCompleted) await h.api.post(`/api/games/${lastCompleted.id}/revert`);
      }

      const round = h.getDbRound(rid);
      assert.equal(round.status, to, `${name}: expected ${to}, got ${round.status}`);
    });
  }
});

// ═══════════════════════════════════════════════
// Match
// ═══════════════════════════════════════════════
describe('Match', () => {
  const transitions = [
    { name: 'pending → in_progress (started)',      from: 'pending',     via: 'start',          to: 'in_progress' },
    { name: 'in_progress → completed (all done)',    from: 'in_progress', via: 'all_games_done',  to: 'completed' },
    { name: 'completed → in_progress (reverted)',    from: 'completed',   via: 'revert_game',     to: 'in_progress' },
    { name: 'in_progress → pending (cancelled)',     from: 'in_progress', via: 'cancel',         to: 'pending' },
  ];

  for (const { name, from, via, to } of transitions) {
    it(name, async () => {
      const sid = uid('S'), mid = uid('M');
      h.insertSeason({ id: sid, totalRounds: 3, status: 'ongoing' });
      h.insertMatch({ id: mid, seasonId: sid, bestOf: 1, matchFormat: 'bo1', status: 'pending' });

      if (via === 'start') {
        await h.api.post(`/api/matches/${mid}/start`);
      }

      if (via === 'all_games_done') {
        await h.startMatch(mid);
        await completeAllGames(mid);
      }

      if (via === 'revert_game') {
        await h.startMatch(mid);
        await completeAllGames(mid);
        const games = h.getDbGames(mid);
        await h.api.post(`/api/games/${games[0].id}/revert`);
      }

      if (via === 'cancel') {
        await h.startMatch(mid);
        await h.api.post(`/api/matches/${mid}/cancel`);
      }

      const match = h.getDbMatch(mid);
      assert.equal(match.status, to, `${name}: expected ${to}, got ${match.status}`);
    });
  }
});

// ═══════════════════════════════════════════════
// Game
// ═══════════════════════════════════════════════
describe('Game', () => {
  const transitions = [
    { name: 'in_progress → completed (ended)',   from: 'in_progress', via: 'end_game',   to: 'completed' },
    { name: 'completed → in_progress (reverted)', from: 'completed',   via: 'revert_game',to: 'in_progress' },
  ];

  for (const { name, from, via, to } of transitions) {
    it(name, async () => {
      const sid = uid('S'), mid = uid('M');
      h.insertSeason({ id: sid, totalRounds: 3, status: 'ongoing' });
      h.insertMatch({ id: mid, seasonId: sid, bestOf: 1, matchFormat: 'bo1', status: 'pending' });
      const games = await h.startMatch(mid);
      const game = games[0];

      if (from === 'completed') await h.finishGame(game.id, 21, 15);

      if (via === 'end_game') await h.finishGame(game.id, 21, 15);
      if (via === 'revert_game') await h.api.post(`/api/games/${game.id}/revert`);

      const dbGame = h.prepare('SELECT * FROM games WHERE id=?').get(game.id);
      assert.equal(dbGame.status, to, `${name}: expected ${to}, got ${dbGame.status}`);
    });
  }
});
