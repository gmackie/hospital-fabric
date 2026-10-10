-- Completely separate state store: simulates a remote LIS, not OpenELIS itself.
CREATE TABLE IF NOT EXISTS lis_orders (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL,
  test_code TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'accepted' CHECK(state IN ('accepted','resulted')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lis_results (
  id TEXT PRIMARY KEY,
  lis_order_id TEXT NOT NULL UNIQUE REFERENCES lis_orders(id),
  report_id TEXT NOT NULL UNIQUE,
  result_text TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  released INTEGER NOT NULL DEFAULT 1 CHECK(released=1),
  released_at INTEGER NOT NULL
);
