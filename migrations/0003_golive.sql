-- Go Live wizard progress and managed-install requests.

ALTER TABLE courses ADD COLUMN setup_tier TEXT;
ALTER TABLE courses ADD COLUMN golive_step TEXT;

CREATE TABLE IF NOT EXISTS install_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  camera_spots TEXT,
  power_availability TEXT,
  internet_available TEXT,
  notes TEXT,
  account_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_install_requests_created ON install_requests(created_at);
