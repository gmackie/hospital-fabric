# OpenMRS + OpenELIS synthetic integration

This slice prepares private installations and protocol clients. **It does not connect med.gmac.io to real services yet.** The existing demo remains the simulator until the acceptance checklist below passes. Only generated `HF-SYNTH-…` identities may be used. Never point this stack at a hospital deployment or import patient data.

## What is implemented

- Official-source provenance with source URL and blob SHA in `deploy/real/upstream/provenance.json`.
- Private Compose overlays for OpenMRS O3 3.7.1 and OpenELIS Global 3.2.3.0. All published ports are loopback-only, database ports are removed, and image/password inputs are required. They must be applied to the **full upstream release checkouts**, not run alone.
- A resolved-Compose preflight checker that rejects mutable images, non-loopback published ports, privileged services and host networking.
- A bounded server-side FHIR R4 transport. Redirects are rejected, credentials remain server-side, response bodies are capped, and HTML login pages or wrong resource types are errors.
- Exact synthetic patient reads from OpenMRS; single-test OpenELIS-compatible ServiceRequest + Task builders; guarded FHIR-source staging; and correlated Task status inspection.
- Protocol tests with fake transports. These demonstrate client behavior, **not conformance of installed OpenMRS/OpenELIS/HAPI versions**.

Private containers and host-generated credentials are now provisioned on `hetzner-master`. See [the host runbook](HETZNER-MASTER.md) for runtime status, pinned images, verification and limitations. The public demo still uses its synthetic simulator.

## Recommended next implementation path

