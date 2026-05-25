const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf-8');
  db.run(schema);

  function R(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
  }

  // Club
  R("UPDATE club SET name='BAD Club 测试', description='Mock数据测试环境' WHERE id=1");

  // Players
  R("INSERT INTO players (id,name) VALUES ('p1','赵沂')");
  R("INSERT INTO players (id,name) VALUES ('p2','胡肖涛')");
  R("INSERT INTO players (id,name) VALUES ('p3','王铮昊')");
  R("INSERT INTO players (id,name) VALUES ('p4','张逸骋')");

  // Season: S5 has not started yet, so test DB intentionally has no rounds/matches.
  R(`INSERT INTO seasons (id,name,total_rounds,best_of,status,participants,rule_id,comeback_data,color) VALUES (?,?,?,?,?,?,?,?,?)`, [
    'S-TEST',
    'BAD杯第五赛季',
    10,
    3,
    'pending',
    '["p1","p2","p3","p4"]',
    's5',
    '{"s5":{"roundDice":{},"pierceCounts":{},"debtRecords":{},"pauseUses":[],"debtSettlements":{}}}',
    'red'
  ]);

  // Venue
  R("INSERT INTO venues (id,name,address,hourly_rate) VALUES ('v-test','测试场地','测试地址',50)");

  // Booking
  R("UPDATE booking_config SET rotation='[\"p1\",\"p2\",\"p3\",\"p4\"]', current_person_index=0 WHERE id=1");

  // Save
  const data = db.export();
  const outPath = path.join(__dirname, '..', 'database', 'test.db');
  fs.writeFileSync(outPath, Buffer.from(data));
  db.close();
  console.log('Test DB created:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
