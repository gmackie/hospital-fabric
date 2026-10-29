# Public Cloudflare demo

The connected hospital simulation runs at https://med.gmac.io; the original synthetic integration lab and real-product proof remain at `/delivery-lab`. Both use one Cloudflare Worker and two independent D1 databases. celld remains a local option and is not required for the cloud demo.

## Deploy and verify

The existing `hospital-fabric-demo` Worker is the ForgeGraph `production`
stage's `worker` target. Delivery builds the checked-out revision, uploads code
only, and probes the read-only `/healthz` endpoint. Existing D1 databases,
domain, cron, public vars and secrets stay on the same Worker.

Before publishing a release:

```sh
npm ci
npm run check
npm run smoke:workerd
npm run check:demo
```

`check:demo` is a local Wrangler dry run with no upload or database operations.
Commit build inputs first: release preparation refuses modified tracked inputs.
`build:demo` derives `dist/wrangler.json` from the authoritative
`apps/worker/wrangler.demo.jsonc`, recording the actual source SHA and bundle
SHA-256 in both runtime vars and `dist/release.json`. The target uses
`--no-bundle` so the uploaded module is the hashed artifact, and `--keep-vars`
preserves live vars. Secret synchronization is disabled; Wrangler preserves
existing secrets. `wrangler.jsonc` remains the local scaffold config.

Publish the PR with `forge`, link it to Kanbanger, and wait for all required
checks on its current head. The conformance workflow reports its actual outcome
and tested SHA to ForgeGraph using the repository-scoped credential installed
by `forge ci provision`. Approve the green revision and respect merge gates.
Then deploy the merged revision through the normal CI and freeze gates:

```sh
forge apply
forge deploy create production --target worker --platform cloudflare-workers --ref <merged-sha>
forge deploy status <deployment-id>
forge health hospital-fabric production
forge worker export-config hospital-fabric-demo --json
```

Verify the serving provider deployment/version, `FG_COMMIT_HASH`,
`FG_BUNDLE_SHA256`, downloaded module checksum, preserved configuration and
public read-only health. Record that evidence and the deployment ID on the
owning issue. Roll back a failed release with
`forge deploy rollback <deployment-id>` and verify health again. Initial
adoption of a legacy Worker without revision metadata requires ForgeGraph's
source-recovery gate, with the exact serving provider deployment/version and
an audited reason after comparing its source; never guess or bypass the gate.

The legacy `deploy:demo` script still applies both remote migration sets before
upload. It is separate from this code-only path and requires authorization for
database changes. `scripts/smoke-demo.mjs` writes synthetic public sessions;
run it only when those writes are in scope. Do not enable `ALLOW_DEV_BOOTSTRAP`
or expose the local administrative token in the cloud.

For a local public demo, apply both D1 migrations using the demo config with `--local`, then run `npm run dev:demo`. Public writes require a matching Origin header. The browser's Secure cookie works on localhost in modern browsers; remote smoke verification targets HTTPS by default.

## Public behavior

Each browser gets a 24-hour HttpOnly, Secure, SameSite=Strict capability cookie. Its persisted session identifies exactly one fixed synthetic patient and one CBC order. The public API accepts action names only, with no patient labels, result text, database IDs, or arbitrary payloads supplied by visitors. Repeating start with the existing cookie returns the same order. The authenticated scaffold APIs remain separate and cloud bootstrap stays disabled.

Public delivery targets the session's operation and injects a fault scoped to that order's idempotency key. Scheduled dispatch skips public sessions so it cannot advance the guided scenario before the visitor observes it. Visitors explicitly reconcile, release the fixed synthetic report, and import it. If a crashed runtime leaves a session operation dispatching, the walkthrough offers a recovery check; the scoped dispatcher waits for the 30-second lease to expire before reclaiming it, then looks up the destination before submitting. Result intake targets that order, avoiding starvation when older reports fill the general poll batch. The existing scheduled safety sweep continues polling results.

Cloudflare limits each client IP to 60 demo requests per minute per location. An atomic D1 budget limits the demo to 5,000 total session allocations; this is a deliberate storage bound, not a retention policy. Expired sessions and their synthetic records remain stored. At capacity, new visitors receive a clear unavailable response; existing unexpired sessions still work. Failed allocations also consume budget. Retention and rolling capacity are follow-up work.

Only synthetic data is supported. This is an integration demonstration with simulated EMR/LIS systems, not a deployed clinical platform or real OpenMRS/OpenELIS integration.

## Delivery tracking

Kanbanger project: Hospital Fabric. Delivery integration is tracked by HF-2;
the public demo by HF-1. The ForgeGraph source is
https://git.forgegraf.com/gmackie/hospital-fabric; `origin` may be a GitHub
mirror with different branch contents. Use the current ForgeGraph default.

PR linkage alone does not establish production completion. Read back the signed
`production.healthy` receipt, issue completion rules and state after deployment.
For merged PRs included in the currently serving healthy revision, inspect
`forge receipts backfill --app hospital-fabric --dry-run` before sending any
missing receipts. Keep production issues open until actual deployment and
health evidence satisfies their gates; merge or local checks are insufficient.
