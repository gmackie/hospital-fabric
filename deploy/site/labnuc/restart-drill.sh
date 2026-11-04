#!/bin/bash
# Restart-policy drill: lose a delivery ACK, SIGKILL the node, let systemd restart it,
# then reconcile and prove the order was found rather than sent twice. Run as root.
set -euo pipefail
base=http://127.0.0.1:18780 unit=hospital-fabric-celld.service
key=$(sed -n 's/^DEMO_API_KEY=//p' /etc/hospital-fabric/site-secrets.env)
api() { curl -fsS -m 20 -H "x-demo-token: $key" -H 'content-type: application/json' -X "$1" "$base$2" ${3:+-d "$3"}; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1],{},{'d':d}))" "$1"; }
patient=$(api POST /v1/demo/patients '{"label":"SYNTHETIC-RESTART-DRILL"}' | field "d['id']")
op=$(api POST /v1/demo/lab-orders "{\"patientId\":\"$patient\",\"testCode\":\"CBC\",\"requestId\":\"restart-drill-$(date +%s)\"}" | field "d['operationId']")
api POST /v1/demo/faults/drop-next-ack >/dev/null
api POST /v1/admin/tick | field "d['dispatched'][0]['state']" | grep -qx outcome_unknown
before=$(systemctl show -p MainPID --value $unit)
kill -KILL "$before"
for _ in $(seq 30); do
  sleep 1
  after=$(systemctl show -p MainPID --value $unit)
  [ "$after" != 0 ] && [ "$after" != "$before" ] && curl -fsS -m 2 "$base/healthz" >/dev/null 2>&1 && break
done
[ "$after" != "$before" ] || { echo 'systemd did not restart the node' >&2; exit 1; }
state=$(api POST "/v1/operations/$op/reconcile" | field "d['attempts'][0]['state']")
events=$(api GET "/v1/operations/$op/events" | field "' '.join(e['event_type'] for e in d['events'])")
submits=$(grep -o 'delivery.submit_started' <<<"$events" | wc -l)
echo "operation=$op pid $before->$after state=$state submits=$submits"
[ "$state" = accepted ] && [ "$submits" = 1 ] && grep -q delivery.reconciled <<<"$events"
echo 'restart drill passed'
