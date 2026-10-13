# Type 3 research workbench — P0 through P6

This is an additive, **synthetic-only engineering implementation**, not a deployable Type 3 hospital, clinical decision-support tool, validated LIS, alarm system or WHO verification. No existing `/hospital` v1 model, API, digest, public deployment or source clinical database is changed.

## What is implemented versus what needs external work

| Phase | Executable scope | Remaining real-world gate |
|---|---|---|
| P0: deployment profiles | Versioned Type 2/3 planning profiles; separately counted ward, ICU, theatre and recovery resources; mission windows; advertised v2 contract | Full WHO checklist review, site plan and approved staffing/equipment budget |
| P1: ICU dependencies | Atomic bed/device reservations; fresh/unknown/expired staffing, oxygen, power, suction and support declarations; overcommitment; failures retain patients | Individual staff rostering, clinically validated resource models, utilities and bedside systems |
| P2: advanced laboratory | CBC, electrolytes, renal, blood gas and microbiology synthetic panels; specimen custody; final/amended versions; critical-result acknowledgments; narrow FHIR R4 profile import/export and exact correlation | Actual OpenELIS/OpenMRS deployment capability tests, approved terminology, analyzer drivers, LIS/QC and clinical validation |
| P3: surgery/sterile processing | Two theatres; exclusive team/set/PACU booking; start-time readiness recheck; irreversible operation states; instrument cleaning/cycle/quarantine/review; stock conservation | Clinical scheduling/anesthesia integration and professionally validated reprocessing systems |
| P4: referrals/comms | Queued → sent → acknowledged messages separate from acceptance, reservations, transit, arrival and handover; simulated WAN/radio/satellite paths | Actual radio authorization, communications hardware, referral agreements and secure cross-facility exchange |
| P5: hardware testbed | Device passport fixtures; isolated synthetic telemetry; monotonic device messages; complete-cost buying screen; bench and procurement templates | Equipment purchase/loan, biomedical inspection, actual interfaces, safety and performance tests |
| P6: validation | Immutable, hash-referenced synthetic evidence claims; configuration/expiry checks; eight mandatory external review categories; replay export | Named clinical sponsor, genuine evidence verification and signoffs, governance/security/clinical acceptance, WHO classification process |

P5/P6 provide tools and gates, not acquired equipment, a physical test or a clinical signature. A code change cannot finish those external activities. P2 does **not** make our narrow synthetic FHIR profile a general OpenELIS integration. The existing fixed hemoglobin proof remains independent and unchanged.

## Run

From the repository root, with the existing lockfile dependencies installed:

```sh
npm ci
node scripts/type3-check.mjs
node scripts/type3-build.mjs
npx tsc -p apps/type3-worker/tsconfig.json
node scripts/type3-secrets.mjs
npx wrangler dev --config apps/type3-worker/wrangler.jsonc --local --ip 127.0.0.1 --port 8788
# Or, in a separate run (not the same DB):
celld dev apps/type3-worker --host 127.0.0.1 --port 8788
```

Open `http://127.0.0.1:8788`, enter the generated local token, initialize the separate research database, and create a study. The token is not stored in browser storage. Pending synthetic commands retain their original IDs in session storage across reloads. Bind address/port are CLI options because celld 0.6.2 rejects Wrangler's `dev` configuration block.

The worker requires `ENABLE_TYPE3_RESEARCH=1`, rejects non-loopback request URLs, and rejects every request when `PUBLIC_DEMO=1`. The default D1 ID is a **local placeholder**, not a provisioned cloud database. There is no deploy command or cloud migration in this contribution.

The model is pure TypeScript; the standard Worker `fetch`/`scheduled` host uses the repository's pinned Effect dependency. D1 owns one versioned JSON snapshot plus its atomic command journal. It is intentionally separate from both existing fabric tables and the simulated/real LIS databases. Do not edit source OpenMRS or OpenELIS schemas.

## Exercise all seven workstreams

