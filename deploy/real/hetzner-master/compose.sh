#!/bin/bash
set -euo pipefail
base=/mnt/master-apps/hospital-fabric
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
exec "$base/bin/docker-compose" --env-file "$base/private/deployment.env" -p "$project" -f docker-compose.yml -f "$base/release/deploy/real/$product.private.yml" -f "$base/release/deploy/real/hetzner-master/$product.host.yml" "$@"
