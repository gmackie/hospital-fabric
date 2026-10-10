-- One fixed synthetic scenario per browser; bearer capability stays in an HttpOnly cookie.
CREATE TABLE IF NOT EXISTS public_demo_sessions (
  token TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES demo_patients(id),
  operation_id TEXT UNIQUE REFERENCES integration_operations(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS public_demo_budget (
  id INTEGER PRIMARY KEY CHECK(id=1),
  used INTEGER NOT NULL
);
INSERT OR IGNORE INTO public_demo_budget(id,used) VALUES(1,0);
