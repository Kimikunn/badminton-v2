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

CREATE INDEX IF NOT EXISTS idx_game_rule_events_game_id ON game_rule_events(game_id);
CREATE INDEX IF NOT EXISTS idx_game_rule_events_season_type ON game_rule_events(season_id, rule_id, type);
