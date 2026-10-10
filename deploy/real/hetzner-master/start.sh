#!/bin/bash
set -euo pipefail
export XDG_RUNTIME_DIR=/run/hospital-fabric/runtime
base=/mnt/master-apps/hospital-fabric
scripts="$base/release/deploy/real/hetzner-master"
for product in openmrs openelis; do
  "$scripts/compose.sh" "$product" config --format json | python3 "$base/release/deploy/real/check-compose.py"
  "$scripts/compose.sh" "$product" create
 done
# Preserve the image's non-root OpenMRS application writer after initial volume copy-up.
chown -R 1001:1001 "$base/data/openmrs-app"
python3 "$scripts/provision-tls.py"
# Ubuntu's Podman 3.4 generates CNI 1.0 while its firewall plugin supports 0.4.
# Touch only the two networks owned by this stack; no host-wide plugin upgrade.
python3 - <<'PY'
import json,pathlib
for product in ['openmrs','openelis']:
 path=pathlib.Path(f'/etc/cni/net.d/hf-{product}_default.conflist')
 model=json.loads(path.read_text())
 if model.get('cniVersion')!='0.4.0':
  model['cniVersion']='0.4.0'
  path.write_text(json.dumps(model))
PY
# Reload the dedicated API's network cache. Container processes persist independently.
systemctl restart hospital-fabric-podman-api.service
for attempt in $(seq 1 30); do
  if curl -fsS --unix-socket /run/hospital-fabric/podman.sock http://localhost/_ping >/dev/null; then break; fi
  sleep 1
done
for product in openmrs openelis; do "$scripts/compose.sh" "$product" up -d; done
