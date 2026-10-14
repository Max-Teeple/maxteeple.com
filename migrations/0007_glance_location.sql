-- Family locations. Device tokens are stored only as hashes.

ALTER TABLE glance_settings ADD COLUMN location_stale_hours INTEGER NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS glance_people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glance_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 150,
  is_home INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS glance_location_points (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  acc REAL,
  vel REAL,
  regions TEXT NOT NULL DEFAULT '[]',
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_glance_location_person ON glance_location_points(person_id, recorded_at);
