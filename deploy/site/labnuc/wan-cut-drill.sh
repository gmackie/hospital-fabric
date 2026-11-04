#!/bin/bash
# WAN-cut drill. Run as root on labnuc. Usage: wan-cut-drill.sh [CUT_SECONDS] [REFERRALS]
# Cuts only the celld node's internet egress (nftables, by cgroup), keeping LAN (10/8, where
# the fleet bucket is), Tailscale and loopback. Other labnuc services are untouched. Passes if:
#  - during the cut a lab order completes on site, including a lost-ACK recovery;
#  - referrals queue on site, and hospital.gmac.io shows the site offline;
#  - after reconnect every referral reaches the cloud exactly once and the queue drains.
set -euo pipefail
cut=${1:-300} count=${2:-3}
unit=hospital-fabric-celld.service base=http://127.0.0.1:18780 cloud=https://hospital.gmac.io
key=$(sed -n 's/^DEMO_API_KEY=//p' /etc/hospital-fabric/site-secrets.env)
api() { curl -fsS -m 40 -H "x-demo-token: $key" -H 'content-type: application/json' -X "$1" "$base$2" ${3:+-d "$3"}; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1],{},{'d':d}))" "$1"; }
site_status() { curl -fsS -m 20 "$cloud/site-link/v1/status" | python3 -c 'import json,sys;s=[x for x in json.load(sys.stdin)["sites"] if x["siteId"]=="labnuc"][0];print(s["online"],s["referralsReceived"])'; }
uncut() { nft delete table inet hf_wan_drill 2>/dev/null || true; }
trap uncut EXIT

read -r online received_before < <(site_status)
[ "$online" = True ] || { echo 'site must be online before the drill' >&2; exit 1; }
cg=$(systemctl show -p ControlGroup --value $unit | sed 's|^/||')
nft add table inet hf_wan_drill
nft add chain inet hf_wan_drill out '{ type filter hook output priority 0; policy accept; }'
nft add rule inet hf_wan_drill out socket cgroupv2 level 2 "\"$cg\"" ip daddr != '{ 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8 }' counter reject
started=$(date +%s)
echo "WAN cut for celld at $(date -u +%H:%M:%SZ) for ${cut}s"

# Clinical work continues on site: a synthetic lab order with a lost ACK, recovered by reconciliation.
patient=$(api POST /v1/demo/patients '{"label":"SYNTHETIC-WAN-CUT"}' | field "d['id']")
op=$(api POST /v1/demo/lab-orders "{\"patientId\":\"$patient\",\"testCode\":\"CBC\",\"requestId\":\"wan-cut-$started\"}" | field "d['operationId']")
api POST /v1/demo/faults/drop-next-ack >/dev/null
api POST /v1/admin/tick >/dev/null
lab=$(api POST "/v1/operations/$op/reconcile" | field "d['attempts'][0]['state']")
[ "$lab" = accepted ] || { echo "lab order during cut: $lab" >&2; exit 1; }
for i in $(seq "$count"); do api POST /v1/site-link/referrals "{\"requestId\":\"wan-cut-$started-$i\"}" >/dev/null; done
depth=$(api POST /v1/site-link/sync | field "d['referralQueueDepth']")
echo "during cut: lab order $op accepted on site; $depth referrals queued"

offline_seen=no
while [ $(( $(date +%s) - started )) -lt "$cut" ]; do
  read -r online _ < <(site_status)
  [ "$online" = False ] && offline_seen=yes
  sleep 20
done
blocked=$(nft list table inet hf_wan_drill | grep -o 'packets [0-9]*' | cut -d' ' -f2)
uncut
echo "reconnected at $(date -u +%H:%M:%SZ); cloud showed site offline: $offline_seen; blocked packets: $blocked"
[ "$offline_seen" = yes ] || { echo 'cloud never showed the site offline' >&2; exit 1; }

expected=$((received_before + count))
for _ in $(seq 30); do
  read -r online received < <(site_status)
  queue=$(api GET /v1/site-link/referrals | field "d['referralQueueDepth']")
  [ "$online" = True ] && [ "$queue" = 0 ] && [ "$received" -ge "$expected" ] && break
  sleep 10
done
echo "after reconnect: online=$online cloud referrals $received_before -> $received (expected $expected); site queue $queue"
[ "$online" = True ] && [ "$queue" = 0 ] && [ "$received" = "$expected" ]
echo 'WAN-cut drill passed'
