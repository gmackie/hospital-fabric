#!/bin/bash
# Run one shared host script with the labnuc profile, as root:
#   sudo bash run.sh probe.mjs | conformance.mjs | conditional-conformance.mjs | adapter-conformance.mjs | status.py [container]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
set -a; . "$here/host.env"; set +a
name=${1:?script name}; shift
case "$name" in */*|.*) echo 'Name a script in deploy/real/hetzner-master' >&2; exit 2 ;; esac
script="$HF_BASE/release/deploy/real/hetzner-master/$name"
test -f "$script"
case "$name" in
  *.mjs) exec node "$script" "$@" ;;
  *.py) exec python3 "$script" "$@" ;;
  *.sh) exec bash "$script" "$@" ;;
  *) echo "Unsupported script: $name" >&2; exit 2 ;;
esac