```sh
# Read the local token from apps/type3-worker/.dev.vars into your environment.
export TYPE3_API_KEY='your-generated-local-token'
node scripts/type3-demo.mjs /tmp/type3-evidence.json
python3 scripts/type3-replay.py /tmp/type3-evidence.json
# Optional: prove every transition against the running worker in a NEW study.
python3 scripts/type3-replay.py /tmp/type3-evidence.json \
  --url http://127.0.0.1:8788 --study another-replay
```

The exercise admits a synthetic ICU patient, removes and restores oxygen capacity, processes a critical blood-gas panel, completes a surgical/reprocessing workflow, receives a referral over a simulated radio path while modeled WAN is unavailable, accepts read-only synthetic device observations and records an evidence reference. The final report explicitly says `physicalHardwareTested: false`, `clinicalValidation: false` and `wanDisconnection: model-only`.

`type3-replay.py` without `--url` verifies canonical checksums and journal structure, **not** transition correctness. With `--url`, it negotiates v2 and compares every returned transition digest against the export. It does not pretend to be a separate Python implementation of the hospital engine. Existing Kybernos v1 consumers must not silently upgrade; add a v2 adapter explicitly. All model decisions use the same command protocol whether issued by a person, script or external research agent.

## Capacity assumptions

The Type 3 scenario uses **40 ward beds plus 4 ICU beds (44 total)**, two theatres and four PACU bays. This is a conservative design choice, not an assertion that WHO requires 44. It deliberately does not hard-code the earlier proposed 36+4 interpretation as verified. The classification review must resolve bed accounting and the complete service specification. Four PACU bays and equipment/spare allocations are our modeling assumptions.

The Type 2 scenario uses 20 ward beds, no ICU, one theatre and two PACU bays. Its synthetic lab menu intentionally starts with hemoglobin only; it is **not** a complete implementation of the WHO Type 2 test menu. Type 3 panels use local `urn:hospital-fabric:demo-*` codes and the literal result `SYNTHETIC`, not unreviewed LOINC mappings, clinical numbers, diagnostic thresholds or dosing instructions.

Dependencies are time-limited **simulation declarations**. Supported ICU capacity is a conservative scenario upper bound; clinical teams must not use it for admission decisions. Device telemetry is observational and cannot repair devices, allocate resources or advance patient care. Reduced resources mark overcommitment/at-risk assignments; the model never automatically evicts an ICU patient. Whole-team/theatre tokens are not a validated person-by-person shift roster.

## Primary references

WHO, *Classification and minimum standards for emergency medical teams* (2021), ISBN 9789240029330: https://extranet.who.int/emt/sites/default/files/BlueBook2021.pdf . Reviewed printed pp. 18–19 (typology/duration), 55 (ICU), 68 (lab). These are source pointers, not a reproduced checklist or endorsement. The complete standards, host-country requirements and qualified assessors govern actual deployment.

FHIR R4 reference: https://hl7.org/fhir/R4/diagnosticreport.html and https://hl7.org/fhir/R4/servicerequest.html . The local subset requires exact patient/order/specimen references and rejects duplicate/dangling observations. No statement of full FHIR server conformance is made.

## Files and ownership

- `apps/type3-worker/src/model.ts`: deterministic scenario, validated commands and exclusive resources.
- `laboratory.ts`: synthetic panels and bounded FHIR mappings.
- `storage.ts`: atomic compare-and-swap + token-fenced journal, replay and export.
- `hardware.ts`: procurement checks and read-only synthetic observation boundary.
- `api.ts` / `index.ts`: private local HTTP surface and Effect host.
- `forge-type3/`: separate proposed Forge metadata contract, not a second live schema writer.
- `hardware/type3/`: unpriced buying/bench templates; no inventory or clinical readiness claims.
- `tests/type3/`: actual SQLite, persistence failures, concurrency, replay, resource and workflow tests.

See [API](API.md), [safety/validation gates](VALIDATION.md) and [hardware plan](HARDWARE.md).
