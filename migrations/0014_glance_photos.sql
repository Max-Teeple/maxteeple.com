-- Photo bytes live in R2 when that binding works. D1 keeps the index,
-- and the same table holds the JPEG only when R2 is unavailable.
CREATE TABLE IF NOT EXISTS glance_photos (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  store TEXT NOT NULL DEFAULT 'd1'
);

CREATE TABLE IF NOT EXISTS glance_photo_blobs (
  photo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (photo_id, kind)
);
