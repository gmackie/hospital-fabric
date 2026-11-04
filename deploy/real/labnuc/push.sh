#!/bin/bash
# Upload the committed deploy/real tree and probe client to labnuc, then install.
# Usage: deploy/real/labnuc/push.sh   (from a clean checkout with node_modules)
set -euo pipefail
root=$(git rev-parse --show-toplevel); cd "$root"
[ -z "$(git status --porcelain)" ] || { echo 'commit or stash changes first' >&2; exit 1; }
release=/var/lib/hospital-fabric/products/release
bundle=$(mktemp -d)
trap 'rm -rf "$bundle"' EXIT
# The host probes import the real adapters from one Node ESM bundle.
printf "export * from './apps/worker/src/adapters/real/fhir-client';\nexport * from './apps/worker/src/adapters/real/openelis-task';\nexport * from './apps/worker/src/adapters/real/openmrs';\n" |
  npx esbuild --bundle --format=esm --platform=node --sourcefile=probe-client.ts --loader=ts --outfile="$bundle/probe-client.mjs" --log-level=warning
git archive HEAD deploy/real | tar -x -C "$bundle"
git rev-parse HEAD > "$bundle/REVISION"
ssh labnuc "sudo install -d -m 0755 $release && sudo rm -rf $release.new && sudo install -d -m 0755 $release.new && sudo chown \$(id -u) $release.new"
tar -C "$bundle" -cf - . | ssh labnuc "tar -C $release.new -xf - && sudo chown -R root:root $release.new && sudo rm -rf $release.old && sudo mv $release $release.old && sudo mv $release.new $release"
ssh labnuc "sudo bash $release/deploy/real/labnuc/install.sh"
echo "commit=$(git rev-parse HEAD)"
