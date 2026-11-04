-- HF-13 Phase R: site-to-cloud link. One schema on both tiers; the site writes the
-- referral outbox, the cloud writes nonces, heartbeats and received referrals.

-- Site: durable outbox of synthetic referrals awaiting delivery to the cloud.
CREATE TABLE IF NOT EXISTS site_link_referrals (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','retry','delivered','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS site_link_referrals_due ON site_link_referrals(state,available_at,lease_until);

-- Cloud: signed-request nonces seen inside the accepted clock-skew window.
CREATE TABLE IF NOT EXISTS site_link_nonces (
  nonce TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_link_nonces_age ON site_link_nonces(received_at);

-- Cloud: latest verified heartbeat per site.
CREATE TABLE IF NOT EXISTS site_link_heartbeats (
  site_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  commit_sha TEXT,
  unfinished_deliveries INTEGER NOT NULL CHECK(unfinished_deliveries >= 0),
  referral_queue_depth INTEGER NOT NULL CHECK(referral_queue_depth >= 0)
);

-- Cloud: each idempotency key is stored once, so a retried delivery is never duplicated.
CREATE TABLE IF NOT EXISTS site_link_inbound_referrals (
  idempotency_key TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_link_inbound_referrals_site ON site_link_inbound_referrals(site_id,received_at);
