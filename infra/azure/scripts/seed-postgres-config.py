#!/usr/bin/env python3
"""Seed baked Postgres configuration once, without overwriting durable pgsodium keys."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=60).stdout.strip()


def seed_config(config, image, execute=command):
    config = Path(config)
    if not re.fullmatch(r'supabase/postgres:17\.6\.1\.136@sha256:[a-f0-9]{64}', image):
        raise ValueError('Unexpected database image')
    required = ('supautils.conf', 'wal-g.conf', 'read-replica.conf')
    if any(config.iterdir()):
        if not all((config / name).is_file() for name in required) or not (config / 'conf.d').is_dir():
            raise ValueError('Existing configuration incomplete; restore it without overwriting keys')
        return
    staging = Path(tempfile.mkdtemp(prefix='.postgres-config.', dir=config.parent))
    container = None
    try:
        container = execute(['docker', 'create', '--entrypoint', '/bin/true', image])
        if not re.fullmatch(r'[a-f0-9]{12,64}', container):
            raise ValueError('Invalid seed container identity')
        execute(['docker', 'cp', '-a', f'{container}:/etc/postgresql-custom', str(staging)])
        copied = staging / 'postgresql-custom'
        if not all((copied / name).is_file() for name in required) or not (copied / 'conf.d').is_dir():
            raise ValueError('Pinned image configuration incomplete')
        # rmdir refuses a directory populated concurrently; no durable config/key is overwritten.
        config.rmdir()
        copied.rename(config)
    finally:
        if container and re.fullmatch(r'[a-f0-9]{12,64}', container):
            execute(['docker', 'rm', container])
        shutil.rmtree(staging)


if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or command(['findmnt', '-n', '-o', 'TARGET', '--target', '/srv/academy']) != '/srv/academy':
            raise ValueError('Root and the mounted data disk are required')
        image = json.loads(Path('/opt/vfuture-academy/infra/azure/upstream-lock.json').read_text())['images']['db']
        seed_config('/srv/academy/postgres-config', image)
    except Exception:
        raise SystemExit('Postgres configuration seed failed. Existing configuration and keys must be preserved.')
