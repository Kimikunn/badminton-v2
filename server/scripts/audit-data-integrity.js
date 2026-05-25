const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  const cols = stmt.getColumnNames();
  while (stmt.step()) {
    const vals = stmt.get();
    out.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
  }
  stmt.free();
  return out;
}

function first(db, sql, params = []) {
  return rows(db, sql, params)[0] || null;
}

function addIssue(report, code, severity, message, details = {}) {
  report.issues.push({ code, severity, message, details });
}

function expectedRoundStatus(matches) {
  if (matches.length === 0) return 'pending';
  if (matches.every(m => m.status === 'completed')) return 'completed';
  if (matches.some(m => m.status === 'in_progress')) return 'in_progress';
  return 'pending';
}

function checkMatchComplete(completedGames, gameCount, matchFormat) {
  let winsA = 0;
  let winsB = 0;
  for (const g of completedGames) {
    if (g.winner === 'a') winsA += 1;
    if (g.winner === 'b') winsB += 1;
  }

  const totalGames = gameCount || 3;
  const format = matchFormat || (totalGames === 7 ? 'pa7' : totalGames === 1 ? 'bo1' : 'bo3');

  if (format === 'pa7') {
    if (completedGames.length >= totalGames) return { isComplete: true, winner: winsA > winsB ? 'a' : 'b' };
    return { isComplete: false, winner: null };
  }

  const winsNeeded = Math.ceil(totalGames / 2);
  if (winsA >= winsNeeded) return { isComplete: true, winner: 'a' };
  if (winsB >= winsNeeded) return { isComplete: true, winner: 'b' };
  if (completedGames.length >= totalGames) return { isComplete: true, winner: winsA > winsB ? 'a' : 'b' };
  return { isComplete: false, winner: null };
}

