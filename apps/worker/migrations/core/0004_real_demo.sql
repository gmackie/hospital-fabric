CREATE TABLE IF NOT EXISTS real_demo_evidence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  verified_at TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  value REAL NOT NULL CHECK (value = 13.2)
);
