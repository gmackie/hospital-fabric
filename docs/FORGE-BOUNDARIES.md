# Repository boundary: Forge vs hospital-fabric

The reusable compiler/runtime is **gmackie/forgec**, not an existing `gmackie/forge` repository (as of 2026-10-10). This repository is a **consumer** of Forge, not a fork or implementation of it.

## Keep in Forge

- Generic resource declarations, validation and lifecycle mechanics.
- Generated CRUD APIs, typed clients, migrations, policy and infrastructure adapters.
- Generic idempotency/outbox primitives where demonstrated by Forge's conformance tests.
- No FHIR-specific or hospital-specific assumptions in the generic compiler.

## Keep in hospital-fabric

- OpenMRS, OpenELIS, Orthanc, OpenBoxes and instrument connectors.
- Clinical cross-system event mapping, provenance and reconciliation semantics.
- Local-first hospital operational configuration, device compatibility manifests.
- Typed Effect Worker APIs, adapters, simulation and fault-injection tests.
- Deployment profiles for local celld / workerd with external clinical services.

## Current milestone (intentionally limited)

- The executable demo uses hand-maintained D1 SQL migrations. It contains a **draft** Forge resource model in `forge/` for facility, component instance and device passport.
- The Forge model is **not generated, compiled, or connected to live tables**. The compiler was not available in this execution environment; do not represent this model as a passing forgec build.
- After `forgec check forge` and an explicit migration comparison, let Forge own facility/component/device data. Do not run two schema writers in the same DB.
- Leave `integration_operations`, `outbox`, `inbox` and `reconciliation_cases` as explicitly managed integration state until Forge's atomic event/recovery semantics are proven with the failure tests.
- Source EMR/LIS/PACS databases are never modified directly. All real connectors must use supported external APIs.

## Suggested integration gate

1. Pin one forgec commit/release and record its target and portable-profile certification.
2. Run `forgec check forge` and fix parser/type errors against that exact version.
3. Run `forgec build forge --target cloudflare` (or its currently supported profile), inspect SQL migrations and API names, and compare with the prototype schema.
4. Define one authoritative migration path, add compatibility checks and remove duplicates.
5. Prove the complete lost-ack / restart / duplicate-delivery suite under celld and workerd before accepting the generated runtime.
