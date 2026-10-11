# Database ownership and schema

Two **separate** SQLite-backed D1 databases emulate independently operated systems:

| Database | Tables | Owner |
|---|---|---|
| `hospital_fabric` | 23 tables | Our integration platform |
| `hospital_sim_lis` | `lis_orders`, `lis_results` | Simulated LIS; only for demos/tests |

## Core tables

* `facilities`, `component_instances` — facility and installed application capabilities.
* `patient_links` — externally verified identifier crosswalk; **no automatic probabilistic matching**.
* `terminology_mappings` — approved LOINC/UCUM/vendor mapping metadata.
* `integration_operations` — durable operation status and remote outcome reference.
* `outbox` — retry/lease state, with unique operation and idempotency key.
* `inbox` — inbound deduplication, hash to detect changed result under same ID.
* `operation_events` — append-only integration timeline.
* `reconciliation_cases` — manual/automatic disposition of uncertain outcomes.
* `audit_events` — attributed operational actions (not clinical audit completeness).
* `demo_patients`, `demo_lab_orders`, `demo_chart_results`, `demo_faults` — entirely synthetic fixtures.

## Later operational projections (schema only)

* `medical_devices`: device passports, interface types, clinical acceptance stage.
* `hospital_capacity_projections`: last known service status; not clinical decision logic.
* `utility_observations`: telemetry with simulated/real indicator.
* `referral_exchanges`: metadata for future secure store-and-forward workflows.
* `communications_channels`: link types and status for incident command.

## Constraints and recovery

* A create-order batch atomically inserts the operation, demo order, outbox and audit record.
* D1 `batch()` supplies atomic transaction scope; application-controlled `BEGIN` is not supported.
* Delivery is **at least once**, not literally exactly once. Target-side stable idempotency and destination lookup protect business outcomes.
* An acknowledged outcome can be lost: remote state is checked **before** any resend.
* Worker leases expire; expired `processing` rows reenter reconciliation.
* Results are never attached to a patient without exact correlation to order and matching patient/test.
* For actual clinical systems, the source apps keep their own MariaDB/PostgreSQL/PACS databases and clinical validation responsibility.

## Migration procedure

For `celld dev`, use the authenticated `/v1/admin/bootstrap` **local-only** endpoint after starting the Worker. Embedded migration strings are generated from the SQL files at build time.

For production-style `celld` fleets, disable `ALLOW_DEV_BOOTSTRAP`, and apply migrations with `celld d1 migrations apply hospital_fabric ...` and `celld d1 migrations apply hospital_sim_lis ...` with an approved migration/rollback plan. Fleet mode needs a qualified object store and independent backups.

`hospital_simulations` owns each visitor’s bounded scripted hospital state and command receipts through a single versioned row. It does not write to clinical product databases. See [hospital state and limits](HOSPITAL-SIMULATION.md).
