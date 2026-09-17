-- BAD Club v2 — Database Schema
-- SQLite

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  racket TEXT,
  shoes TEXT,
  displayed_title_id TEXT
);

CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  hourly_rate REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  total_rounds INTEGER DEFAULT 7,
  best_of INTEGER DEFAULT 3,
  status TEXT DEFAULT 'pending',
  participants TEXT,       -- JSON array of player IDs
  rule_id TEXT DEFAULT 'standard',
  comeback_data TEXT,      -- JSON, rule-specific data
  color TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES seasons(id),
  round_no INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  venue_manager_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  season_id TEXT REFERENCES seasons(id),
  round_id TEXT REFERENCES rounds(id),
  type TEXT DEFAULT 'doubles',
  team_a TEXT,             -- JSON array of player IDs
  team_b TEXT,             -- JSON array of player IDs
  best_of INTEGER DEFAULT 3,
  match_format TEXT DEFAULT 'bo3', -- bo1 / bo3 / pa7
  status TEXT DEFAULT 'pending',
  winner TEXT,
  date TEXT,
  venue_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  game_no INTEGER NOT NULL,
  score_a INTEGER DEFAULT 0,
  score_b INTEGER DEFAULT 0,
  winner TEXT,
  status TEXT DEFAULT 'pending',
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_rule_events (
  id TEXT PRIMARY KEY,
  season_id TEXT REFERENCES seasons(id),
  round_id TEXT REFERENCES rounds(id),
  match_id TEXT REFERENCES matches(id),
  game_id TEXT REFERENCES games(id),
  rule_id TEXT NOT NULL,
  timing TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS titles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  type TEXT DEFAULT 'manual',
  condition_desc TEXT,
  icon TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_titles (
  player_id TEXT NOT NULL REFERENCES players(id),
  title_id TEXT NOT NULL REFERENCES titles(id),
  season_id TEXT,
  awarded_at TEXT DEFAULT (datetime('now')),
  awarded_by TEXT,
  notes TEXT,
  PRIMARY KEY (player_id, title_id)
);

CREATE TABLE IF NOT EXISTS booking_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  rotation TEXT,           -- JSON array of player IDs
  current_person_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS booking_records (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  venue_id TEXT REFERENCES venues(id),
  date TEXT,
  time TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT DEFAULT 'BAD Club',
  avatar TEXT,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY,
  batch_id TEXT,
  content TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  skill_level INTEGER,
  priority_weight INTEGER DEFAULT 0,
  source TEXT DEFAULT 'legacy_pool',
  generated_date TEXT,
  generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled INTEGER DEFAULT 1,
  token_invalid_notified INTEGER DEFAULT 0, -- 401 告警去重标记
  area_priority TEXT,           -- 全局锁场场地优先级（JSON 有序 areaId 数组）；意图 preferred_area_ids 为空时生效，空 = 按场馆返回顺序
  poll_failure_notified INTEGER DEFAULT 0,  -- 连续拉取失败告警去重标记
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_intents (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'auto_lock',  -- auto_lock 自动锁场 / notify 仅提醒
  date TEXT,                 -- YYYY-MM-DD，必填（单模型：一天一条，可多条并存）；列保留可空以兼容旧数据，校验层强制必有值
  window_start TEXT NOT NULL,  -- HH:MM，可订窗口起
  window_end TEXT NOT NULL,    -- HH:MM，可订窗口止
  duration_hours INTEGER NOT NULL DEFAULT 1,  -- 打球时长：窗口内需连续的小时数（允许跨场地，不接受断开）
  courts_needed INTEGER NOT NULL DEFAULT 1,   -- 同一小时需要几片场（1-3）
  preferred_area_ids TEXT NOT NULL DEFAULT '[]',  -- JSON 有序 areaId 数组；空 = 用全局 area_priority
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booking_intent_locks (
  id TEXT PRIMARY KEY,          -- bil- 前缀
  intent_id TEXT NOT NULL,      -- 触发锁场的订场意图
  uniq_no TEXT NOT NULL,        -- slot 唯一标识（同 watch_slot_state）
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  area_id INTEGER,
  area_name TEXT,
  order_id TEXT,                -- 外部订单号；失败时为空
  status TEXT NOT NULL,         -- locked | failed | expired
  error TEXT,                   -- 失败原因；成功时为空
  error_code TEXT,              -- 失败原因结构化码：RISK_CONTROL | SOLDOUT | LIMIT | UNPAID | OTHER（历史行为 NULL）
  expire_at TEXT,               -- 未支付订单自动释放时刻（UTC；下单响应 expireTime 为北京时间，转换后落库）
  created_at TEXT DEFAULT (datetime('now'))
);

-- 部分唯一索引：只拦"已锁到"的重复占坑；failed 记录不阻塞格子回流后的重试
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intent_locks_uniq_no_locked
  ON booking_intent_locks(uniq_no) WHERE status = 'locked';

CREATE TABLE IF NOT EXISTS watch_areas (
  area_id INTEGER PRIMARY KEY,  -- 场馆场地 ID（外部接口）
  area_name TEXT,               -- 引擎拉取时顺带记录，供意图输出 areaNames
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_slot_state (
  uniq_no TEXT PRIMARY KEY,  -- 接口原生键，如 41_20260831_09:00_10:00
  date TEXT,                 -- 冗余日期，便于过期清理
  available INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_notifications (
  id TEXT PRIMARY KEY,
  intent_id TEXT,            -- 来源意图；016 迁移的旧数据为 NULL
  uniq_no TEXT,
  area_name TEXT,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  price REAL,
  success INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Default data
INSERT OR IGNORE INTO club (id, name, description) VALUES (1, 'BAD Club', '');
INSERT OR IGNORE INTO booking_config (id, rotation, current_person_index) VALUES (1, '[]', 0);
INSERT OR IGNORE INTO watch_config (id) VALUES (1);
