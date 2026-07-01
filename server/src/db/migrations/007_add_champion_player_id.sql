-- 007: Add champion_player_id to seasons for Hall of Fame
ALTER TABLE seasons ADD COLUMN champion_player_id TEXT REFERENCES players(id);
