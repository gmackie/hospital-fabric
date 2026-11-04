#!/bin/bash
# Install or update the labnuc OpenMRS/OpenELIS stack. Run as root after push.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
set -a; . "$here/host.env"; set +a
shared="$HF_BASE/release/deploy/real/hetzner-master"
test "$here" = "$HF_BASE/release/deploy/real/labnuc"
install -d -m 0700 /etc/hospital-fabric "$HF_PRIVATE"
bash "$shared/install-compose.sh"
# Pull every pinned image up front, with retries, so the first stack start fits its timeout.
export XDG_RUNTIME_DIR=/run/hospital-fabric/runtime
mkdir -p "$XDG_RUNTIME_DIR"
for image in $(python3 -c 'import json,sys;print(*[i["image"] for i in json.load(open(sys.argv[1]))["images"].values()])' "$here/images.lock.json"); do
  for attempt in 1 2 3 4; do
    podman --root="$HF_BASE/containers" --runroot=/run/hospital-fabric/storage --runtime=runc pull --quiet "$image" >/dev/null && break
    [ "$attempt" -lt 4 ] || exit 1; sleep 10
  done
done
# Clones pinned sources, generates credentials into $HF_PRIVATE, installs both units, prepares TLS.
python3 "$shared/prepare-host.py"
# The CA certificate is public; Caddy needs it to verify the OpenELIS proxy.
install -m 0644 "$HF_PRIVATE/ca.crt" /etc/caddy/hospital-fabric-products-ca.crt
install -m 0644 "$here/products.caddy" /etc/caddy/conf.d/hospital-fabric-products.conf
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { rm -f /etc/caddy/conf.d/hospital-fabric-products.conf; exit 1; }
systemctl reload caddy
systemctl daemon-reload
systemctl enable hospital-fabric-stack.service
systemctl restart hospital-fabric-stack.service
bash "$here/tailnet.sh"
systemctl is-active hospital-fabric-podman-api.service hospital-fabric-stack.service
