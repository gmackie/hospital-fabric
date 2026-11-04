#!/bin/bash
# Publish the two authenticated product UIs on the tailnet only (tailscaled binds the
# Tailscale address, not the LAN). The unauthenticated HAPI stores stay on loopback.
set -euo pipefail
tailscale serve --bg --https=18090 http://127.0.0.1:18090
tailscale serve --bg --https=18443 http://127.0.0.1:18444
tailscale serve status
