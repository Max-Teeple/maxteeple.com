-- Private kitchen dashboard. Feed URLs live in glance_feeds and are never returned by the API.

CREATE TABLE IF NOT EXISTS glance_settings (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  location_name TEXT NOT NULL DEFAULT 'Phoenix, AZ',
  lat REAL NOT NULL DEFAULT 33.4484,
  lon REAL NOT NULL DEFAULT -112.074,
  theme TEXT NOT NULL DEFAULT 'auto',
  clock_24h INTEGER NOT NULL DEFAULT 0,
  night_start INTEGER NOT NULL DEFAULT 21,
  night_end INTEGER NOT NULL DEFAULT 6,
  widgets_json TEXT NOT NULL DEFAULT '{"countdown":true,"sun":true,"air":true,"summary":true}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glance_feeds (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS glance_todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glance_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glance_login_attempts (
  ip TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_glance_todos_sort ON glance_todos(sort_order, created_at);
