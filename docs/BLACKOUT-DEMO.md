# Synthetic blackout demo

This is a local development exercise, not a clinical application or a claim of WHO EMT Type 2 compliance. Use synthetic identities and invented results only. No real OpenMRS/OpenELIS adapter, medical device or patient care is connected.

## Prepare while internet access is available

```sh
npm ci
npm run dev:secrets
npm run check
npm run smoke:workerd
```

Node 22.16+ and Python 3 are required. Dependencies and runtime binaries must be installed before disconnecting WAN. `npm run smoke:workerd` launches temporary local Wrangler/workerd processes with separate, isolated D1 databases. On macOS/Linux it deliberately sends SIGKILL to the runtime process group, verifies HTTP is unavailable, restarts with the same disk state, and checks the SQLite files after stopping the runtime. It does not touch your interactive demo databases. Windows process-group termination is not supported by this harness.

The acceptance assertions are:

1. A synthetic patient and lab order are durably recorded.
2. The simulated LIS commits one order and deliberately loses its acknowledgment.
3. The integration operation becomes `outcome_unknown`.
4. The runtime is terminated and restarted without bootstrapping a new database.
5. Destination lookup finds the original stable correlation key and original LIS order ID before any possible submission.
6. Exactly one LIS order, one released result, and one chart projection remain after repeated requests and polls; the operation finishes `completed`.

This tests a real process restart and local D1 persistence, not a physical power cut, disk failure, WAN-disconnection, celld compatibility or a real laboratory integration.

## Open the operator console

```sh
npm run dev:workerd -- --port 9876
```

Open http://127.0.0.1:9876 in your browser. Copy the generated `DEMO_API_KEY` from `apps/worker/.dev.vars` into the console. The token is held in tab memory only; disconnect or reload clears it. Keep the server bound to loopback. The demo token is not production identity, access control or network protection.

When `PUBLIC_DEMO=1`, the existing public walkthrough owns `/` and the operator console assets return 404, even with a demo token. This change does not deploy the local console.

The console and React runtime are bundled into the Worker and served from the same origin, without a CDN or remote fonts. A fresh browser load requires the local Worker to be running. There is no service-worker cache, browser-side offline write queue or browser database.

Connect, bootstrap the synthetic databases if needed, register a synthetic patient and queue a CBC. Arm the lost-ACK fault before running the delivery tick. Inspect the selected operation and its history, then reconcile it. Reconciliation only attempts that selected operation; it cannot dispatch unrelated queued work. The destination is always looked up before a resend. Release a synthetic result after acceptance, then run the delivery/result tick to import it.

The global tick may process other due synthetic operations. Arming the fault affects the next simulator submission globally, not a selected order. For a clear demonstration use one queued order at a time. `needs_review` has no override or blind-resend control; investigate the history outside the demo before changing code or data.

Operation history includes delivery attempts, destination lookups and whether a match was found, submission attempts, missing acknowledgments, reconciliation, acceptance, manual-review escalation and imported results. It records integration metadata, not clinical decision making. A submission-start event records intent and cannot prove that the destination received the request.

## Manual restart and WAN exercise

For the interactive demo, stop the local runtime after an unknown outcome, restart using the same command and persistence directory, reconnect the console and select the existing operation. Do not create a replacement order. Reconcile and verify it is accepted. A request interrupted while queuing must be retried with its original request ID; inspect the operations list before starting a new request after a reload.

A separate deployment acceptance exercise should disconnect WAN while preserving local LAN, DNS and power, then reload the console and repeat the flow. Browser request blocking in automated tests demonstrates that the console does not require remote assets; it does not prove host-level or physical-network isolation. Record actual runtime version, topology, outages and observations before claiming an offline deployment is qualified.

## Browser tests

```sh
npx playwright install chromium
npm run test:console
```

For an already installed Chromium executable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Tests exercise the real local Worker with synthetic data. Browser and runtime tests require loopback ports. CI runs SQL checks, TypeScript, synthetic integration tests, real workerd restart smoke and console tests.

## Remaining acceptance work

- Run the same workflow against a pinned celld version and validate celld persistence/restart behavior.
- Install the maintained `gmackie/forgec` compiler and validate the draft Forge model. The runnable manual schema remains the sole table owner; no new Forge-generated API/table ownership is claimed.
- Run the physical WAN-disconnection/LAN-intact exercise, then backup/restore and power-loss testing in a representative environment.
- Qualify real adapters, security, clinical authority, terminology and operating procedures before considering any real data. See [production blockers](PRODUCTION.md).
