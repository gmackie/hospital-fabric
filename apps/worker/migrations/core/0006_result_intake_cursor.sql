-- HF-8: unkeyed result polls resume after the last LIS result they examined.
-- last_rowid is the simulated LIS lis_results rowid, which only grows (results are never deleted).
CREATE TABLE IF NOT EXISTS result_intake_cursor (
  source_system TEXT PRIMARY KEY,
  last_rowid INTEGER NOT NULL CHECK(last_rowid >= 0),
  updated_at INTEGER NOT NULL
);
