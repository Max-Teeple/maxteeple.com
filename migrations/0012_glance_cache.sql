-- Shared small values that used to live in Workers KV (Tuya access token).
-- Glance polls must not write KV. Rows are short and expire by expires_at.
CREATE TABLE IF NOT EXISTS glance_cache (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
