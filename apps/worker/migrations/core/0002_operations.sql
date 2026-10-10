-- Forward-facing operational registry. APIs beyond read-only device listing are later work.
CREATE TABLE IF NOT EXISTS medical_devices (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  component_id TEXT REFERENCES component_instances(id),
  manufacturer TEXT,
  model TEXT NOT NULL,
  serial_hash TEXT,
  interface_kind TEXT CHECK(interface_kind IN ('astm','hl7v2','dicom','fhir','vendor','none')),
  clinical_status TEXT NOT NULL DEFAULT 'bench_only' CHECK(clinical_status IN ('bench_only','quarantined','inspected','authorized_for_use')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hospital_capacity_projections (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  service TEXT NOT NULL,
  available_units INTEGER NOT NULL DEFAULT 0,
  operational_state TEXT NOT NULL CHECK(operational_state IN ('available','degraded','unavailable','unknown')),
  observed_at INTEGER NOT NULL,
  source_component_id TEXT,
  UNIQUE(facility_id,service)
);
CREATE TABLE IF NOT EXISTS utility_observations (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  device_id TEXT REFERENCES medical_devices(id),
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1 CHECK(simulated IN (0,1)),
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS utility_observations_recent ON utility_observations(facility_id,metric,observed_at);
CREATE TABLE IF NOT EXISTS referral_exchanges (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  source_ref TEXT NOT NULL,
  destination_facility_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('draft','pending','sent','acknowledged','manual_review')),
  sensitivity TEXT NOT NULL DEFAULT 'restricted',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS communications_channels (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  purpose TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lan','cellular','satellite','radio','courier')),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  state TEXT NOT NULL CHECK(state IN ('up','down','unknown')),
  updated_at INTEGER NOT NULL
);
