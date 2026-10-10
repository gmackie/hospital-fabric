#!/bin/bash
set -euo pipefail
base=/mnt/master-apps/hospital-fabric/bin
mkdir -p "$base"
target="$base/docker-compose-linux-x86_64"
checksum=a55a8cd4ef103aac282812554e531aac8df7e914a287ee81e14d695556a22902
if [ ! -f "$target" ]; then
  curl --fail --location --retry 3 https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-x86_64 --output "$target.tmp"
  printf '%s  %s\n' "$checksum" "$target.tmp" | sha256sum --check
  mv "$target.tmp" "$target"
fi
printf '%s  %s\n' "$checksum" "$target" | sha256sum --check
chmod 0755 "$target"
ln -sfn docker-compose-linux-x86_64 "$base/docker-compose"
