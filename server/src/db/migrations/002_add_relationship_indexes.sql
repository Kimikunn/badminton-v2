CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_season_round_no
  ON rounds (season_id, round_no);

CREATE INDEX IF NOT EXISTS idx_rounds_season_id
  ON rounds (season_id);

CREATE INDEX IF NOT EXISTS idx_matches_season_id
  ON matches (season_id);

CREATE INDEX IF NOT EXISTS idx_matches_round_id
  ON matches (round_id);

CREATE INDEX IF NOT EXISTS idx_matches_status
  ON matches (status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_match_game_no
  ON games (match_id, game_no);

CREATE INDEX IF NOT EXISTS idx_games_match_id
  ON games (match_id);

CREATE INDEX IF NOT EXISTS idx_games_status
  ON games (status);
