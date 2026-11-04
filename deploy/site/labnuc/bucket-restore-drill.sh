#!/bin/bash
# Bucket backup and restore drill. Run as root on labnuc.
#  1. Fingerprint the live site through its API.
#  2. Stop the node, copy the quiescent fleet bucket off site to R2, start the node again.
#  3. Copy the R2 backup to a fresh prefix and start a brand-new celld node on it
#     (empty local state, R2 as its fleet bucket, loopback only).
#  4. The restored node must serve the same state. The backup stays in R2; the restore copy is deleted.
set -euo pipefail
unit=hospital-fabric-celld.service live=http://127.0.0.1:18780 fresh=http://127.0.0.1:18784
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=backups/$stamp restore=restore-$stamp
key=$(sed -n 's/^DEMO_API_KEY=//p' /etc/hospital-fabric/site-secrets.env)
work=$(mktemp -d /var/tmp/hf-restore.XXXXXX)
cleanup() {
  systemctl stop hf-restore-drill.service 2>/dev/null || true
  r2 s3 rm --recursive --quiet "s3://hospital-fabric-site-backup/$restore" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
site() { (set -a; . /etc/hospital-fabric/celld.env; set +a; aws "$@" --endpoint-url "$S3_ENDPOINT"); }
r2() { (set -a; . /etc/hospital-fabric/r2-backup.env; set +a
  AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto); }
# Integration state as an operator sees it: operations with their full event histories, delivery status, registry.
fingerprint() {
  local base=$1 ops ids
  ops=$(curl -fsS -m 20 -H "x-demo-token: $key" "$base/v1/operations")
  # Separate assignment so a parse failure stops the drill instead of shrinking the fingerprint.
  ids=$(python3 -c 'import json,sys;[print(o["operation_id"]) for o in json.loads(sys.argv[1])["orders"]]' "$ops")
  {
    echo "$ops"
    curl -fsS -m 20 -H "x-demo-token: $key" "$base/v1/status"
    curl -fsS -m 20 -H "x-demo-token: $key" "$base/v1/components"
    for op in $ids; do
      curl -fsS -m 20 -H "x-demo-token: $key" "$base/v1/operations/$op/events"
    done
  } | python3 -c 'import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
}
wait_healthy() { for _ in $(seq 60); do curl -fsS -m 2 "$1/healthz" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

before=$(fingerprint $live)
operations=$(curl -fsS -H "x-demo-token: $key" $live/v1/operations | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["orders"]))')
echo "live fingerprint $before ($operations operations)"

systemctl stop $unit
site s3 sync --quiet s3://hospital-fabric-site "$work/bucket"
r2 s3 sync --quiet "$work/bucket" "s3://hospital-fabric-site-backup/$backup"
systemctl start $unit
objects=$(find "$work/bucket" -type f | wc -l)
echo "backed up $objects objects to r2://hospital-fabric-site-backup/$backup"
wait_healthy $live
[ "$(fingerprint $live)" = "$before" ] || { echo 'live site changed across the backup stop' >&2; exit 1; }

r2 s3 sync --quiet "s3://hospital-fabric-site-backup/$backup" "s3://hospital-fabric-site-backup/$restore"
# A fresh node: own empty state directory, R2 as its fleet bucket, loopback listeners only.
# Its restored vars include the site link, so for the few seconds it runs it may heartbeat
# as the site or resend queued referrals; the cloud stores each referral key once.
# Credentials go in a root-only file, not -E, so they don't appear in `systemctl show`.
( set -a; . /etc/hospital-fabric/r2-backup.env; umask 077
  printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nS3_ENDPOINT=%s\n' \
    "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" "$R2_ENDPOINT" > "$work/fresh.env" )
systemd-run --unit=hf-restore-drill --collect --quiet \
  -p DynamicUser=yes -p StateDirectory=hf-restore-drill -p MemoryMax=1G \
  -p EnvironmentFile="$work/fresh.env" -E AWS_REGION=auto \
  -E CELLD_BUCKET="s3://hospital-fabric-site-backup/$restore" \
  -E CELLD_ADDR=127.0.0.1:18784 -E CELLD_INTERNAL_ADDR=127.0.0.1:18785 \
  -E CELLD_WATCH=/var/lib/hf-restore-drill \
  /opt/hospital-fabric/bin/celld
wait_healthy $fresh || { journalctl -u hf-restore-drill --no-pager -n 20 >&2; exit 1; }
after=$(fingerprint $fresh)
echo "restored fingerprint $after"
[ "$after" = "$before" ] || { echo 'restored node serves different state' >&2; exit 1; }
echo "bucket restore drill passed: backup=$backup objects=$objects operations=$operations"
