-- Replace venues.hourly_rate with pricing JSON array
-- Old: hourly_rate = 55 (single number)
-- New: pricing = [{"startHour":8,"endHour":22,"rate":55,"days":[1,2,3,4,5,6,7]}]

ALTER TABLE venues ADD COLUMN pricing TEXT NOT NULL DEFAULT '';

-- Migrate: convert hourly_rate to default pricing (all-day, all-week)
UPDATE venues
SET pricing = json_array(
  json_object(
    'startHour', 0,
    'endHour', 24,
    'rate', hourly_rate,
    'days', json_array(1,2,3,4,5,6,7)
  )
)
WHERE pricing = '' OR pricing IS NULL;

ALTER TABLE venues DROP COLUMN hourly_rate;
