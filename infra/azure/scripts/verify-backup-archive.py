#!/usr/bin/env python3
"""Verify a decrypted tar without extracting it or following arbitrary archive paths."""
import hashlib
import json
from pathlib import PurePosixPath
import sys
import tarfile


def verify(path):
    with tarfile.open(path, 'r:') as archive:
        members = archive.getmembers()
        for member in members:
            name = PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive entry')
        names = [m.name for m in members]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entry')
        manifest_file = archive.extractfile('manifest.json')
        if manifest_file is None:
            raise ValueError('Missing backup manifest')
        manifest = json.load(manifest_file)
        if manifest.get('version') != 1 or not isinstance(manifest.get('objects'), list):
            raise ValueError('Invalid backup manifest')
        for name in ('database.dump', 'roles.sql', 'runtime.env', 'host-telemetry-state.json'):
            if archive.getmember(name).size <= 0:
                raise ValueError('Missing required backup data')
        expected = set()
        for entry in manifest['objects']:
            name = 'objects/' + entry['path']
            if name in expected:
                raise ValueError('Duplicate object manifest path')
            expected.add(name)
            member = archive.getmember(name)
            if not member.isfile() or member.size != entry['bytes']:
                raise ValueError('Object size mismatch')
            digest = hashlib.sha256()
            with archive.extractfile(member) as data:
                while block := data.read(4 * 1024 * 1024):
                    digest.update(block)
            if digest.hexdigest() != entry['sha256']:
                raise ValueError('Object checksum mismatch')
        actual = {m.name for m in members if m.isfile() and m.name.startswith('objects/')}
        if actual != expected:
            raise ValueError('Object manifest coverage mismatch')
        return len(expected)


if __name__ == '__main__':
    try:
        count = verify(sys.argv[1])
        print(f'Archive structure and {count} object checksums passed. Database restore and application behavior remain untested.')
    except Exception:
        raise SystemExit('Archive verification failed; do not restore it.')
