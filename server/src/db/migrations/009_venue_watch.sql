-- 009: 订场监控（venue-watch）模块的四张表
CREATE TABLE IF NOT EXISTS venue_watch_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  token_user TEXT,
  webhook_type TEXT DEFAULT 'pushplus',
  webhook_url TEXT,
  webhook_token TEXT,
  webhook_topic TEXT,
  poll_interval_sec INTEGER DEFAULT 120,
  enabled INTEGER DEFAULT 1,
  token_invalid_notified INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_targets (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  area_id INTEGER,
  area_name TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venue_watch_slot_state (
  uniq_no TEXT PRIMARY KEY,
  date TEXT,
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

INSERT OR IGNORE INTO venue_watch_config (id) VALUES (1);
