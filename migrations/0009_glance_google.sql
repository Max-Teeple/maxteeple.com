-- Google Calendar connect. Tokens and client secrets are encrypted before they are stored.

ALTER TABLE glance_settings ADD COLUMN google_client_id TEXT NOT NULL DEFAULT '';
ALTER TABLE glance_settings ADD COLUMN google_client_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE glance_settings ADD COLUMN google_refresh_token TEXT NOT NULL DEFAULT '';
ALTER TABLE glance_settings ADD COLUMN google_account TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS glance_added_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
