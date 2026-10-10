#!/usr/bin/env python3
"""Dependency-free schema smoke and integrity test (not runtime conformance)."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1] / 'apps/worker/migrations'
for db_name, path in [('fabric', root/'core'), ('synthetic LIS', root/'sim_lis')]:
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for f in sorted(path.glob('*.sql')):
        db.executescript(f.read_text())
        print(f'{db_name}: applied {f.name}')
    failed = db.execute('PRAGMA foreign_key_check').fetchall()
    assert not failed, failed
    if db_name == 'fabric':
        assert db.execute('SELECT count(*) FROM facilities').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM component_instances').fetchone()[0] == 2
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0] == 19
        try:
            db.execute("INSERT INTO facilities(id,name,profile,demo_only,created_at) VALUES ('bad','Bad','hospital',0,0)")
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError('Non-synthetic facility wrongly accepted')
    else:
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0] == 2
    print(f'{db_name}: integrity checks passed')
    db.close()
