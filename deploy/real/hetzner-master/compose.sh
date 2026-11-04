#!/bin/bash
set -euo pipefail
# HF_HOST/HF_BASE/HF_PRIVATE select another host profile (see deploy/real/labnuc/host.env).
base=${HF_BASE:-/mnt/master-apps/hospital-fabric}
private=${HF_PRIVATE:-$base/private}
host=${HF_HOST:-hetzner-master}
export XDG_RUNTIME_DIR=/run/hospital-fabric/runtime
export DOCKER_HOST=unix:///run/hospital-fabric/podman.sock
export COMPOSE_PARALLEL_LIMIT=2
case "${1:-}" in
  openmrs) upstream="$base/upstream/openmrs"; project=hf-openmrs ;;
  openelis) upstream="$base/upstream/openelis"; project=hf-openelis ;;
  *) echo 'Usage: compose.sh openmrs|openelis <compose arguments>' >&2; exit 2 ;;
esac
product=$1; shift
cd "$upstream"
exec "$base/bin/docker-compose" --env-file "$private/deployment.env" -p "$project" -f docker-compose.yml -f "$base/release/deploy/real/$product.private.yml" -f "$base/release/deploy/real/$host/$product.host.yml" "$@"
