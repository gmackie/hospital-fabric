#!/bin/bash
# Build the committed HEAD and deploy it to the labnuc site node.
# Usage: deploy/site/labnuc/push.sh   (from a clean checkout)
set -euo pipefail
root=$(git rev-parse --show-toplevel); cd "$root"
[ -z "$(git status --porcelain)" ] || { echo 'commit or stash changes first' >&2; exit 1; }
commit=$(git rev-parse HEAD)
npm run build >/dev/null
digest=$(shasum -a 256 apps/worker/dist/index.mjs | cut -d' ' -f1)
release=/opt/hospital-fabric/releases/$commit
ssh labnuc "sudo install -d -m 0755 $release/dist $release/deploy/site/labnuc && sudo chown -R \$(id -u) $release"
scp -q apps/worker/dist/index.mjs "labnuc:$release/dist/"
scp -qr apps/worker/migrations apps/worker/wrangler.site.jsonc "labnuc:$release/"
scp -q deploy/site/labnuc/*.sh deploy/site/labnuc/*.service deploy/site/labnuc/*.caddy "labnuc:$release/deploy/site/labnuc/"
ssh labnuc "sudo chown -R root:root $release && sudo bash $release/deploy/site/labnuc/install.sh && sudo bash $release/deploy/site/labnuc/deploy.sh $release $digest"
echo "commit=$commit bundle_sha256=$digest"
