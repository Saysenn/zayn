-- THE DRIVER SHEET'S OWN SETUP, his call 2026-10-04.
--
-- The driver sheet splits the month's cash by WHO DELIVERS IT: a North run,
-- a South run, posted, or not from the UK at all. Which location goes where
-- is a business rule that changes, so it is a setting, never code: the
-- Drivers tab in the Export modal edits it by dragging a location onto a
-- run on a UK map.
--
-- ITS OWN COPY OF "WHAT IS LOCAL". local_locations (040) drives the money
-- summary on the other exports; this decides the driver sheet only, so
-- changing one never moves the other.
--
-- jsonb rather than tables: a handful of runs and a few dozen location
-- names, edited by one person, read whole by one export.
--   { "runs":   [{ "id": "north", "label": "North run", "color": "#c2410c" }, ...],
--     "places": { "chip county": "north", "abu dhabi": "abroad", ... } }
-- A location is its folded name (trimmed, lower case), so "South east" and
-- "South East" are one place. "abroad" is the fixed Outside UK bucket.
--
-- SEEDED FROM HIS MANUAL FILE (docs/boss/manually copied driver sheet.xlsx):
-- North is Chip county and Geordie, posted is Northern Dock and Strong man,
-- South is Main City and South East, and the Outside UK tab holds Abu
-- Dhabi, Away and Euro. Anything else starts unassigned.
ALTER TABLE tb_settings
  ADD COLUMN IF NOT EXISTS driver_sheet jsonb NOT NULL DEFAULT '{
    "runs": [
      { "id": "north", "label": "North run", "color": "#c2410c" },
      { "id": "posted", "label": "To be posted", "color": "#6d28d9" },
      { "id": "south", "label": "South run", "color": "#0f766e" }
    ],
    "places": {
      "chip county": "north",
      "geordie": "north",
      "northern dock": "posted",
      "strong man": "posted",
      "main city": "south",
      "south east": "south",
      "abu dhabi": "abroad",
      "away": "abroad",
      "euro": "abroad"
    }
  }'::jsonb;
