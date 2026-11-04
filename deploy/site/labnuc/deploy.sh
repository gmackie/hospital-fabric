#!/bin/bash
# Apply D1 migrations and deploy one release to the site fleet bucket. Run as root.
# Usage: deploy.sh RELEASE_DIR EXPECTED_SHA256 COMMIT
set -euo pipefail
release=$1 expected=$2 commit=$3
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo 'COMMIT must be a full SHA' >&2; exit 1; }
actual=$(sha256sum "$release/dist/index.mjs" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo "bundle digest $actual, expected $expected" >&2; exit 1; }
set -a; . /etc/hospital-fabric/celld.env; . /etc/hospital-fabric/site-secrets.env; set +a
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cp -r "$release/dist" "$release/migrations" "$work/"
# Merge the operator token, site-link secret and release stamp into vars; the committed config holds none of them.
FG_COMMIT_HASH=$commit FG_BUNDLE_SHA256=$actual python3 - "$release/wrangler.site.jsonc" "$work/wrangler.json" <<'PY'
import json, os, re, sys
config = json.loads(re.sub(r'(?m)^\s*//.*$', '', open(sys.argv[1]).read()))
for key in ('DEMO_API_KEY', 'FG_COMMIT_HASH', 'FG_BUNDLE_SHA256'):
    config['vars'][key] = os.environ[key]
if os.environ.get('SITE_LINK_SECRET'): config['vars']['SITE_LINK_SECRET'] = os.environ['SITE_LINK_SECRET']
with open(sys.argv[2], 'w', opener=lambda p, f: os.open(p, f, 0o600)) as out: json.dump(config, out)
PY
celld=/opt/hospital-fabric/bin/celld
migrate() { "$celld" d1 migrations apply hospital_fabric "$work" && "$celld" d1 migrations apply hospital_sim_lis "$work"; }
# Schema first, so new code never runs against an older schema.
if out=$(migrate 2>&1); then
  echo "$out"
  "$celld" deploy "$work" --json
elif grep -q 'no node leases' <<<"$out"; then
  # A new fleet takes its first lease only once a deployment exists.
  "$celld" deploy "$work" --json
  for _ in $(seq 15); do sleep 2; if out=$(migrate 2>&1); then echo "$out"; exit 0; fi; done
  echo "$out" >&2; exit 1
else
  echo "$out" >&2; exit 1
fi