async function auditDatabase(dbPath) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const report = {
    dbPath,
    checkedAt: new Date().toISOString(),
    summary: { errors: 0, warnings: 0 },
    counts: {},
    issues: []
  };

  try {
    report.counts.seasons = first(db, 'SELECT COUNT(*) AS c FROM seasons')?.c || 0;
    report.counts.rounds = first(db, 'SELECT COUNT(*) AS c FROM rounds')?.c || 0;
    report.counts.matches = first(db, 'SELECT COUNT(*) AS c FROM matches')?.c || 0;
    report.counts.games = first(db, 'SELECT COUNT(*) AS c FROM games')?.c || 0;

    for (const row of rows(db, 'SELECT r.id, r.season_id FROM rounds r LEFT JOIN seasons s ON s.id = r.season_id WHERE s.id IS NULL')) {
      addIssue(report, 'ROUND_WITHOUT_SEASON', 'error', '轮次缺少所属赛季', row);
    }

    for (const row of rows(db, 'SELECT m.id, m.season_id FROM matches m LEFT JOIN seasons s ON s.id = m.season_id WHERE m.season_id IS NOT NULL AND s.id IS NULL')) {
      addIssue(report, 'MATCH_WITHOUT_SEASON', 'error', '比赛引用了不存在的赛季', row);
    }

    for (const row of rows(db, 'SELECT m.id, m.round_id FROM matches m LEFT JOIN rounds r ON r.id = m.round_id WHERE m.round_id IS NOT NULL AND r.id IS NULL')) {
      addIssue(report, 'MATCH_WITHOUT_ROUND', 'error', '比赛引用了不存在的轮次', row);
    }

    for (const row of rows(db, 'SELECT m.id, m.season_id, r.season_id AS round_season_id FROM matches m JOIN rounds r ON r.id = m.round_id WHERE m.season_id IS NOT NULL AND m.season_id <> r.season_id')) {
      addIssue(report, 'MATCH_ROUND_SEASON_MISMATCH', 'error', '比赛赛季与轮次所属赛季不一致', row);
    }

    for (const row of rows(db, 'SELECT g.id, g.match_id FROM games g LEFT JOIN matches m ON m.id = g.match_id WHERE m.id IS NULL')) {
      addIssue(report, 'GAME_WITHOUT_MATCH', 'error', '小局引用了不存在的比赛', row);
    }

    for (const row of rows(db, 'SELECT match_id, game_no, COUNT(*) AS c FROM games GROUP BY match_id, game_no HAVING c > 1')) {
      addIssue(report, 'DUPLICATE_GAME_NO', 'error', '同一场比赛内存在重复局号', row);
    }

    const matches = rows(db, 'SELECT * FROM matches ORDER BY created_at, id');
    for (const match of matches) {
      const bestOf = match.best_of || 3;
      const expectedMatchFormat = bestOf === 7 ? 'pa7' : bestOf === 1 ? 'bo1' : 'bo3';
      const matchFormat = match.match_format || expectedMatchFormat;
      if (match.match_format && match.match_format !== expectedMatchFormat) {
        addIssue(report, 'MATCH_FORMAT_MISMATCH', 'error', '比赛局数与赛制不一致', {
          matchId: match.id,
          bestOf,
          storedMatchFormat: match.match_format,
          expectedMatchFormat
        });
      }
      const games = rows(db, 'SELECT * FROM games WHERE match_id = ? ORDER BY game_no', [match.id]);
      const completed = games.filter(g => g.status === 'completed');
      const active = games.filter(g => g.status === 'in_progress');

      if (match.status !== 'pending' && games.length < bestOf) {
        addIssue(report, 'STARTED_MATCH_MISSING_GAMES', 'error', '已开始或已结束比赛缺少应有小局', {
          matchId: match.id,
          status: match.status,
          bestOf,
          actualGames: games.length
        });
      }

      if (match.status === 'in_progress' && active.length === 0) {
        addIssue(report, 'ACTIVE_MATCH_WITHOUT_ACTIVE_GAME', 'error', '进行中比赛没有进行中的小局', { matchId: match.id });
      }

      if (active.length > 1) {
        addIssue(report, 'MATCH_WITH_MULTIPLE_ACTIVE_GAMES', 'error', '同一比赛存在多个进行中小局', {
          matchId: match.id,
          gameIds: active.map(g => g.id)
        });
      }

      if (match.status === 'completed' && active.length > 0) {
        addIssue(report, 'COMPLETED_MATCH_WITH_ACTIVE_GAME', 'error', '已结束比赛仍存在进行中的小局', {
          matchId: match.id,
          gameIds: active.map(g => g.id)
        });
      }

      const calculated = checkMatchComplete(completed, bestOf, matchFormat);
      if (match.status === 'completed' && !calculated.isComplete) {
        addIssue(report, 'COMPLETED_MATCH_INCOMPLETE_BY_RULE', 'error', '比赛状态为已结束，但按赛制尚未结束', {
          matchId: match.id,
          bestOf,
          matchFormat,
          completedGames: completed.length
        });
      }

      if (match.status === 'completed' && calculated.isComplete && match.winner && match.winner !== calculated.winner) {
        addIssue(report, 'MATCH_WINNER_MISMATCH', 'error', '比赛赢家与小局结果不一致', {
          matchId: match.id,
          storedWinner: match.winner,
          calculatedWinner: calculated.winner
        });
      }

      if (matchFormat === 'pa7' && match.status === 'completed' && completed.length < bestOf) {
        addIssue(report, 'PA7_COMPLETED_BEFORE_ALL_GAMES', 'error', 'PA7 比赛未打满就被标记为结束', {
          matchId: match.id,
          bestOf,
          completedGames: completed.length
        });
      }
    }

    for (const round of rows(db, 'SELECT * FROM rounds ORDER BY season_id, round_no')) {
      const roundMatches = rows(db, 'SELECT status FROM matches WHERE round_id = ?', [round.id]);
      const expected = expectedRoundStatus(roundMatches);
      if (round.status !== expected) {
        addIssue(report, 'ROUND_STATUS_MISMATCH', 'error', '轮次状态与所属比赛状态不一致', {
          roundId: round.id,
          storedStatus: round.status,
          expectedStatus: expected,
          matchCount: roundMatches.length
        });
      }
    }
  } finally {
    db.close();
  }

  report.summary.errors = report.issues.filter(i => i.severity === 'error').length;
  report.summary.warnings = report.issues.filter(i => i.severity === 'warning').length;
  return report;
}

function parseArgs(argv) {
  const dbPathArg = argv.find(arg => arg.startsWith('--db='));
  const dbPath = dbPathArg
    ? path.resolve(dbPathArg.slice('--db='.length))
    : process.env.DB_PATH || path.join(__dirname, '..', 'database', 'test.db');
  const allowIssues = argv.includes('--allow-issues');
  return { dbPath, allowIssues };
}

async function main() {
  const { dbPath, allowIssues } = parseArgs(process.argv.slice(2));
  const report = await auditDatabase(dbPath);
  console.log(JSON.stringify(report, null, 2));
  if (!allowIssues && report.summary.errors > 0) process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { auditDatabase };
