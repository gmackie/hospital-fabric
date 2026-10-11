# Weekend build acceptance

This checklist reconstructs the concrete acceptance work from ChatGPT PRs [#1](https://github.com/gmackie/hospital-fabric/pull/1) and [#3](https://github.com/gmackie/hospital-fabric/pull/3), plus deployed real-service work in [#4](https://github.com/gmackie/hospital-fabric/pull/4). It is separate from the broader M1–M7 clinical roadmap.

## Completed and repeatable

- Public synthetic walkthrough on https://med.gmac.io: visitor isolation, persisted lost acknowledgment, reconciliation, one imported result. Cloudflare Workers and separate D1 authorities; no celld requirement for this deployment.
- Local React operator console and workerd process-group SIGKILL/restart recovery, with stable destination identity and no duplicate order/result/chart entry.
- Private pinned OpenMRS/OpenELIS fixed synthetic hemoglobin round-trip on hetzner-master; repeated return retains the same chart observation. The public proof publishes only the fixed value and verification time. See [host evidence](HETZNER-MASTER.md).
- celld **0.6.2** crash/restart acceptance passes locally on Apple Silicon. The harness kills its launcher and separately grouped serving descendants, confirms HTTP is unavailable, inspects the first persisted D1 epoch, then restores and reconciles. After completion, it copies the stopped project/storage, deletes only the copy’s runtime cache, starts another runtime against that backup, and checks actual recovered bindings: exactly one original LIS order, one released report, one chart result, and completed operation. Old celld SQLite epoch files are not authoritative after recovery. The inspection wrapper exists only in the temporary test project and is never deployed.
- Forge compiler **0.5.0** checks/builds the draft with zero warnings. Generated D1 migrations pass isolated SQLite integrity and foreign-key checks. CI repeats compiler and celld validation on Linux.

```sh
npm ci
npm run tools:validation
npm run check
npm run check:forge
npm run smoke:workerd
npm run smoke:celld
npm run test:console
```

The installer uses fixed release URLs and archive SHA-256 hashes in `scripts/install-validation-tools.py`; binaries stay in ignored `.validation-tools/bin`. It supports Apple Silicon macOS and arm64/x86_64 Linux. `FORGEC_BIN` and `CELLD_BIN` can select explicit local binaries. Download tools and npm dependencies while online. These checks use temporary storage and do not touch the interactive databases or deployed product stack. `SMOKE_TRACE=1` prints synthetic request responses; `SMOKE_KEEP_STATE=1` retains the isolated test directory for investigation.

## Schema ownership decision

No generated migrations or APIs are enabled. The executable manual schema remains the only owner of live data.

| Manual registry | Generated registry | Migration gap |
| --- | --- | --- |
| `facilities` | `facility` | Generated code/enabled/version/updated_at fields; manual demo_only invariant; integer vs text timestamps |
| `component_instances` | `component_instance` | facility_id vs facility; release_version vs manual product version; generated row version; missing endpoint/capabilities |
| `medical_devices` | `device_passport` | Facility/serial/readiness naming and enum differences; missing component/interface/metadata; generated row version/timestamps |

Generated `_forge_assert`, `forge_audit`, `forge_outbox`, `forge_processed`, `forge_document` and `forge_receipt` have different semantics from existing integration state. Passing syntax and isolated generation does not establish lost-ACK/recovery compatibility for generated APIs. The next migration gate is an explicit data conversion and ownership cutover for registries, preserving manual integration operations/outbox/inbox/reconciliation until their replacement is qualified.

## Still open

- **HF-2**: ForgeGraph app registration now exists (`hospital-fabric`, ID `b09a0a0c-7841-4099-92c2-3f9c18ef66ae`), and `.forgegraph.yaml` identifies it. Repository linkage and changeset creation return 404 because the current server resolves only its Forgejo registry. GitHub source/CI and manually deployed Cloudflare versions still lack production evidence synchronization. Do not create a second repository or deploy generated Kubernetes scaffolding to bypass this gap. HF-1/HF-3 stay open pending exact revision, deployment and health evidence.
- Physical WAN-disconnection with local LAN/DNS intact. Request blocking and local process termination do not satisfy this check; it needs a representative network exercise.
- Full host reboot, off-host backup restore, physical power-loss and multi-node ownership/failover exercises. Individual product restarts have passed; they do not establish these wider properties. A reboot of shared hetzner-master must be coordinated with its other workloads.
- FHIR catalog reconciliation and a general multi-patient connector, production identity/operator exception handling, and clinician review remain beyond the fixed synthetic workflow. The M1–M7 roadmap remains future work.

HF-4 tracks publication of the runtime/compiler acceptance work. No clinical readiness is claimed by this checklist.
