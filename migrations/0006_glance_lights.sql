-- Tuya credentials stay in glance_settings and are never returned by the API.

ALTER TABLE glance_settings ADD COLUMN tuya_access_id TEXT NOT NULL DEFAULT '';
ALTER TABLE glance_settings ADD COLUMN tuya_access_secret TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS glance_lights (
  device_id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
