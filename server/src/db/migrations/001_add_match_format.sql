ALTER TABLE matches ADD COLUMN match_format TEXT DEFAULT 'bo3';

UPDATE matches
SET match_format = CASE
  WHEN best_of = 1 THEN 'bo1'
  WHEN best_of = 7 THEN 'pa7'
  ELSE 'bo3'
END
WHERE match_format IS NULL OR match_format = 'bo3';
