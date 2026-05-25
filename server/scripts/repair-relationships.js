const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const write = process.argv.includes('--write');
const dbPathArg = process.argv.find(arg => arg.startsWith('--db='));
const dbPath = dbPathArg
  ? path.resolve(dbPathArg.slice('--db='.length))
  : process.env.DB_PATH || path.join(__dirname, '..', 'database', 'test.db');

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

function run(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  return db.getRowsModified();
}

function hasColumn(db, tableName, columnName) {
  return rows(db, `PRAGMA table_info(${tableName})`).some(row => row.name === columnName);
}

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const report = {
    dbPath,
    mode: write ? 'write' : 'dry-run',
    deletedOrphanGames: 0,
    filledBestOf: 0,
    filledMatchFormat: 0,
    insertedMissingGames: 0,
    normalizedGameStatuses: 0,
    updatedRoundStatuses: 0,
    addedMatchFormatColumn: false
  };

  db.run('BEGIN TRANSACTION');
  try {
    if (!hasColumn(db, 'matches', 'match_format')) {
      db.run("ALTER TABLE matches ADD COLUMN match_format TEXT DEFAULT 'bo3'");
      report.addedMatchFormatColumn = true;
    }

    const orphanGames = rows(db, `SELECT g.id FROM games g LEFT JOIN matches m ON m.id = g.match_id WHERE m.id IS NULL`);
    for (const g of orphanGames) {
      report.deletedOrphanGames += run(db, 'DELETE FROM games WHERE id = ?', [g.id]);
    }

    const matches = rows(db, `SELECT m.*, s.best_of AS season_best_of FROM matches m LEFT JOIN seasons s ON s.id = m.season_id ORDER BY m.created_at, m.id`);
    for (const match of matches) {
      const bestOf = match.best_of || match.season_best_of || 3;
      if (match.season_id && match.best_of == null) {
        report.filledBestOf += run(db, 'UPDATE matches SET best_of = ? WHERE id = ?', [bestOf, match.id]);
      }
      const inferredFormat = bestOf === 1 ? 'bo1' : bestOf === 7 ? 'pa7' : 'bo3';
      if (match.match_format !== inferredFormat) {
        report.filledMatchFormat += run(db, 'UPDATE matches SET match_format = ? WHERE id = ?', [inferredFormat, match.id]);
      }

      const existing = rows(db, 'SELECT * FROM games WHERE match_id = ? ORDER BY game_no', [match.id]);
      const existingNos = new Set(existing.map(g => g.game_no));
      const shouldHaveGames = match.status !== 'pending' || existing.length > 0;
      if (shouldHaveGames) {
        for (let i = 1; i <= bestOf; i++) {
          if (existingNos.has(i)) continue;
          report.insertedMissingGames += run(db, 'INSERT INTO games (id, match_id, game_no, status) VALUES (?, ?, ?, ?)', [`${match.id}-G${i}`, match.id, i, 'pending']);
        }
      }

      const games = rows(db, 'SELECT * FROM games WHERE match_id = ? ORDER BY game_no', [match.id]);
      if (match.status === 'completed') {
        for (const g of games.filter(g => g.status === 'in_progress')) {
          report.normalizedGameStatuses += run(db, 'UPDATE games SET status = ? WHERE id = ?', ['pending', g.id]);
        }
      }

      if (match.status === 'in_progress') {
        const active = games.filter(g => g.status === 'in_progress');
        for (const extra of active.slice(1)) {
          report.normalizedGameStatuses += run(db, 'UPDATE games SET status = ? WHERE id = ?', ['pending', extra.id]);
        }
        if (active.length === 0) {
          const next = games.find(g => g.status === 'pending');
          if (next) report.normalizedGameStatuses += run(db, 'UPDATE games SET status = ? WHERE id = ?', ['in_progress', next.id]);
        }
      }
    }

    const rounds = rows(db, 'SELECT * FROM rounds');
    for (const round of rounds) {
      const rMatches = rows(db, 'SELECT * FROM matches WHERE round_id = ?', [round.id]);
      if (rMatches.length === 0) continue;
      const expected = rMatches.every(m => m.status === 'completed')
        ? 'completed'
        : rMatches.some(m => m.status === 'in_progress')
          ? 'in_progress'
          : 'pending';
      if (round.status !== expected) {
        report.updatedRoundStatuses += run(db, 'UPDATE rounds SET status = ? WHERE id = ?', [expected, round.id]);
      }
    }

    if (write) {
      db.run('COMMIT');
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } else {
      db.run('ROLLBACK');
    }
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
