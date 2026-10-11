# hospital-fabric — Effect 4 + celld/workerd + local D1

**Runnable synthetic integration scaffold. Not a medical device, clinical EMR, validated LIS, or production-ready healthcare deployment. Do not process real patient data.**

The prototype includes a bundled React operator console and a real workerd restart/recovery acceptance harness. See [the blackout demo guide](docs/BLACKOUT-DEMO.md) for the interactive workflow and boundaries.

The first slice demonstrates durable order delivery between a synthetic OpenMRS-like order source and an independently persisted simulated LIS. Both data stores are SQLite-backed D1 bindings. The public walkthrough uses those simulators. A separate fixed synthetic hemoglobin workflow now runs through private OpenMRS/OpenELIS services on hetzner-master, with verified result return and a refreshable proof card at med.gmac.io. See [the host runbook](docs/HETZNER-MASTER.md).

## Public cloud demo

The public interactive synthetic walkthrough is hosted at [med.gmac.io](https://med.gmac.io) on Cloudflare Workers with two independent D1 databases. It demonstrates order delivery, a lost acknowledgment, reconciliation, and result import. No token is needed for that isolated public walkthrough. The token-based local operator console is served only when `PUBLIC_DEMO` is not enabled and is not deployed publicly. See [cloud deployment and verification](docs/CLOUD-DEMO.md).

## Real-service synthetic integration

Private OpenMRS/OpenELIS services now complete a fixed synthetic hemoglobin round-trip, including verified result return to OpenMRS. The public proof card reports that saved workflow; interactive public actions use the simulator. See [the host runbook](docs/HETZNER-MASTER.md) and [protocol boundaries](docs/REAL-SERVICES.md).

## Prerequisites

- Node.js 22.16+ (Effect 4 uses TS >= 5.9; build is ES2022)
- `npm ci` with network access **before** moving into an air-gapped site (Effect 4 pinned to 4.0.2)
- Install [celld](https://celld.dev/docs/) or Wrangler (`npm install` adds local Wrangler) 
- Local workstation; no internet needed at runtime once dependencies and binary are installed

## Run locally with celld

In terminal A, at the project root:

```bash
npm ci
npm run dev:secrets
npm run build
celld dev apps/worker
```

`celld dev` uses `http://127.0.0.1:9876` by default, reads `apps/worker/.dev.vars`, and retains the local D1 databases inside `apps/worker/.celld/dev` between restarts. Leave the host bound to loopback; do not use `--host 0.0.0.0` for this demo.

In terminal B:

```bash
node scripts/demo.mjs
```

The scripted scenario bootstraps synthetic data, registers a synthetic patient, queues a CBC, forces the LIS to commit and lose its acknowledgment, reconciles by reading the destination, releases a synthetic result, and verifies the final state.

For workerd compatibility: `npm run dev:workerd` starts Wrangler locally with the same Worker bundle and D1 schema; separate local DB state is expected. Some runtime APIs differ between celld and workerd; run both smoke tests before treating them as interchangeable.

## Tests

```bash
python3 scripts/check-sql.py
npm test
npm run typecheck
npm run smoke:workerd
```

Node's built-in experimental SQLite (`node --experimental-sqlite`) powers the test D1 mock, so there is no externally hosted test database. The tests validate supported and invalid lab codes, database failures, concurrent duplicate recovery, conflicting destination state, duplicate orders, idempotency collisions, the simulated lost ACK, a new isolate importing the same compiled Worker, safe reconciliation, and result deduplication. The tests are **synthetic** and do not certify a clinical workflow or the production celld runtime.

## Files

```text
apps/worker/
  wrangler.jsonc              D1 bindings for independent fabric and fake-LIS databases
  migrations/core/           Core and operational projection schemas
  migrations/sim_lis/        Separate simulator schema
  src/index.ts               Worker fetch + scheduled event handlers
  src/api/router.ts          Minimal authenticated HTTP API
  src/db/operations.ts       Operation creation and atomic outbox
  src/jobs/dispatch.ts       Leases, idempotent delivery, reconciliation
  src/jobs/results.ts        Inbound result polling + duplicate prevention
  src/adapters/              Simulator + generic adapter interfaces
  src/domain/contracts.ts    Effect Schema request validation
scripts/demo.mjs              End-to-end live demo
scripts/embed-migrations.mjs  Compile local SQL into explicit bootstrap endpoint
tests/integration.test.mjs    Synthetic integration tests
docs/API.md                   Implemented + planned API groups
docs/DB.md                    Table ownership and consistency rules
```

## Initial architectural decisions

1. **One deployable Worker**, several internal workers/modules: API, dispatch, reconciliation, results. Cron is a recovery safety net, not an in-memory timer. Queue/DO bindings are optional later upgrades, not required for the first working slice.
2. **D1/SQLite owns the integration outbox and operation state.** Do not independently mutate authoritative order state in a Durable Object.
3. **Separate DBs for separate authorities.** `LIS_DB` simulates independent laboratory state; an actual OpenELIS integration must use its public API, not its database.
4. **At-least-once delivery with target-side idempotency.** After ambiguous outcomes, reconcile by lookup before resending; block after repeated ambiguity.
5. **No real PHI.** Synthetic identities only, demo token rather than full identity/auth, no real device interfaces and no clinical validation.

Read [API plan](docs/API.md), [database model](docs/DB.md), [Forge ownership](docs/FORGE-BOUNDARIES.md), and [production blockers](docs/PRODUCTION.md).

## What's *not* implemented

No general multi-patient OpenMRS/OpenELIS connector, Orthanc/OpenBoxes adapter, or HL7/DICOM gateway; no live authentication/RBAC/ABAC; no clinical operational UI; no encrypted clinical audit storage; no multi-node recovery validation; no medical-device integration; no actual clinical use. See `docs/PRODUCTION.md` before making any production claims.

## Repository ownership and Forge

This application lives at `gmackie/hospital-fabric`. Forge's maintained compiler repository is `gmackie/forgec`. The draft Forge operational model lives in `forge/`; it is not yet wired to the executable manual SQLite schema. See [Forge boundaries](docs/FORGE-BOUNDARIES.md) to avoid two owners for the same tables.

## Verification status

`npm run check` passes SQLite integrity checks, the Effect 4.0.2 typecheck, bundling, and the synthetic integration tests. GitHub Actions also runs `npm run smoke:workerd`: it starts Wrangler locally with two D1 bindings, loses a committed LIS acknowledgment, kills and restarts the runtime using the same persisted databases, reconciles by stable ID, and verifies exactly one LIS order/result plus the final completed operation state. Console Chromium tests cover the synthetic flow and interrupted/repeated interactions. The D1 mock follows workerd's line-oriented `exec` behavior so malformed bootstrap SQL is caught in the integration tests.

The pinned celld 0.6.2 crash/restart smoke and Forge compiler 0.5.0 check/build now pass. Generated SQL is validated in isolation and does not own live tables. See [the weekend acceptance checklist](docs/WEEKEND-ACCEPTANCE.md) for repeatable commands and outstanding physical WAN, backup/restore and ForgeGraph evidence work. Workerd validation does not establish celld compatibility or clinical suitability. The public synthetic demo is deployed separately on Cloudflare; do not use real patient data.
