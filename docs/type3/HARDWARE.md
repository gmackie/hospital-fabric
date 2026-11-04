# P5: hardware and procurement work package

No equipment is owned, purchased, received, calibrated or clinically accepted merely because it is listed here. All numbers are **proposed research planning quantities**, not verified vendor offers or a WHO bill of materials. Keep engineering-bench and patient-care equipment physically and administratively separate.

## Bench assembly sequence

Start with an existing computer, isolated switch, second client, barcode simulator/printer, independent backup medium and a UPS appropriate to the computer load. Run the Type 3 Worker and the existing clinical application containers on the LAN. Keep medical devices and protocol gateways on an isolated segment with no internet ingress. Native alarms/control remain independent.

Add one borrowed/surplus device only after identifying its exact model, firmware, interface, accessories, service options and regulatory/clinical acceptance boundary. For monitor/ventilator interoperability, use a suitable manufacturer-compatible simulator and supervised read-only output. Do not connect a human or animal, modify alarms, or command life-support hardware through this prototype.

Laboratory bench work starts with captured synthetic messages and an analyzer emulator. No cultures, human specimens or diagnostic reporting are needed. Imaging work starts with synthetic DICOM fixtures, not X-ray exposure or scanning patients. The current adapter does not implement RS-232, ASTM, MLLP, ventilator control or actual DICOM acquisition.

## Candidate lots / total cost

Use `hardware/type3/procurement-template.json` per candidate. Populate exact make/model/serial in the independent asset dossier; do not add unsupported fields to the strict API payload. Cost fields are integer USD cents or `null`. `null` stays unknown, including shipping, buyer premium, accessories, service, consumables and eventual disposal. A completeness pass only authorizes consideration for a supervised bench evaluation—not a purchase or clinical use.

Ask sellers for precise functional test evidence, complete accessory inventory, software/interface license transferability, decontamination evidence, service history and data sanitization. Qualified reviewers must check recall status and suitability. Do not treat “powers on” as “patient ready,” or a protocol family as proof that an exact instrument/firmware works.

## Bench acceptance matrix

| System | Test | Required record |
|---|---|---|
| Compute/network | Cold boot without WAN after dependencies are preloaded | Runtime versions, topology, package hashes, observed local workflows |
| Storage | Backup restored to independent media/host | Digest comparison, recovery time, explicit data-loss window |
| API/runtime | Lost response, restart, repeated command, two competing clients | Command journal and exact event/digest comparison |
| Gateway | Valid and invalid synthetic frames; monotonic sequence and stale timestamps | Input fixture, parser version, expected/actual disposition |
| Medical device | Qualified testing using appropriate simulators and documented interfaces | Inspection/performance results; no patient-care acceptance inferred |
| Lab integration | Exact sample/patient mapping; complete panels; corrections, duplicate results | Catalog version, source/destination references, exception evidence |
| Utilities | Simulated power/oxygen/staff failures | Existing patients retained, new admissions blocked, human review visible |
| Communications | Authorized radio/link test and approved fallback | Operators, authorizations, coverage, independent power and handoff evidence |

## Type 3 physical program beyond the bench

The configuration file lists ICU/OR/lab equipment categories so clinical and biomedical partners can replace assumptions with an approved specification. It excludes a validated full formulary, consumables forecast, actual electrical/oxygen engineering, shelters, radiation design, microbiology facilities, blood-service supply, staffing, transport and costed deployment logistics. Those remain explicit work packages before physical Type 3 operation.
