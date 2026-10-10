# Private synthetic services on hetzner-master

HF-3 / [PR #4](https://github.com/gmackie/hospital-fabric/pull/4) deploys OpenMRS O3 3.7.1 and OpenELIS Global 3.2.3.0 privately. The public https://med.gmac.io demo continues to use Cloudflare Workers and D1 with synthetic scenarios. The real laboratory workflow and public bridge are still being verified.

## Files and isolation

Everything owned by this stack lives under `/mnt/master-apps/hospital-fabric`: `release/` contains this repository's deployment files; `upstream/` contains complete official source checkouts; `data/` contains persistent bind-backed volumes; `private/` is root-only and contains host-generated credentials, TLS material and sanitized verification evidence. Never copy resolved Compose output, `.env`, cookies, keystores or private keys into the repository.

OpenMRS source commit: `a476fd609612394ff66fce0b4ce29e949b0cfaf9`. OpenELIS source commit: `44dbc444fd2d0b037ca6ecc2af5d61e39924125f`. All ten AMD64 manifests are pinned in `deploy/real/hetzner-master/images.lock.json`. `deploy/real/resolve-images.py` records registry provenance; rerunning it is an explicit image upgrade, not part of ordinary restart.

Only loopback ports are published:

| Product | Local address |
| --- | --- |
| OpenMRS O3 / REST / FHIR2 | `http://127.0.0.1:18090` |
| OpenELIS HAPI R4 | `http://127.0.0.1:18091/fhir` |
| OpenELIS HTTP redirect | `http://127.0.0.1:18092` |
| OpenELIS UI/API | `https://localhost:18443` |

No database ports are published. Use SSH forwarding for operator access. Trust the host-issued CA through the operator trust workflow; do not bypass TLS verification.

## Prepare and start

Upload `deploy/real/` into `release/deploy/real/`. As root on the selected host:

```sh
base=/mnt/master-apps/hospital-fabric/release/deploy/real/hetzner-master
bash "$base/install-compose.sh"
python3 "$base/prepare-host.py"
systemctl enable --now hospital-fabric-stack.service
```

`install-compose.sh` verifies the pinned Compose 2.39.2 binary checksum. Preparation checks full source revisions, generates complex passwords if absent, installs the dedicated Podman API unit, prepares TLS and the private HAPI HTTP connector. The API uses its own graph root, runroot and socket, and `runc`; existing host services and global runtime settings are untouched. Stack startup validates both resolved Compose models before creating containers, corrects application ownership, adjusts only its own two CNI network files to 0.4.0 for the installed firewall plugin, then starts products.

Ubuntu's installed Podman 3.4.4 API does not support the Compose `platform` field; the host overlay removes it and uses AMD64 digests. The installed `crun` fails cgroup initialization, so this API uses the installed working `runc`. Always use `compose.sh openmrs|openelis <arguments>` or the same explicit Podman root/runroot/runtime and `XDG_RUNTIME_DIR=/run/hospital-fabric/runtime` when inspecting this deployment.

The OpenELIS proxy re-resolves its upstream names every ten seconds using the container nameserver, so a product restart can change its IP without leaving the proxy pointed at a stale address. Its generated Nginx configuration lives in `/tmp` because the image root is read-only.

The upstream gateway assumes Docker DNS `127.0.0.11`; the wrapper uses the container's actual nameserver. Application volumes must be owned by UID 1001 for OpenMRS and private OpenELIS properties by UID 8443. Image-baked certificate defaults are replaced by a generated CA, server/client certificate and matching PKCS12 stores; the proxy verifies upstream TLS.

## Verification

Bundle the real adapter exports as ESM for Node into `release/probe-client.mjs` before running these host-side probes:

```sh
base=/mnt/master-apps/hospital-fabric/release/deploy/real/hetzner-master
node "$base/probe.mjs"
node "$base/conditional-conformance.mjs"
node "$base/adapter-conformance.mjs"
python3 "$base/verify-openelis-access.py"
python3 "$base/status.py"
```

`probe.mjs` reads private authorization on the host and stores sanitized FHIR R4 capability evidence. `conditional-conformance.mjs` creates synthetic fixtures with an owner excluded from the laboratory polling queue, checks an accepted Task remains unchanged on replay, and verifies concurrent replay returns one order pair. Test fixtures remain in this synthetic store for audit. `conformance.mjs` retains the negative test for the rejected transaction PUT strategy; it is expected to fail on HAPI 6.6.0 and must never enable the adapter gate.

`verify-openelis-access.py` verifies a private application password and rotates the packaged initial password through the product password-change API when needed; the database superuser password is a separate credential. An environment variable alone does not configure the OpenELIS application administrator.

First OpenMRS startup imports the full upstream catalog. Thread samples showed OCL waiting for Lucene index commits; concept-map counts continued growing, distinguishing slow initialization from deadlock. Avoid repeated restarts during this import. Readiness requires an authenticated FHIR/REST response, not merely a running container or gateway UI.

## Synthetic laboratory fixture

Run `configure-lab.py` to map the installed active whole-blood hemoglobin test to LOINC `718-7` through authenticated catalog APIs, preserving other terminology. Run `lab-order.mjs` to stage one durable synthetic order, then rerun it to reconcile without resubmitting. The fixture/correlation record remains in `private/lab-order.json`. OpenELIS imports patient/provider references as UUIDs, so the adapter requires UUIDs for these references. The polling owner is a host-configured UUID Practitioner, not a display-name ID. Confirm exactly one Electronic Order through the application API before accession/result entry.

## Restart, TLS and persistence

Restart this stack with `systemctl restart hospital-fabric-stack.service`; this reapplies validation and starts existing persistent containers. For an individual product use `compose.sh <product> restart`. Never use `down -v` or delete data as routine recovery. OpenELIS restart preserved the private administrator and catalog mapping. A host reboot recovery check and complete workflow restart/persistence check are still required before claiming resilience.

Leaf TLS expires after 90 days; CA after 365 days. The provisioning marker prevents implicit regeneration, and startup refuses certificates within seven days of expiry. Rotation is currently manual: back up private files and keystores securely, stop dependent applications, replace the entire trust chain together, restart applications/proxy, and verify trusted HTTPS and private admin login. Do not delete just the marker on an existing installation; partial regeneration is rejected. Scheduled renewal and off-host backups remain follow-up work.

## Delivery limits

HAPI metadata and trusted OpenELIS UI HTTPS have passed. Conditional creation/replay passed on HAPI 6.6.0. OpenELIS private administrator login and the actual adapter replay/reconciliation probe have also passed. The hemoglobin catalog mapping (LOINC `718-7`) is configured and one generated order is visible in Electronic Orders as `AwaitingSpecimen`. Its Task is `rejected`, and co-resident import logged a stale-version HTTP 409 while updating the same Task through source and local clients. These product states disagree; do not treat this as accepted or completed. The specimen-selection workflow and source/result topology need resolution before another order is sent.

OpenMRS has completed the OCL imports and is still generating the distribution’s demo visits; patient/visit counts advance but authenticated readiness remains unverified. Synthetic registration, Electronic Order acceptance, verified result return to OpenMRS, and a bounded public bridge still require runtime evidence. A test writing Task `accepted` is transport conformance, not laboratory acceptance.

HF-3 remains open until its workflow acceptance criteria pass. ForgeGraph has no enrolled `hospital-fabric` application, so deployment evidence/status synchronization is tracked separately in HF-2; GitHub merge alone must not close production work.
