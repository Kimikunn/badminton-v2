-- Split booking_records.time into start_time + end_time
-- Old format: "20:00-21:00" → start_time="20:00", end_time="21:00"

ALTER TABLE booking_records ADD COLUMN start_time TEXT NOT NULL DEFAULT '';
ALTER TABLE booking_records ADD COLUMN end_time TEXT NOT NULL DEFAULT '';

-- Migrate existing data by parsing the old time column
UPDATE booking_records
SET
  start_time = CASE
    WHEN time LIKE '%:%' THEN substr(time, 1, instr(time, '-') - 1)
    ELSE ''
  END,
  end_time = CASE
    WHEN time LIKE '%:%' THEN
      CASE
        WHEN instr(time, '-') > 0 THEN ltrim(substr(time, instr(time, '-') + 1))
        ELSE ''
      END
    ELSE ''
  END
WHERE time IS NOT NULL AND time != '';

-- Drop old column (SQLite doesn't support DROP COLUMN in older versions,
-- but the sql.js version we use does)
ALTER TABLE booking_records DROP COLUMN time;
