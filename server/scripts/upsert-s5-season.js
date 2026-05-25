const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database', 'badminton.db');
const S5_DATA = { s5: { roundDice: {}, pierceCounts: {}, debtRecords: {}, pauseUses: [], debtSettlements: {} } };

async function main() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);

  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const stmt = db.prepare(`INSERT INTO seasons (id, name, total_rounds, best_of, status, participants, rule_id, comeback_data, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      total_rounds=excluded.total_rounds,
      best_of=excluded.best_of,
      status=excluded.status,
      participants=excluded.participants,
      rule_id=excluded.rule_id,
      comeback_data=COALESCE(seasons.comeback_data, excluded.comeback_data),
      color=excluded.color`);

  stmt.run([
    'S5',
    'BAD杯第五赛季',
    10,
    3,
    'pending',
    '["p1","p2","p3","p4"]',
    's5',
    JSON.stringify(S5_DATA),
    'red'
  ]);
  stmt.free();

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();
  console.log(`S5 pending season upserted: ${DB_PATH}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
