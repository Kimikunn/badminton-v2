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

CREATE TABLE IF NOT EXISTS venue_watch_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  -- v2 起凭证/推送参数全部走服务器 .env（GYM_TOKEN_USER/PUSH_*），
  -- 以下 v1 列废弃保留，代码不再读取（migration 010 已清空值）
  token_user TEXT,
  webhook_type TEXT,
  webhook_url TEXT,
  webhook_token TEXT,
  webhook_topic TEXT,
  poll_interval_sec INTEGER,
  enabled INTEGER DEFAULT 1,
  token_invalid_notified INTEGER DEFAULT 0, -- 401 告警去重标记
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_targets (
  id TEXT PRIMARY KEY,
  date TEXT,                 -- YYYY-MM-DD，单日模式；NULL = 每周模式
  weekdays TEXT,             -- JSON 数组 0-6（0=周日）；NULL = 单日模式
  start_time TEXT NOT NULL,  -- HH:MM
  end_time TEXT NOT NULL,    -- HH:MM
  area_id INTEGER,           -- v1 遗留，废弃保留
  area_name TEXT,            -- v1 遗留，废弃保留
  area_ids TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，空 = 任意场地
  exclude_unavailable INTEGER NOT NULL DEFAULT 1,  -- 展开日期时排除 unavailable_days 标记的日期
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_areas (
  area_id INTEGER PRIMARY KEY,  -- 场馆场地 ID（外部接口）
  area_name TEXT,               -- poller 拉取时顺带记录，供目标输出 areaNames
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_slot_state (
  uniq_no TEXT PRIMARY KEY,  -- 接口原生键，如 41_20260831_09:00_10:00
  date TEXT,                 -- 冗余日期，便于过期清理
  available INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_notifications (
  id TEXT PRIMARY KEY,
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
INSERT OR IGNORE INTO venue_watch_config (id) VALUES (1);
