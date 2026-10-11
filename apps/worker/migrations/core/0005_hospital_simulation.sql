-- A bounded, visitor-owned synthetic shift. Single row CAS keeps shared resources atomic.
CREATE TABLE IF NOT EXISTS hospital_simulations (
  token TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hospital_simulations_expiry ON hospital_simulations(expires_at);
