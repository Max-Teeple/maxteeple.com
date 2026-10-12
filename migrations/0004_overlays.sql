-- Client-side stream overlays. Nothing here is burned into the video.

CREATE TABLE IF NOT EXISTS course_overlays (
  course_id INTEGER PRIMARY KEY,
  template TEXT NOT NULL DEFAULT 'lower-third',
  theme_json TEXT NOT NULL DEFAULT '{}',
  positions_json TEXT NOT NULL DEFAULT '{}',
  show_logo INTEGER NOT NULL DEFAULT 1,
  show_name INTEGER NOT NULL DEFAULT 1,
  show_hole INTEGER NOT NULL DEFAULT 1,
  show_par INTEGER NOT NULL DEFAULT 1,
  show_yardage INTEGER NOT NULL DEFAULT 1,
  show_sponsor INTEGER NOT NULL DEFAULT 0,
  show_ticker INTEGER NOT NULL DEFAULT 0,
  opacity REAL NOT NULL DEFAULT 0.94,
  sponsor_logo TEXT,
  ticker_text TEXT,
  current_hole INTEGER NOT NULL DEFAULT 1,
  viewer_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS course_holes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  hole_number INTEGER NOT NULL,
  par INTEGER,
  yardage_json TEXT NOT NULL DEFAULT '{}',
  image_url TEXT,
  template TEXT,
  UNIQUE (course_id, hole_number)
);

CREATE INDEX IF NOT EXISTS idx_course_holes_course ON course_holes(course_id, hole_number);
