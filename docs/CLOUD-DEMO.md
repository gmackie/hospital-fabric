# Public Cloudflare tier

The cloud tier runs at https://hospital.gmac.io: the connected hospital simulation at `/`, and the synthetic integration lab and real-product proof at `/delivery-lab`. It is the Worker `hospital-fabric-cloud` with the `cloud` deployment profile and two D1 databases, `hospital-fabric-cloud-core` and `hospital-fabric-cloud-lis`. The hospital site runs the same bundle on celld at labnuc; see README "Deployment profiles".

## med.gmac.io (decided 2026-11-04, HF-13)

med.gmac.io is retired as a separate deployment. It is a second custom domain on `hospital-fabric-cloud`, and `LEGACY_HOSTS` / `CANONICAL_ORIGIN` make every request a 301 to the same path on hospital.gmac.io. The former Worker `hospital-fabric-demo` and its D1 databases (`hospital-fabric-demo-core`, `hospital-fabric-demo-lis`) were exported to `backups/` outside the repository before deletion. Visitor sessions from med.gmac.io don't carry over; they were synthetic and expire after 24 hours anyway.

## Deploy and verify

The ForgeGraph `production` stage's `worker` target is `hospital-fabric-cloud`. It builds with `npm run build:cloud` and deploys code only, with `--keep-vars`; ForgeGraph's CI-managed deploy runs it on merge. `build:cloud` (`scripts/prepare-cloud-deploy.mjs`) derives `dist/wrangler.json` from `apps/worker/wrangler.cloud.jsonc`, recording the source SHA and bundle SHA-256 in `FG_COMMIT_HASH` / `FG_BUNDLE_SHA256` and in `dist/release.json`. `/healthz` reports both, so `curl https://hospital.gmac.io/healthz` and `curl https://hospital.mackie.house/healthz` show whether the two tiers serve the same commit and bundle. `no_bundle` means the uploaded module is exactly `dist/index.mjs`.

Before publishing a release:

```sh
npm ci
npm run check
npm run smoke:workerd
npm run check:cloud
```

`check:cloud` is a local Wrangler dry run with no upload or database operations. Commit build inputs first: release preparation refuses modified tracked inputs.

Schema changes are not part of the code-only deploy. Apply them first with `npm run migrate:cloud` (both remote D1 databases), or use `npm run deploy:cloud` for build, migrate and deploy in one step. Both need an authorized Wrangler login.

Publish the PR with `forge`, link it to Kanbanger, and wait for all required checks on its current head. The conformance workflow reports its actual outcome and tested SHA to ForgeGraph. Approve the green revision and respect merge gates. Then verify the CI-managed deployment:

```sh
forge deploy history --stage production
forge health hospital-fabric production
curl -sS https://hospital.gmac.io/healthz
```

Roll back a failed release with `forge deploy rollback <deployment-id>` and verify health again. `scripts/smoke-demo.mjs` and `scripts/smoke-hospital.mjs` default to hospital.gmac.io and write synthetic public sessions; run them only when those writes are in scope. Do not enable `ALLOW_DEV_BOOTSTRAP` or expose the local administrative token in the cloud.

For a local cloud profile, apply both D1 migrations with `--local` using `apps/worker/wrangler.cloud.jsonc`, then run `npm run dev:cloud`. Public writes require a matching Origin header.

## Public behavior

Each browser gets a 24-hour HttpOnly, Secure, SameSite=Strict capability cookie. Its persisted session identifies exactly one fixed synthetic patient and one CBC order. The public API accepts action names only, with no patient labels, result text, database IDs, or arbitrary payloads supplied by visitors. Repeating start with the existing cookie returns the same order. The authenticated scaffold APIs remain separate and cloud bootstrap stays disabled.

Public delivery targets the session's operation and injects a fault scoped to that order's idempotency key. Scheduled dispatch skips public sessions so it cannot advance the guided scenario before the visitor observes it. Visitors explicitly reconcile, release the fixed synthetic report, and import it. If a crashed runtime leaves a session operation dispatching, the walkthrough offers a recovery check; the scoped dispatcher waits for the 30-second lease to expire before reclaiming it, then looks up the destination before submitting. Result intake targets that order, avoiding starvation when older reports fill the general poll batch. The existing scheduled safety sweep continues polling results.

Cloudflare limits each client IP to 60 demo requests per minute per location. An atomic D1 budget limits the demo to 5,000 total session allocations; this is a deliberate storage bound, not a retention policy. Expired sessions and their synthetic records remain stored. At capacity, new visitors receive a clear unavailable response; existing unexpired sessions still work. Failed allocations also consume budget. Retention and rolling capacity are follow-up work.

Only synthetic data is supported. This is an integration demonstration with simulated EMR/LIS systems, not a deployed clinical platform or real OpenMRS/OpenELIS integration.

## Delivery tracking

Kanbanger project: Hospital Fabric. Delivery integration is tracked by HF-2;
the public demo by HF-1; the dual reference deployment by HF-13. The ForgeGraph source is
https://git.forgegraf.com/gmackie/hospital-fabric; `origin` may be a GitHub
mirror with different branch contents. Use the current ForgeGraph default.

PR linkage alone does not establish production completion. Read back the signed
`production.healthy` receipt, issue completion rules and state after deployment.
For merged PRs included in the currently serving healthy revision, inspect
`forge receipts backfill --app hospital-fabric --dry-run` before sending any
missing receipts. Keep production issues open until actual deployment and
health evidence satisfies their gates; merge or local checks are insufficient.
