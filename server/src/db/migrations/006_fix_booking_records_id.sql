-- Fix booking_records: migration 004's DROP COLUMN caused SQLite to lose
-- AUTOINCREMENT on the id column. Recreate the table with TEXT id (explicit).

CREATE TABLE booking_records_new (
  id TEXT PRIMARY KEY,
  player_id TEXT REFERENCES players(id),
  venue_id TEXT REFERENCES venues(id),
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Copy data, fill NULL ids with 'B-' prefix + rowid
INSERT INTO booking_records_new (id, player_id, venue_id, date, start_time, end_time, cost, notes, created_at)
SELECT
  CASE WHEN id IS NOT NULL AND id != '' THEN id
       ELSE 'B-' || rowid
  END,
  player_id, venue_id, date, start_time, end_time, cost, notes, created_at
FROM booking_records;

DROP TABLE booking_records;
ALTER TABLE booking_records_new RENAME TO booking_records;
