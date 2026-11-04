#!/usr/bin/env python3
"""Install checksum-pinned acceptance tools without altering global binaries."""
import gzip
import hashlib
import io
import platform
from pathlib import Path
import tarfile
import urllib.request

root = Path(__file__).resolve().parents[1]
bin_dir = root / '.validation-tools' / 'bin'
bin_dir.mkdir(parents=True, exist_ok=True)
machine = {'arm64': 'aarch64', 'aarch64': 'aarch64', 'x86_64': 'x86_64'}.get(platform.machine())
system = {'Darwin': 'apple-darwin', 'Linux': 'unknown-linux-gnu'}.get(platform.system())
target = f'{machine}-{system}'
celld_hashes = {
    'aarch64-apple-darwin': '2df6b08369345db8c1f9a5edcf3932cecaa6fb35f4658575a6db17df28c22371',
    'aarch64-unknown-linux-gnu': '6d617cdf9f049e43ca6a4e37c4cce5d8e35395c8e86b371c984d32ba7d803bf5',
    'x86_64-unknown-linux-gnu': '5084a083472cf036551a7eac63fa24d22bb9a56323c517f63205724c12783047',
}
forge_hashes = {
    'aarch64-apple-darwin': '33795351cf3cc2d392ff1c5928f207b871eb2484ebc7c3d6f4883f6be129c74b',
    'aarch64-unknown-linux-gnu': 'a89b3bd81abba13a21b0be259128f4e19ec436fc03830cb324aedda869e496a9',
    'x86_64-apple-darwin': 'bd442b2f135c02a2c002b04fc74d4ad5bba1578908419adec4611275e7d3d65b',
    'x86_64-unknown-linux-gnu': '683854945966686d7f6080e518a292b5dbc5eca3915a4b0e3e148a4a3a27601f',
}
if target not in celld_hashes or target not in forge_hashes:
    raise SystemExit(f'No pinned tool pair for {target}')
for name, url, expected in [
    ('celld', f'https://github.com/denoland/celld/releases/download/v0.6.3/celld-{target}.gz', celld_hashes[target]),
    ('forgec', f'https://github.com/gmackie/forgec/releases/download/v0.5.0/forgec-0.5.0-{target}.tar.gz', forge_hashes[target]),
]:
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = response.read()
    actual = hashlib.sha256(archive).hexdigest()
    if actual != expected:
        raise SystemExit(f'{name} archive checksum mismatch: {actual}')
    if name == 'celld':
        binary = gzip.decompress(archive)
    else:
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
            members = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == 'forgec']
            if len(members) != 1:
                raise SystemExit('Expected exactly one forgec executable')
            binary = tar.extractfile(members[0]).read()
    destination = bin_dir / name
    destination.write_bytes(binary)
    destination.chmod(0o755)
    print(f'{name}: archive SHA-256 {actual}; installed {destination}')
