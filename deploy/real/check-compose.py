#!/usr/bin/env python3
"""Read resolved `docker compose config --format json` from stdin. No writes or secrets printed."""
import json, re, sys
model = json.load(sys.stdin)
issues = []
for name, service in model.get('services', {}).items():
    if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', service.get('image', '')):
        issues.append(f'{name}: image is not pinned by digest')
    for port in service.get('ports', []):
        if not isinstance(port, dict) or port.get('host_ip') not in ('127.0.0.1', '::1'):
            issues.append(f'{name}: published port is not loopback-only')
    if service.get('privileged') or service.get('network_mode') == 'host':
        issues.append(f'{name}: elevated or host-network service is not allowed')
if not model.get('services'): issues.append('No services found')
if issues:
    print('\n'.join(issues), file=sys.stderr)
    sys.exit(1)
print(f'Checked {len(model["services"])} services: immutable image references, loopback-only published ports, no host networking.')
