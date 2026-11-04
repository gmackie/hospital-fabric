# ADR 0006: What runs in Durable Object cells and what stays in D1

- Status: Proposed (2026-11-04, HF-13)
- Applies to: both deployment profiles (`site` on celld, `cloud` on Workers)

## Context

hospital-fabric is one bundle that runs on celld at a hospital and on Cloudflare Workers in the cloud. Both runtimes support D1 and Durable Objects. celld adds two guarantees that matter for integration work: exactly one node serves a cell at a time, and every activation advances a fencing epoch. A node that loses its 10 s bucket lease fences itself and exits.

Today all state lives in D1. The outbox gives single-writer delivery with a 30 s lease (`outbox.lease_token`, `lease_until`), and every finalising write is conditional on that lease (`jobs/dispatch.ts`). This works, but it is a re-implementation of what a cell provides, and docs/PRODUCTION.md item 6 still lists lease and fencing validation as open work. A crashed delivery also waits out the full lease before anyone may retry it.

D1 is the right home for records that operators and reports query across destinations, wards and patients. Durable Object storage is not queryable across objects.

## Decision

**D1 stays the system of record for integration data.** Operations, events, the outbox rows themselves, reconciliation cases, audit, patient links, terminology mappings, the component registry, capacity projections and the site-link referral outbox stay in D1. An operation and its outbox row keep being written in one D1 batch, so a request either queues its delivery or doesn't.

**Three kinds of state move into cells:**

| Cell | Key | Owns | Why a cell |
| --- | --- | --- | --- |
| `DestinationConnector` | `component_instances.id` | Claiming and executing deliveries for one destination; in-flight attempt; backoff; per-destination pause | Single writer per destination comes from the runtime. The fencing epoch becomes the attempt token, so a stale executor's D1 writes fail their condition. A restarted cell resumes at once instead of waiting out a lease. |
| `WardBoard` | ward id | Live bed and queue board, and its WebSocket fan-out | High-frequency fan-out to many clients; the state is a projection that can be rebuilt from ADT events in D1. |
| `DeviceGateway` | gateway id | Heartbeats and readiness of the devices behind one gateway | High write rate and small state. The cell snapshots readiness changes into D1 for the device register. |

Rules for every cell:

1. A cell never holds the only copy of clinical-integration state. Anything an operator, report or reconciliation needs is written to D1, or can be rebuilt from D1.
2. Writes from a cell to D1 are conditional on the cell's current epoch (or attempt token), in the same style as today's lease gate. On celld this fences a node that has lost ownership. On Workers it guards against a superseded instance.
3. Cell storage holds only what is needed to resume: the current attempt, backoff state, subscriptions.
4. The outbox query stays the recovery path. The scheduled sweep wakes any connector whose destination has due rows, so a lost cell or a missed wake-up delays delivery but never loses it.

## Consequences

- Both wrangler profiles gain `durable_objects` bindings and `migrations` entries (celld accepts both keys). `no_bundle` and byte-identical bundles are unaffected.
- The outbox lease columns stay during migration. The connector writes the same conditional updates, keyed by epoch instead of a random token, and the 30 s lease becomes a fallback for the sweep only.
- Delivery per destination becomes strictly serial. That matches destinations' idempotency semantics, but caps throughput per destination. Revisit if a destination needs parallel submissions.
- Failover now depends on celld ownership transfer. The labnuc demo runs one node, so showing failover needs a second node (Phase 1).

## Verification (before the first cell ships)

The lost-ACK, restart and duplicate suite must pass on both runtimes (`smoke:workerd`, `smoke:celld`) with the connector cell: one remote order per idempotency key, no finalisation from a superseded epoch, and recovery after the serving node is killed. On labnuc, `deploy/site/labnuc/restart-drill.sh` must still pass.
