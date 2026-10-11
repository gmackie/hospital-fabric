# Connected synthetic hospital

The public landing page at https://med.gmac.io (also `/hospital`) models a bounded hospital shift. The original lab delivery walkthrough and fixed real OpenMRS/OpenELIS proof are retained at `/delivery-lab`. Local mode retains its authenticated operator console at `/`; the hospital simulator is available at `/hospital` after local bootstrap.

Six patients begin scripted medical, surgical and outpatient journeys. Visitors register encounters, request labs, deliver an order with a lost acknowledgment, reconcile the original order, release a fixed result, complete simulated imaging, allocate ward beds, book theatre, finish recovery, dispense and discharge. Department queues, timelines, bed occupancy and stock derive from the same durable state. The lab destination ledger is part of this model, not a call to an independent real LIS. The separate delivery lab remains the independent-D1 demonstration.

Three ward beds and one theatre constrain concurrent patient work. Pharmacy starts with four demo packs and the local warehouse holds twelve more; resupply transfers four packs without creating stock. Discharge frees a bed and consumes exactly one pack. WAN toggling changes the *model*: local department actions continue, and discharge summaries queue until reconnection. It does not disable the browser’s network or qualify an offline deployment. The clock advances five minutes per patient action or thirty through a clock command; patients do not advance autonomously.

## Durable commands and limits

A visitor capability lives in an HttpOnly, Secure, SameSite=Strict `hospital_sim` cookie. Sessions expire after 24 hours and share the existing 5,000-allocation lifetime budget with the delivery demo. Each shift permits twelve patient arrivals total and 240 unique commands; expired rows remain within this storage cap pending a retention policy. The event view retains the most recent 120 events. Command receipts remain for the entire shift so uncertain responses can be safely replayed.

One `hospital_simulations` D1 row owns each hospital. Version comparison and a conditional UPDATE serialize patient, bed, theatre, stock and command-receipt changes together. Replayed request IDs return current state; reuse for a different action returns 409. A stale tab must refresh before submitting a new command. The UI keeps an uncertain command ID for retry and disables other actions until it is resolved; a page reload reads the authoritative state before allowing work. No blind automatic action replay occurs on reload.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/hospital/api/session` | Resume or allocate a bounded synthetic shift; set capability cookie |
| GET | `/hospital/api/state` | Current visitor’s state, department queues and available next actions |
| POST | `/hospital/api/commands` | Fixed command with `requestId`, expected `version`, `action`, optional `patientId` |

Actions: `advance` (patient required), `arrival`, `wan`, `clock`, `resupply`. Unknown fields, arbitrary patient data and unsupported commands are rejected. POST requires the same origin; cloud requests share the existing rate limiter. Inputs are capped at 2 KiB. There is no public reset, product proxy or clinical data entry.

## Verification

After deployment, run `node scripts/smoke-hospital.mjs` to verify three complete journeys, replay safety, isolation and WAN queues against the public target. Override `HOSPITAL_URL` for another same-origin deployment. The smoke creates two bounded synthetic visitor sessions.

`npm run check` tests complete journeys, bed/theatre capacity, stock conservation, lab correlation, concurrent version claims, receipt replay/conflict, origin checks, session isolation and expiry. `npm run test:console` includes a Chromium hospital journey with WAN queue/recovery, reload persistence, surgical imaging/theatre flow and mobile overflow checks. Existing workerd/celld/Forge checks continue running.

This first connected model covers eight department views and local inventory. ICU/maternity, staffing, billing, autonomous demand, utilities failures and multi-facility referrals are future extensions. Fixed scenario values are demonstration fixtures, not treatment recommendations. No real patient data belongs here.
