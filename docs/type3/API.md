# Local Type 3 API and persistence

Every `/v2/*` route requires `x-type3-token`. The host must be loopback, `ENABLE_TYPE3_RESEARCH=1`, and `PUBLIC_DEMO` must not be `1`. Demo roles in commands are scenario participants, **not** real authentication/authorization. No real patient identifiers, names or measurements are accepted by the intended contract.

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Local workbench (no data or embedded secret) |
| GET | `/healthz` | Research service identity |
| GET | `/v2/protocol` | Version, profile definitions, action/role/input manifest, references |
| POST | `/v2/admin/bootstrap` | Explicit local migration; also requires `ALLOW_TYPE3_BOOTSTRAP=1` |
| POST | `/v2/studies` | `{id, profile}`; idempotent create, never reset an existing study |
| GET | `/v2/studies/{id}` | Snapshot/version/digest |
| POST | `/v2/studies/{id}/commands` | Validated command, one atomic business transition |
| GET | `/v2/studies/{id}/journal?after=0&limit=100` | Bounded ordered command log and cursor |
| GET | `/v2/studies/{id}/export` | Consistent snapshot plus all commands through that version |
| GET | `/v2/studies/{id}/readiness` | Synthetic capacity, unknown dependencies and overcommitment |
| GET | `/v2/studies/{id}/validation` | Missing/expired/stale/self-reported evidence; clinical use always false |
| GET | `/v2/studies/{id}/lab` | Synthetic FHIR requests and versioned report bundles |
| POST | `/v2/hardware/evaluate` | User-entered cost/check completeness; never executes a purchase |

Command envelope:

```json
{"requestId":"example-001","expectedVersion":0,"actor":"operator","action":"patient.arrive","args":{"patientId":"SIM-P1"}}
```

`/v2/protocol` publishes the full action and exact required-field map. Unknown fields, unsupported actions, malformed IDs and non-integer scenario quantities fail. Patients must use `SIM-` identifiers. Body reads are stream-bounded to 16 KiB. There are at most 32 studies per local DB and bounded patients/commands/reports per scenario. Export existing research before provisioning another DB; no unauthenticated reset/delete endpoint exists.

## Transaction contract

`type3_studies` owns profile/version/state/digest. `type3_commands` stores a unique `(study_id, sequence)` and `(study_id, request_id)` command journal. `type3_maintenance` is a separate operator heartbeat and cannot modify simulation state.

A D1 `batch()` performs:
1. Snapshot UPDATE conditioned on the previously read version, with a fresh random commit token.
2. Journal INSERT SELECT conditioned on that exact commit token.

The token prevents a losing compare-and-swap writer from appending the winning writer's sequence. A batch failure must roll back both writes. Concurrent identical commands return the same result; different commands at the same expected version conflict. Reusing an ID for a different action/actor/payload conflicts. After a timeout, retain the command and its request ID; read or retry that same command rather than inventing another ID.

All snapshots are checked against canonical SHA-256 digests on read. These checks detect accidental corruption but are **not signatures, authentic clinical attestations or a defense against an administrator rewriting the entire database**. A consistent export captures commands only up to the selected snapshot version, even during concurrent activity.

`scheduled` performs observational maintenance only. It must never use wall clock to advance a deterministic study. Clinical transitions are explicit commands. There is no in-memory authority, independent Durable Object copy, queue-based decision state, or hidden external HTTP dependency.

## Laboratory boundaries

`lab.order/receive/process/release/acknowledge` exercises specimen and report lifecycles. `lab.intake` imports the normalized synthetic report contract; `lab.fhir-intake` imports the bounded FHIR profile exported by `/lab`. Duplicate revisions with identical content do not create a second report; changed content under the same revision conflicts. Corrections after finalization require a new amended revision. Acknowledgments reference the current exact revision. Canceled/unprocessed requests cannot accept clinical-looking results.

This model does not automatically write to OpenMRS or OpenELIS. Real system connectivity requires a separate approved adapter/capability/configuration layer with actual patient identity and terminology ownership. Never run it alongside an independent order delivery mechanism for the same orders.
