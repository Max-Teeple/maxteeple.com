-- Optional credit for a photo, and upload-only share links.
ALTER TABLE glance_photos ADD COLUMN credit TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS glance_photo_shares (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  uploads INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 0
);
