-- 008: Add unavailable_days table for marking days as unavailable
CREATE TABLE IF NOT EXISTS unavailable_days (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(player_id, date)
);
