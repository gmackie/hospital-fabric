#!/usr/bin/env python3
"""Validate generated SQL in isolation; never migrate a running database."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
compiler = os.environ.get('FORGEC_BIN', str(root / '.validation-tools/bin/forgec'))
subprocess.run([compiler, '--version'], check=True)
subprocess.run([compiler, 'check', str(root / 'forge')], check=True)
with tempfile.TemporaryDirectory(prefix='hospital-fabric-forge-') as directory:
    subprocess.run([compiler, 'build', str(root / 'forge'), '--out', directory], check=True)
    generated = sqlite3.connect(':memory:')
    files = sorted((Path(directory) / 'd1').glob('*.sql'))
    if not files:
        raise SystemExit('Compiler produced no D1 migration')
    for path in files:
        generated.executescript(path.read_text())
    assert generated.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    assert not generated.execute('PRAGMA foreign_key_check').fetchall()
    manual = sqlite3.connect(':memory:')
    for path in sorted((root / 'apps/worker/migrations/core').glob('*.sql')):
        manual.executescript(path.read_text())
    def tables(connection):
        return {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    print(json.dumps({'generatedIntegrity': 'ok', 'generatedTables': sorted(tables(generated)),
        'manualTables': sorted(tables(manual)), 'overlappingNames': sorted(tables(generated) & tables(manual)),
        'ownership': 'Manual migrations remain authoritative; generated registry is not a drop-in replacement.'}, indent=2))
