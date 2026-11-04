# General live laboratory connector

This is not another synthetic LIS. It connects to the actual isolated OpenMRS O3 3.7.1, OpenELIS Global 3.2.3.0, source HAPI and result HAPI instances running on hetzner-master. The original fixed hemoglobin round-trip remains intact.

## Real product boundaries

| System | Authority | Connection |
| --- | --- | --- |
| OpenMRS FHIR2 + REST | Identity, installed concepts and chart observations | Authenticated private APIs |
| Source HAPI R4 | ServiceRequest + Task ordering source | Conditional FHIR transactions using stable order IDs |
| OpenELIS application | Accession, analyzer workflow, QC, result entry and release | The supported product workflow; no FHIR shortcuts |
| Result HAPI R4 | Validated results emitted by OpenELIS | Exact Task / DiagnosticReport / Observation / Specimen lookup |
| Private integration ledger | Delivery uncertainty, imported versions, chart-write intent | Local isolated SQLite/D1, never public demo D1 |

DO NOT insert DiagnosticReport or Observation directly into HAPI and expect OpenELIS to import it into its clinical UI. OpenELIS confirmed the app-to-HAPI result direction is one-way as of August 2026: https://talk.openelis-global.org/t/how-to-do-bi-directional-fhir-synchronization-between-openlisglobal-webapp-and-external-fhir-api/2398

The generalized connector supports arbitrary installed, reviewed test catalog entries; multiple patients; multiple independently correlated orders; source transaction idempotency; Task status lookup; versioned results; numeric UCUM, text, and coded observations. **Native multi-test panel handling is NOT yet verified:** issue individually correlated requests until that capability is proven. Chart import currently supports validated numeric final results only; amendments/text/coded results require review.

## Source files

- apps/worker/src/adapters/real/live-lab.ts: catalog, order planning, conditional submission, remote recovery, validated report extraction
- apps/worker/src/adapters/real/live-chart.ts: verified OpenMRS concept/unit mapping and guarded numeric chart return
- apps/worker/src/adapters/real/live-ledger.ts: persisted no-double-POST intents and result versions
- deploy/real/live-lab-migrations/0001_live.sql: private integration database only
- deploy/real/hetzner-master/live-lab-host.mjs: private host CLI; no public HTTP route
- scripts/build-live-connectors.mjs: bundles for local/air-gapped host
- tests/live-lab.test.mjs: test harness with product-shaped fake FHIR responses, not live-host validation

## Build and install on the existing private host

Use the existing approved deployment release process. From a checkout with package dependencies:

~~~sh
npm ci
node scripts/build-live-connectors.mjs
~~~

Copy the generated deploy/real/hetzner-master/dist/live-connectors.mjs to the corresponding release tree on hetzner-master. Include deploy/real/live-lab-migrations/0001_live.sql. Never copy or commit host private credentials, resolved Compose output, real patient data, cookie jars, TLS private keys or FHIR payloads.

The approved host uses loopback-only:
- OpenMRS http://127.0.0.1:18090/openmrs/ws/fhir2/R4 and /openmrs/ws/rest/v1
- Source HAPI http://127.0.0.1:18093/fhir
- OpenELIS result HAPI http://127.0.0.1:18091/fhir
- OpenELIS UI/API https://localhost:18443 (trusted private TLS)

The driver reads the existing private/lab-order-source.json by default, or a JSON file under the root-controlled private directory. Each independently persisted order needs an immutable orderNumber, patientId (the actual matching UUID), patientIdentifier/System, ownerId, authoredOn and testKey. Multiple orders may be supplied as an orders array, limited to 20. Only generated HF-SYNTH records are presently allowed for writes.

Install a reviewed OpenELIS test catalog in private/live-lab-catalog.json. Example shape (placeholder ID MUST be replaced by actual installed data):

~~~json
{
  "hemoglobin": {
    "key":"hemoglobin", "loinc":"718-7",
    "specimen":"Whole Blood", "enabled":true,
    "openElisTestId":"ACTUAL_INSTALLED_TEST_ID"
  }
}
~~~

Until the reviewed catalog file is provided, the driver reads only the existing installed hemoglobin evidence. Add CBC, renal, electrolyte and blood-gas mappings after configuration on actual OpenELIS, not by assuming LOINC support.

### Read-only inspection

~~~sh
base=/mnt/master-apps/hospital-fabric
node --experimental-sqlite "$base/release/deploy/real/hetzner-master/live-lab-host.mjs" inspect
~~~

Inspects exact existing order identity and, if genuinely completed by OpenELIS, validates Task -> report -> analysis -> observations -> specimens. Logs only states and counts, NOT patient IDs, values, credentials or raw FHIR.

### Submit a new approved synthetic order

~~~sh
export HF_LIVE_SANDBOX_WRITES=1
node --experimental-sqlite "$base/release/deploy/real/hetzner-master/live-lab-host.mjs" stage "$base/private/lab-cases/case-002.json"
~~~

Requires recent private conditional-create conformance evidence, real preexisting OpenMRS/source-HAPI patient and practitioner identities, and an installed reviewed test mapping. The private journal records the immutable intent. After any ambiguous network outcome, it reconciles the original order before considering further action; it never blindly resubmits.

Successful source FHIR staging is NOT laboratory acceptance, specimen accession or result release. Those remain real OpenELIS application workflows.

### Return an authorized numeric final result to OpenMRS

Create private/live-lab-openmrs-concepts.json with actual installed Concept UUID and units, keyed by mapped LOINC, e.g.:

~~~json
{"718-7":{"uuid":"ACTUAL_INSTALLED_CONCEPT_UUID","units":"g/dL","datatype":"Numeric"}}
~~~

Only after a real, reviewed product-release conformance exercise:

~~~sh
export HF_LIVE_SANDBOX_WRITES=1 HF_LIVE_CHART_IMPORT=1
node --experimental-sqlite "$base/release/deploy/real/hetzner-master/live-lab-host.mjs" chart "$base/private/lab-cases/case-002.json"
~~~

This verifies the exact synthetic patient, chart concept/unit, accession, result ID/version and source relationships. A durable chart intent is stored BEFORE HTTP POST. A result is read back via OpenMRS REST and FHIR; if the outcome is unknown, automatic retries are prohibited. Changes to a released report require review, not a second automatic chart write.

## Remaining live acceptance requirements

GitHub mock transport/SQLite tests do not constitute a verified generalized deployment. The already observed one-test hemoglobin flow proves the host is real, not that arbitrary configured tests work.

Run the new host driver against at least two independently registered synthetic patients and two installed test definitions. Exercise local host restart, ambiguous order ACK, duplicate suppression, late/amended result, OpenMRS chart duplicate reconciliation, and actual lab acceptance. Obtain a clinical/lab operator's approval of test/catalog workflow changes. Capture sanitized evidence tied to exact component versions. No real patient data or clinical use is authorized.

For a given cohort, choose ONE writer: either OpenMRS Lab on FHIR or hospital-fabric. Do not enable both independent order dispatchers.

The Type 3 v2 simulator remains a separate deterministic research environment and is not a substitute for OpenELIS.
