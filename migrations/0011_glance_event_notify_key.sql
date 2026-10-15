-- Encrypted at rest, same shape as the Google client secret. Never returned by the API.
ALTER TABLE glance_settings ADD COLUMN event_notify_key TEXT NOT NULL DEFAULT '';
