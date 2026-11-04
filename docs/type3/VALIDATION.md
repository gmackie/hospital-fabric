# P6: evidence, safety and clinical partner gates

The implementation deliberately cannot produce a clinical authorization. Every status/export reports `clinicalUseAllowed:false`. `evidence.record` accepts synthetic claims only; the digest is an artifact reference supplied by the caller, not independently verified provenance. Recording a hash and a demo role does not prove the artifact exists, the evidence is sound, or the author is qualified. Evidence cannot be edited under the same ID, is bound to the configuration revision, and expires against the scenario clock.

## Required external reviewers

| Gate | Accountable reviewer | Evidence to obtain, not fabricate |
|---|---|---|
| Runtime/recovery | Hospital IT and infrastructure owner | Real workerd/celld compatibility, independent restore, power/WAN/LAN failure tests, RTO/RPO |
| Identity/security | Clinical informatics and security lead | Verified roles, local identity/SSO, audit, access/retention policy, threat model, incident response |
| Lab correlation | Laboratory director | Approved catalog and units, specimen identity, instrument QC, real LIS/EMR panels, amendments and critical-result processes |
| ICU dependencies | Critical-care and nursing leads | Individual staffing/competencies, clinical service limits, equipment/utilities, downtime and transfers |
| Surgery/sterility | Surgical/anesthesia and sterile-processing leads | Facilities, validated reprocessing, checklists, recovery staffing and instrument traceability |
| Referral/handover | EMS/EMT coordination lead | Receiving agreements, transport, authorized PACE communications, capacity reservations, documented clinical handoff |
| Device bench | Qualified biomedical engineer | Exact model/firmware/accessories, decontamination, recalls, electrical/performance testing, service and acceptance records |
| Clinical review | Sponsoring clinical organization | Intended-use review, jurisdictional approvals, complete readiness exercise and explicit clinical go/no-go decision |

Synthetic successful tests are useful engineering evidence but do not replace these reviews. A WHO classification claim requires the organizational assessment process, not a software badge. No real patient pilot, device purchase, source-system production change or external outreach is authorized by this code alone.

## Hazard register

| Hazard | Implemented control | Still required |
|---|---|---|
| Duplicate resource/order after lost response | Stable request IDs, persisted receipts, transactional CAS+journal, restart/concurrency tests | Runtime qualification with actual deployed versions |
| Wrong-patient result | Exact patient/order/specimen/test correlation, no fuzzy matching | Actual EMR/LIS identity governance, local clinical testing |
| Old report acknowledged after amendment | Immutable report versions; acknowledgment bound to latest revision | Clinician escalation and communication SOPs |
| Stale capacity shown as healthy | Unknown/expired declarations explicitly block new simulated admissions | Validated measurement sources, staff processes and safety review |
| Failed device disappears from an occupied bed | Assignment retained; affected patient IDs visible | Independent medical device alarms and qualified response |
| Double-booked theatre/ICU | Single authoritative atomic transition across resources | Real scheduling/infrastructure qualification |
| Failed sterilization treated as complete | Quarantine; cleaning + passing cycle + distinct simulated reviewer | Actual validated sterilizer operation and qualified release |
| Message delivered interpreted as patient accepted | Delivery and clinical handoff states separate | Formal referral and communications agreements |
| Cheap auction lot counted as usable equipment | Unknown costs/checks hold buying screen; no clinical promotion | Physical acceptance and service support |
| Fabricated clinical assurance | Synthetic-only claims; no path to clinical approval | Authentic signatures, evidence review and governance |

## Acceptance execution levels

1. **Core/SQLite:** `node scripts/type3-check.mjs`. Includes disk close/reopen, atomic rollback, conflicting and identical concurrent commands, invalid messages and deterministic replay.
2. **Worker runtime:** `node scripts/type3-build.mjs`, full TypeScript check, then `node scripts/type3-smoke.mjs`. This performs an actual local workerd restart with a deliberately dropped HTTP response. It does not cut power or disconnect the physical WAN.
3. **celld:** use the same smoke with `CELLD_BIN` pointing at the separately installed/pinned binary. Record version and result independently; a workerd pass does not qualify celld.
4. **Hardware bench:** execute HARDWARE.md using real, accepted test equipment; retain raw evidence and limitations.
5. **Clinical simulation:** sponsoring professionals run the approved protocol with synthetic patients, observed workflows, debrief and signed findings.
6. **Clinical deployment:** a separate program, outside the scope or authorization of this PR.

The runtime/bench/clinical entries are not checked off by committing this document. Attach actual results to the exact code and configuration tested.
