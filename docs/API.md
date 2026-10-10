# API map (prototype vs. planned)

All `v1` endpoints in this repository are **synthetic/demo-only**, require `x-demo-token`, and must not be exposed to an untrusted network. The demo token is not production authentication. No patient identifiers, names, lab data, or credentials from real systems belong in these endpoints.

## Implemented

| Method | Path | Description |
|---|---|---|
| GET | `/`, `/console.js`, `/console.css` | Local-mode static demo console; no embedded token or data; all data/actions still require API authentication. Assets disabled with PUBLIC_DEMO=1 |
| GET | `/healthz` | No DB check; public liveness |
| GET | `/readyz` | Both D1 databases reachable; authenticated |
| POST | `/v1/admin/bootstrap` | Apply embedded migrations; local-dev gated |
| GET | `/v1/facilities` | Facility registry |
| GET | `/v1/components` | Installed component capability declaration |
| GET | `/v1/devices` | Medical device readiness projection (initially empty) |
| GET | `/v1/operations` | Latest synthetic orders and integration state |
| GET | `/v1/operations/{id}` | Authoritative integration operation |
| GET | `/v1/operations/{id}/events` | Integration timeline, including per-attempt lookup/submission/recovery metadata |
| POST | `/v1/operations/{id}/reconcile` | Selected-operation-only recheck of unknown outcome (simulator only; unrelated due orders are not dispatched) |
| GET | `/v1/status` | Aggregate operations metrics |
| POST | `/v1/demo/patients` | Create a synthetic patient |
| POST | `/v1/demo/lab-orders` | Create synthetic request, persist outbox atomically |
| POST | `/v1/demo/faults/drop-next-ack` | Simulate successful LIS commit and lost reply |
| POST | `/v1/admin/tick` | Trigger delivery and result-poll jobs manually |
| POST | `/v1/demo/lis/orders/{operationId}/release` | Release simulated lab result |
| GET | `/v1/demo/patients/{patientId}/results` | Read simulated chart result projection |

## Planned API groups (not implemented)

* `/v1/connectors`, `/v1/connectors/{id}/capabilities`, `/v1/connectors/{id}/health`: registry, credentials via secure vault, compatibility tests.
* `/v1/fhir/{resourceType}`: selectively proxied FHIR resources with per-system profiles, never a generic unauthenticated pass-through.
* `/v1/terminology/mappings`, `/v1/patient-links`: terminology approvals and human-reviewed cross-system identity mappings.
* `/v1/workflows/{id}`, `/v1/reconciliation`, `/v1/audit`: richer workflow control plane with immutable history and RBAC.
* `/v1/devices/{id}`, `/v1/gateways`, `/v1/telemetry`: medical device compatibility registry, isolated gateways, utility metrics.
* `/v1/capacity`, `/v1/referrals`, `/v1/communications`: hospital readiness, secure referral exchange and PACE pathways.
* `/v1/operations/events/stream`: authenticated change feed for the operator console.

## Workers

`apps/worker/src/index.ts` provides:

* **HTTP `fetch`**: API and operator-console data.
* **Scheduled `scheduled`**: once/minute outbox delivery and result polling; state persists in SQLite.
* `jobs/dispatch.ts`: claim with lease, read-before-retry, unknown outcome reconciliation, manual review after repeated ambiguity.
* `jobs/results.ts`: synthetic inbound result correlation, deduplication and projections.

Separate queue consumers, Durable Objects and Effect persisted workflows may be added later *behind these same domain interfaces*. Do not add multiple authoritative owners for the same order state.
