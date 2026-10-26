#!/usr/bin/env python3
"""Fetch only checksum-pinned SQL initialization files; never execute upstream installers."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / 'upstream-lock.json').read_text())
target = root / 'runtime' / 'upstream'
target.mkdir(mode=0o755, exist_ok=True)
for source, digest in lock['files'].items():
    if not source.startswith('docker/volumes/db/'):
        continue
    path = target / Path(source).name
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
        continue
    url = f"https://raw.githubusercontent.com/supabase/supabase/{lock['commit']}/{source}"
    with urllib.request.urlopen(url, timeout=30) as response:
        content = response.read(1_000_000)
    if hashlib.sha256(content).hexdigest() != digest:
        raise SystemExit(f'Upstream checksum mismatch: {source}')
    path = target / Path(source).name
    path.write_bytes(content)
    path.chmod(0o644)
print('Pinned SQL sources verified.')
