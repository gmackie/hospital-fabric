#!/usr/bin/env python3
"""Read resolved `docker compose config --format json` from stdin. No writes or secrets printed.

--require-memory-limits (shared hosts such as labnuc): every service needs mem_limit, with
memswap_limit equal to it so a capped service cannot grow into host swap.
"""
import json, re, sys
model = json.load(sys.stdin)
require_memory = '--require-memory-limits' in sys.argv[1:]
issues = []
total = 0
for name, service in model.get('services', {}).items():
    if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', service.get('image', '')):
        issues.append(f'{name}: image is not pinned by digest')
    for port in service.get('ports', []):
        if not isinstance(port, dict) or port.get('host_ip') not in ('127.0.0.1', '::1'):
            issues.append(f'{name}: published port is not loopback-only')
    if service.get('privileged') or service.get('network_mode') == 'host':
        issues.append(f'{name}: elevated or host-network service is not allowed')
    if require_memory:
        limit, swap = service.get('mem_limit'), service.get('memswap_limit')
        if not str(limit or '').isdigit() or int(limit) <= 0:
            issues.append(f'{name}: no memory limit')
        elif str(swap) != str(limit):
            issues.append(f'{name}: memswap_limit must equal mem_limit')
        else:
            total += int(limit)
if not model.get('services'): issues.append('No services found')
if issues:
    print('\n'.join(issues), file=sys.stderr)
    sys.exit(1)
memory = f' Memory limits total {total // 2**20} MiB, no swap.' if require_memory else ''
print(f'Checked {len(model["services"])} services: immutable image references, loopback-only published ports, no host networking.{memory}')
