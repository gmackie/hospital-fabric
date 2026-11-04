#!/bin/bash
# Install or update the labnuc celld node. Run as root from a release directory.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
test -x /opt/hospital-fabric/bin/celld
test -f /etc/hospital-fabric/celld.env
secrets=/etc/hospital-fabric/site-secrets.env
if [ ! -f "$secrets" ]; then
  # celld has no secret store: this value is deployed as a var into the on-site bucket.
  (umask 077; printf 'DEMO_API_KEY=%s\n' "$(openssl rand -hex 24)" > "$secrets")
fi
# Shared HMAC key for the site-to-cloud link; the cloud Worker holds the same value as a secret.
grep -q '^SITE_LINK_SECRET=' "$secrets" || printf 'SITE_LINK_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$secrets"
chmod 0600 /etc/hospital-fabric/celld.env "$secrets"
install -m 0644 "$here/hospital-fabric-celld.service" /etc/systemd/system/hospital-fabric-celld.service
install -m 0644 "$here/hospital-fabric.caddy" /etc/caddy/conf.d/hospital-fabric.conf
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || { rm -f /etc/caddy/conf.d/hospital-fabric.conf; exit 1; }
systemctl reload caddy
systemctl daemon-reload
systemctl enable --now hospital-fabric-celld.service
systemctl is-active hospital-fabric-celld.service
