# Public Cloudflare demo

The public synthetic integration lab runs at https://med.gmac.io using one Cloudflare Worker and two independent D1 databases. celld remains a local option and is not required for the cloud demo.

## Deploy and verify

With Wrangler authenticated to the configured Cloudflare account:

```sh
npm ci
npm run check
npm run smoke:workerd
npm run deploy:demo
node scripts/smoke-demo.mjs
```

`deploy:demo` builds, applies both remote migration sets, and deploys the custom domain and cron. The production config is `apps/worker/wrangler.demo.jsonc`; `wrangler.jsonc` remains the local scaffold config. Do not enable `ALLOW_DEV_BOOTSTRAP` or expose the local administrative token in the cloud.

For a local public demo, apply both D1 migrations using the demo config with `--local`, then run `npm run dev:demo`. Public writes require a matching Origin header. The browser's Secure cookie works on localhost in modern browsers; remote smoke verification targets HTTPS by default.

## Public behavior

Each browser gets a 24-hour HttpOnly, Secure, SameSite=Strict capability cookie. Its persisted session identifies exactly one fixed synthetic patient and one CBC order. The public API accepts action names only, with no patient labels, result text, database IDs, or arbitrary payloads supplied by visitors. Repeating start with the existing cookie returns the same order. The authenticated scaffold APIs remain separate and cloud bootstrap stays disabled.

Public delivery targets the session's operation and injects a fault scoped to that order's idempotency key. Scheduled dispatch skips public sessions so it cannot advance the guided scenario before the visitor observes it. Visitors explicitly reconcile, release the fixed synthetic report, and import it. If a crashed runtime leaves a session operation dispatching, the walkthrough offers a recovery check; the scoped dispatcher waits for the 30-second lease to expire before reclaiming it, then looks up the destination before submitting. Result intake targets that order, avoiding starvation when older reports fill the general poll batch. The existing scheduled safety sweep continues polling results.

Cloudflare limits each client IP to 60 demo requests per minute per location. An atomic D1 budget limits the demo to 5,000 total session allocations; this is a deliberate storage bound, not a retention policy. Expired sessions and their synthetic records remain stored. At capacity, new visitors receive a clear unavailable response; existing unexpired sessions still work. Failed allocations also consume budget. Retention and rolling capacity are follow-up work.

Only synthetic data is supported. This is an integration demonstration with simulated EMR/LIS systems, not a deployed clinical platform or real OpenMRS/OpenELIS integration.

## Delivery tracking

Kanbanger project: Hospital Fabric, issue HF-1. Repository: github.com/gmackie/hospital-fabric. Deployment presently uses Wrangler directly. Do not infer ForgeGraph deployment synchronization from issue or PR linkage; ForgeGraph production evidence must be configured separately before automated production issue closure can be claimed.
