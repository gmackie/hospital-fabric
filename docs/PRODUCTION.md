# Production blockers — mandatory before real clinical integration

**Not clinically deployable.** This repository is a synthetic development scaffold. Do not ingest PHI, route clinical orders, administer medications, trigger clinical alarms, or serve as a hospital's system of record.

1. **Runtime qualification:** `celld` beta requires review, patch/security cadence, trusted isolated network, qualified object storage, verified fleet backup/restore and ownership failover testing. Workerd and celld require compatibility testing. Service availability during object-storage loss cannot be assumed.
2. **Real authentication:** Replace the demo token with a locally available OIDC/identity provider, strong service-to-service credentials, role and purpose-based authorization, audited emergency access, TLS and key lifecycle management.
3. **Data security:** Threat model, PHI minimization, encryption at rest and in transit, retention and deletion policy, logs without PHI, vulnerability monitoring, incident response, and relevant legal/contractual safeguards.
4. **Clinical authority:** OpenMRS/OpenELIS/PACS remain systems of record; clinically licensed leads must define and validate order states, results, corrections, cancellations, identity links, patient merges and downtime procedures.
5. **Terminology:** Approved LOINC/UCUM mapping versioning, panel handling, specimen requirements, corrected results, reference ranges and critical-result workflows.
6. **Robust delivery:** Authenticated destination lookup before resubmission, timeouts, bounded retries, lease/fencing validation, message amendments, multi-site sync policies, DLQs, monitoring, backup restoration and manual reconciliation.
7. **Device safety:** No direct control of medical devices, ventilators, infusion pumps or alarms without appropriate safety engineering, qualification and regulatory review. Only supervised read-only integration research initially.
8. **Evidence:** Test matrix, reproducible deployments, software bill of materials, configuration validation, disaster exercises, cybersecurity review, clinical acceptance and operator training.
9. **Infrastructure:** Off-grid UPS, time synchronization, DNS, LAN redundancy, independent authorized voice communications and paper fallback. WAN loss must not imply LAN loss.
10. **Lifecycle:** Signed pinned images, offline artifact mirror, migrations and rollback tested against representative backups, maintenance support and observability.

## Follow-up implementation sequence

M1: Exact modern OpenMRS adapter and API capability declaration.
M2: OpenELIS Global adapter with FHIR R4 ServiceRequest/Task/DiagnosticReport mapping and safe identifier correlation.
M3: Production operator console and supervised exception resolution. A synthetic-only local React console now demonstrates the existing simulator workflow; real identity, clinical exception resolution and production audit remain unimplemented.
M4: Orthanc/OHIF DICOM order-to-study matching.
M5: OpenBoxes pharmacy/stock integration and verified lot movements.
M6: Medical-device compatibility passport and isolated serial/HL7/ASTM gateways.
M7: Offline multi-facility federation, encrypted referral exchange, PACE comms, utility monitoring and Type 2 readiness model.
