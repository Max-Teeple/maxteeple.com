-- Last Phoenix date each light schedule ran, plus a short action log.
-- No plug commands are stored here.
CREATE TABLE IF NOT EXISTS glance_light_runs (
  id TEXT PRIMARY KEY,
  last_date TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glance_light_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
