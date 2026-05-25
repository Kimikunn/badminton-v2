const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'database', 'badminton.db');

function esc(s) { return `'${String(s).replace(/'/g,"''")}'`; }

async function seed() {
  const SQL = await initSqlJs();
  if (!fs.existsSync(DB_PATH)) { console.log('Run server first'); process.exit(1); }
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  function R(sql) { db.run(sql); }

  console.log('Seeding...');

  // Club
  R(`UPDATE club SET name='川沙羽毛球俱乐部', description='一群热爱羽毛球的小伙伴。' WHERE id=1`);
  console.log('✓ Club');

  // Players
  for (const [id,name] of [['p1','赵沂'],['p2','胡肖涛'],['p3','王铮昊'],['p4','张逸骋']]) {
    R(`INSERT OR REPLACE INTO players (id,name) VALUES ('${id}','${name}')`);
  }
  console.log('✓ Players');

  // Titles
  R(`INSERT OR REPLACE INTO titles (id,name,level,sort_order) VALUES ('t_s1_champion','S1赛季总冠军','S',1)`);
  R(`INSERT OR REPLACE INTO titles (id,name,level,sort_order) VALUES ('t_third_person','第三人称视角','hidden',10)`);
  R(`INSERT OR REPLACE INTO titles (id,name,level,sort_order) VALUES ('t_big_devil','大魔王','hidden',11)`);
  R(`INSERT OR REPLACE INTO titles (id,name,level,sort_order) VALUES ('t_silent','不鸣则已','hidden',12)`);
  console.log('✓ Titles');

  // Player titles
  R(`INSERT OR IGNORE INTO player_titles (player_id,title_id) VALUES ('p1','t_s1_champion')`);
  R(`INSERT OR IGNORE INTO player_titles (player_id,title_id) VALUES ('p2','t_third_person')`);
  R(`INSERT OR IGNORE INTO player_titles (player_id,title_id) VALUES ('p3','t_big_devil')`);
  R(`INSERT OR IGNORE INTO player_titles (player_id,title_id) VALUES ('p4','t_silent')`);
  console.log('✓ Player titles');

  // Venue
  R(`INSERT OR IGNORE INTO venues (id,name,address) VALUES ('v1','川体羽毛球馆','上海市浦东新区')`);
  console.log('✓ Venue');

  // === S1 ===
  R(`INSERT OR REPLACE INTO seasons (id,name,total_rounds,best_of,status,participants,rule_id,color) VALUES ('S1','BAD杯第一赛季',7,3,'completed','["p1","p2","p3","p4"]','standard','blue')`);
  for (let r=1;r<=7;r++) R(`INSERT OR IGNORE INTO rounds (id,season_id,round_no,status) VALUES ('R${r}','S1',${r},'completed')`);

  const P = [['p1','p2','p3','p4'],['p1','p3','p2','p4'],['p1','p4','p2','p3']];
  const scores = [
    [[21,18,'a'],[21,15,'a']], [[21,19,'a'],[18,21,'b'],[21,16,'a']], [[15,21,'b'],[21,17,'a'],[19,21,'b']],
    [[21,12,'a'],[21,14,'a']], [[21,20,'a'],[17,21,'b'],[21,18,'a']], [[16,21,'b'],[21,15,'a'],[21,19,'a']],
    [[21,13,'a'],[21,16,'a']], [[14,21,'b'],[21,18,'a'],[19,21,'b']], [[21,17,'a'],[21,10,'a']],
    [[21,15,'a'],[18,21,'b'],[21,19,'a']], [[21,14,'a'],[21,8,'a']], [[13,21,'b'],[21,17,'a'],[16,21,'b']],
    [[21,16,'a'],[21,18,'a']], [[17,21,'b'],[21,19,'a'],[21,15,'a']], [[21,12,'a'],[21,11,'a']],
    [[19,21,'b'],[21,18,'a'],[21,20,'a']], [[21,13,'a'],[21,16,'a']], [[21,17,'a'],[15,21,'b'],[21,19,'a']],
    [[21,15,'a'],[21,14,'a']], [[16,21,'b'],[21,18,'a'],[18,21,'b']], [[21,10,'a'],[21,12,'a']],
  ];

  let si=0;
  for (let r=1;r<=7;r++) {
    for (let m=0;m<3;m++) {
      const mid = `R${r}-M${m+1}`;
      const [a1,a2,b1,b2] = P[m];
      const gs = scores[si++];
      const mWin = gs.filter(g=>g[2]==='a').length>=2 ? 'a' : 'b';
      R(`INSERT OR IGNORE INTO matches (id,season_id,round_id,type,team_a,team_b,best_of,status,winner,date) VALUES ('${mid}','S1','R${r}','doubles','["${a1}","${a2}"]','["${b1}","${b2}"]',3,'completed','${mWin}','2025-0${r}-15')`);
      for (let g=0;g<gs.length;g++) {
        const [sa,sb,sw] = gs[g];
        R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,winner,status,completed_at) VALUES ('${mid}-G${g+1}','${mid}',${g+1},${sa},${sb},'${sw}','completed',datetime('now'))`);
      }
    }
  }
  console.log('✓ S1: 7 rounds, 21 matches');

  // === S2 ===
  R(`INSERT OR REPLACE INTO seasons (id,name,total_rounds,best_of,status,participants,rule_id,color) VALUES ('S2','BAD杯第二赛季',7,3,'ongoing','["p1","p2","p3","p4"]','s2','purple')`);
  for (let r=1;r<=4;r++) R(`INSERT OR IGNORE INTO rounds (id,season_id,round_no,status) VALUES ('S2-R${r}','S2',${r},'${r<=3?'completed':'in_progress'}')`);

  // R1-R3 matches
  const s2Rounds = [
    [ // R1
      { win:'a', games:[[21,17],[21,19]] },
      { win:'b', games:[[18,21],[21,16],[21,13]] },
      { win:'a', games:[[21,20],[21,18]] },
    ],
    [ // R2
      { win:'b', games:[[14,21],[21,15],[21,17]] },
      { win:'a', games:[[21,12],[21,10]] },
      { win:'b', games:[[19,21],[21,18],[16,21]] },
    ],
    [ // R3
      { win:'a', games:[[21,16],[21,11]] },
      { win:'b', games:[[17,21],[21,14],[21,19]] },
      { win:'a', games:[[21,13],[15,21],[21,18]] },
    ],
  ];
  for (let r=1;r<=3;r++) {
    const data = s2Rounds[r-1];
    for (let m=0;m<3;m++) {
      const mid = `S2-R${r}-M${m+1}`;
      const [a1,a2,b1,b2] = P[m];
      const matchData = data[m];
      const mWin = matchData.win;
      const gs = matchData.games;
      R(`INSERT OR IGNORE INTO matches (id,season_id,round_id,type,team_a,team_b,best_of,status,winner,date) VALUES ('${mid}','S2','S2-R${r}','doubles','["${a1}","${a2}"]','["${b1}","${b2}"]',3,'completed','${mWin}','2025-12-${10+r}')`);
      for (let g=0;g<gs.length;g++) {
        const [sa,sb] = gs[g];
        const sw = sa>sb?'a':'b';
        R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,winner,status,completed_at) VALUES ('${mid}-G${g+1}','${mid}',${g+1},${sa},${sb},'${sw}','completed',datetime('now'))`);
      }
    }
  }
  console.log('✓ S2 R1-R3: 9 matches');

  // R4-M1: completed
  R(`INSERT OR IGNORE INTO matches (id,season_id,round_id,type,team_a,team_b,best_of,status,winner,date) VALUES ('S2-R4-M1','S2','S2-R4','doubles','["p1","p2"]','["p3","p4"]',3,'completed','a','2025-12-14')`);
  R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,winner,status,completed_at) VALUES ('S2-R4-M1-G1','S2-R4-M1',1,21,17,'a','completed',datetime('now'))`);
  R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,winner,status,completed_at) VALUES ('S2-R4-M1-G2','S2-R4-M1',2,21,15,'a','completed',datetime('now'))`);

  // R4-M2: in_progress
  R(`INSERT OR IGNORE INTO matches (id,season_id,round_id,type,team_a,team_b,best_of,status,date) VALUES ('S2-R4-M2','S2','S2-R4','doubles','["p1","p3"]','["p2","p4"]',3,'in_progress','2025-12-14')`);
  R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,winner,status,completed_at) VALUES ('S2-R4-M2-G1','S2-R4-M2',1,21,18,'a','completed',datetime('now'))`);
  R(`INSERT OR IGNORE INTO games (id,match_id,game_no,score_a,score_b,status) VALUES ('S2-R4-M2-G2','S2-R4-M2',2,15,12,'in_progress')`);
  R(`INSERT OR IGNORE INTO games (id,match_id,game_no,status) VALUES ('S2-R4-M2-G3','S2-R4-M2',3,'pending')`);

  // R4-M3: pending
  R(`INSERT OR IGNORE INTO matches (id,season_id,round_id,type,team_a,team_b,best_of,status,date) VALUES ('S2-R4-M3','S2','S2-R4','doubles','["p1","p4"]','["p2","p3"]',3,'pending','2025-12-14')`);

  console.log('✓ S2 R4: 1 completed, 1 live, 1 pending');

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log('\n✅ Done!');
}

seed().catch(e => { console.error(e.message || e); process.exit(1); });