First reproduce the official integrated demo privately, before expanding the custom bridge. [DIGI-UW/openelis-openmrs-hie](https://github.com/DIGI-UW/openelis-openmrs-hie) includes OpenMRS 3.5.0, OpenELIS 3.2.2.0, Lab on FHIR 1.5.3, seeded LOINC tests and routing configuration. This is the quickest reference for proving registration → Electronic Order → verified result → chart. It uses an additional HAPI shared record/OpenHIM/Mongo stack, including old components; use a disposable isolated synthetic environment, review/pin all images, replace public defaults and expose no public APIs. Its existence is evidence of a configured reference, not proof it boots or is secure today.

After reproducing the flow, choose between upgrading that reference stack or a smaller modern OpenMRS 3.7.1/OpenELIS 3.2.3.0 stack using the private overlays below. The smaller stack reduces components but needs explicit catalog/mapping and protocol validation. Avoid running Lab on FHIR and a custom order sender together. The clients in this change remain optional tested building blocks; they are not a reason to replace a working official flow. The authorized smaller stack is deployed privately on `hetzner-master`; real laboratory workflow verification remains the next dependency.

## Host and installation

Use a dedicated synthetic-demo host with Docker Engine and Docker Compose 2.24.4+ (the overlays require `!override`/`!reset`). OpenELIS's upstream composition targets AMD64. Assess actual resources after boot; upstream application, databases and two UIs are substantially larger than the current Worker. Persistent named volumes need backup and a documented reset procedure. The host-specific overlay supports the installed isolated Podman runtime; see the host runbook.

1. Obtain full official repositories at these refs:
   - https://github.com/openmrs/openmrs-distro-referenceapplication/tree/3.7.1
   - https://github.com/DIGI-UW/OpenELIS-Global-2/tree/3.2.3.0
2. Verify compatible release images with the upstream registry and pin **each** as `repository@sha256:<64 hex>`. The OpenELIS compose at release tag 3.2.3.0 still names `develop` images. A source tag is not an immutable runtime pin. The overlays intentionally have no invented digest. Required image variable names appear in the two private overlays.
3. Provision private initial admin/database/keystore passwords through the host's secret workflow. Do not commit `.env` files. The authorized host preparation generates private credentials on the host. Upstream sources contain public default passwords: never deploy without the overlays and completed secret/config review.
4. Prepare a private copy of OpenELIS `common.properties` outside this repository and set `OE_COMMON_PROPERTIES_FILE` to its absolute path. Its `server.ssl.key-store-password`, `server.ssl.key-password`, and `server.ssl.trust-store-password` must match `SSL_KEYSTORE_PASSWORD` / `SSL_TRUSTSTORE_PASSWORD`; provision `encryption.general.password` separately and configure the FHIR settings below. Compose does not interpolate variables inside this properties file. The overlay deliberately refuses to silently use upstream default properties. Keep upstream bind mounts intact. OpenELIS needs its complete `configuration/` and other release assets; the provenance records in this repo are not a replacement checkout.
5. In the OpenMRS checkout, with required variables supplied by the host, validate before starting:

   ```bash
   set -o pipefail
   docker compose -p hf-openmrs -f docker-compose.yml -f /absolute/hospital-fabric/deploy/real/openmrs.private.yml config --format json | python3 /absolute/hospital-fabric/deploy/real/check-compose.py && \
   docker compose -p hf-openmrs -f docker-compose.yml -f /absolute/hospital-fabric/deploy/real/openmrs.private.yml up -d
   ```

   Repeat in the full OpenELIS checkout with project `hf-openelis` and `openelis.private.yml`. Always pass the base filename explicitly so development overrides are not implicitly loaded. Do not save resolved config output: it contains passwords.
6. OpenMRS is loopback port 8090; OpenELIS proxy ports 8092/8443; its HAPI FHIR store is loopback port 8091 with base `/fhir/`. No database host port is allowed. The `hetzner-master` host uses ports 18090/18091/18092/18443; confirm these paths against the running build. Use an authorized SSH port-forward for a remote host. Establish properly trusted TLS; do not bypass certificate warnings. Do not expose upstream defaults to the internet.
7. Verify startup, rotate/default-disable all application access, and configure a narrowly scoped synthetic integration identity. Host deployment and synthetic credentials are authorized in this session. An upstream healthcheck alone is not proof of usable APIs.

## Architecture for the eventual connected demo

The public Worker remains a bounded synthetic UI/BFF. An authenticated private bridge reaches the private OpenMRS and OpenELIS services. Browser callers never supply backend URLs, credentials, identifiers, test codes, arbitrary FHIR, or admin actions. They select from fixed synthetic scenarios; the bridge owns correlated IDs, bounded session leases, request limits and durable replay state. Public return data must be an allowlisted synthetic projection, not upstream response bodies. Hosting, trusted TLS, private access, service credentials and authorization/rate limits need verification before enabling this route. Do not expose the existing operator API or proxy clinical APIs through the public Worker.

The first real flow should be one synthetic patient and one verified active LOINC test:

1. Register/verify a generated `HF-SYNTH-…` patient in OpenMRS, using its supported registration API/UI. `readSyntheticOpenMrsPatient` verifies the configured exact identifier and refuses fuzzy/ambiguous matches. It does not register or merge patients.
2. Persist a correlation record containing source patient ID, FHIR-source patient ID, stable external correlation keys and server-assigned Task/ServiceRequest IDs, external order number, test and owner. The external order number and bundle reference keys must be generated once and durably retained across restart; persist server-assigned IDs from successful receipts or exact reconciliation. Do not use a fresh random ID on each retry.
3. Materialize a minimum synthetic Patient with the OpenELIS-supported identifier in a shared source FHIR store. The minimal candidate topology uses the **co-resident OpenELIS HAPI store** for both source and results; upstream integration examples set `fhirstore.uri` and `remote.source.uri` to the same HAPI URL. Verify this topology against the pinned product versions; a separate source store remains an optional isolation choice. OpenMRS FHIR2 write support must be verified before selecting OpenMRS itself as the Task source; do not assume its Task API or transactions support all HAPI semantics. The staging client requires this Patient to already exist and does not overwrite it.
4. Set OpenELIS `org.openelisglobal.remote.source.uri` to that source, `remote.source.identifier` to the exact `Practitioner/<id>`, and `remote.source.updateStatus=true`. Configure private trust and required authentication. For the co-resident topology, read completed Tasks directly from that store and leave `fhir.subscriber` unset; subscribing a store back to itself can loop. For separate stores, configure result return/subscription separately. Do not read database tables. Its app facade `/api/OpenELIS-Global/fhir` is **not** the HAPI `/fhir` store and does not accept transactions or Task writes.
5. Verify conditional `POST` with `ifNoneExist=identifier=…` inside transactions against the pinned source server. The live HAPI 6.6.0 check showed that `PUT` with transaction `ifNoneMatch: *` resets an accepted Task; that strategy has been replaced. Conditional creation passed replay and concurrent replay checks: it returns the same server-assigned IDs and preserves accepted status/version. Only enable `conditionalCreateTransactionsVerified` after this check passes for the deployed server. Persist creation receipt IDs; on an ambiguous receipt, `reconcileOpenElisTask` resolves the exact order identifier and validates the correlated resources. Metadata alone does not establish this.
6. Stage the fixed ServiceRequest/Task transaction. Two HTTP 201 receipts mean `awaiting_lab`, not accepted; HTTP 200 conditional receipts require reconciliation and do not claim fresh creation. On a timeout/409/412, inspect the existing stable Task and request before deciding anything; do not blindly replay or reset status. The source and co-resident store may differ in availability and status timing.
7. OpenELIS polls requested Tasks (upstream default 120 seconds), maps the LOINC code and presents Electronic Orders. Acceptance/rejection is read from a matching Task. Specimen ambiguity requires lab workflow handling. Record the actual accepted sample/order correlation.
8. Enter/validate a synthetic result through OpenELIS workflow. Inspect completed Task outputs on its HAPI store; fetch and validate the DiagnosticReport and Observations, final/amended status, patient, test, units and correlation before displaying/importing. **Result validation/import into OpenMRS and bridge-backed public sessions are not implemented in this slice.** The upstream IG warns that generated ServiceRequest.basedOn may use the external order number rather than incoming FHIR ID; keep the explicit map and do not correlate by patient alone. Amendments need version-aware handling, not report-ID-only suppression.

OpenMRS O3 3.7.1 includes FHIR2 but not Lab on FHIR. Choose either this bridge or an installed/configured Lab on FHIR sender; enabling both risks duplicate transmissions.

## Tests and read-only probe

```sh
npm run test:real-contracts
npm run check
OPENMRS_FHIR_URL=http://127.0.0.1:8090/openmrs/ws/fhir2/R4 \
OPENELIS_STORE_FHIR_URL=http://127.0.0.1:8091/fhir \
npm run probe:real
```

Provide existing authorization headers through the host secret environment using `OPENMRS_AUTHORIZATION` and `OPENELIS_STORE_AUTHORIZATION`, never source code or command-history literals. Optional `HF_IDENTIFIER_SYSTEM` + `HF_SYNTHETIC_IDENTIFIER` enables exact patient verification. The probe is read-only and does not establish order acceptance or result import.

## Completion gate

- Immutable images and full configuration verified; compose preflight and actual startup succeed.
- Private credentials/TLS/host access approved and configured; no database/admin/API public exposure.
- Actual source server passes conditional-create transaction replay tests.
- Actual OpenMRS synthetic registration and exact lookup pass.
- One real OpenELIS Electronic Order is accepted exactly once, then completes with verified synthetic result.
- Bridge survives lost acknowledgment and process restart without duplicate order or status reset.
- Result is validated and returned to the correct OpenMRS synthetic chart; duplicate and amended results handled.
- Public scenario hook reaches only fixed synthetic fixture operations and passes cross-session/rate-limit/privacy tests.
- Only after all of the above may the demo label this path connected to real OpenMRS/OpenELIS.

Official source details: [OpenMRS FHIR guide](https://fhir.openmrs.org/), [OpenELIS workflow](https://github.com/DIGI-UW/openelis-global2-fhir-ig/blob/main/input/pagecontent/workflows.md), [API distinctions](https://github.com/DIGI-UW/openelis-global2-fhir-ig/blob/main/input/pagecontent/api.md), [known correlation issues](https://github.com/DIGI-UW/openelis-global2-fhir-ig/blob/main/input/pagecontent/known-issues.md), [upstream co-resident source example](https://github.com/ozone-his/eip-openelis-openmrs#steps-to-run) (its bridge is marked incomplete, so use this as topology evidence, not current E2E certification).
