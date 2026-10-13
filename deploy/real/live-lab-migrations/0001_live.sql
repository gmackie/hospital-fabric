-- Private, local integration ledger only. Never apply to the public demo D1.
-- Identity links, accession references and observations may constitute PHI if used
-- clinically. This initial build is limited to isolated synthetic sandbox workflows.
CREATE TABLE IF NOT EXISTS live_lab_orders (
  order_number TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
  patient_ref TEXT NOT NULL,
  test_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','submission_started','outcome_unknown','awaiting_lab','accepted','rejected','completed','needs_review')),
  request_id TEXT,
  task_id TEXT
);
CREATE TABLE IF NOT EXISTS live_lab_report_versions (
  order_number TEXT NOT NULL REFERENCES live_lab_orders(order_number),
  report_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  digest TEXT NOT NULL CHECK(length(digest)=64),
  PRIMARY KEY(order_number,report_id,version)
);
CREATE TABLE IF NOT EXISTS live_chart_writes (
  key TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('started','completed')),
  source_observation_id TEXT,
  chart_observation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_live_lab_state ON live_lab_orders(state);
