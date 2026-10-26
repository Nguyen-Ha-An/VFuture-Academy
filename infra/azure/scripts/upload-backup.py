#!/usr/bin/env python3
"""Bounded, idempotent encrypted backups with backup-only 7/4/3 retention."""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('azure_host', Path(__file__).with_name('azure-host.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
GiB = 1024**3
NAME = re.compile(r'academy-(?:daily-\d{8}|drain-[a-f0-9]{24})\.tar\.age')


def retention_deletions(records, current):
    """Keep newest point per 7 days, 4 ISO weeks and 3 calendar months (union <=14)."""
    ordered = sorted(records, key=lambda row: row['createdAt'], reverse=True)
    keep = {current}
    for count, bucket in [(7, lambda d: d.date()), (4, lambda d: d.isocalendar()[:2]), (3, lambda d: (d.year, d.month))]:
        periods = set()
        for row in ordered:
            date = datetime.fromisoformat(row['createdAt'].replace('Z', '+00:00'))
            key = bucket(date)
            if key not in periods and len(periods) < count:
                keep.add(row['name'])
                periods.add(key)
    return [row['name'] for row in ordered if row['name'] not in keep]


def capacity_allowed(committed, soft_deleted, uncommitted, incoming):
    values = [committed, soft_deleted, uncommitted, incoming]
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in values):
        return False
    # Reserve another full failed upload even after counting observed pending blocks.
    return incoming <= 12 * GiB and sum(values) + 12 * GiB <= 300 * GiB


def main():
    source = Path(sys.argv[1]).resolve()
    if source.parent != Path('/var/lib/academy-backup') or not NAME.fullmatch(source.name):
        raise ValueError('Only a fixed-cycle Academy archive can be uploaded')
    size = source.stat().st_size
    if not 0 < size <= 12 * GiB:
        raise ValueError('Archive exceeds 12 GiB')
    config = json.loads(Path('/etc/vfuture-academy/host.json').read_text())
    account = config['storageAccount']
    if not re.fullmatch(r'[a-z0-9]{3,24}', account):
        raise ValueError('Invalid storage account')
    base = f'https://{account}.blob.core.windows.net/backups'
    bearer = host.token('https://storage.azure.com/')
    token_time = time.monotonic()
    def request(url, body=None, method='GET', extra=None):
        nonlocal bearer, token_time
        if time.monotonic() - token_time > 1800:
            bearer = host.token('https://storage.azure.com/')
            token_time = time.monotonic()
        headers = {'Authorization': 'Bearer ' + bearer, 'x-ms-version': '2023-11-03'}
        headers.update(extra or {})
        return urllib.request.urlopen(urllib.request.Request(url, data=body, method=method, headers=headers), timeout=45)
    digest = hashlib.sha256()
    with source.open('rb') as data:
        while block := data.read(4 * 1024**2):
            digest.update(block)
    checksum = digest.hexdigest()
    url = base + '/' + source.name
    exists = False
    try:
        with request(url, method='HEAD') as response:
            if int(response.headers['Content-Length']) != size or response.headers.get('x-ms-meta-sha256') != checksum:
                raise ValueError('A different archive already occupies this immutable backup cycle')
            exists = True
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    def inventory():
        rows = []
        marker = ''
        for _ in range(10):
            query = urllib.parse.urlencode({'restype': 'container', 'comp': 'list', 'include': 'deleted,metadata,uncommittedblobs', 'maxresults': 1000, 'marker': marker})
            with request(base + '?' + query) as response:
                content = response.read(4_000_001)
            if len(content) > 4_000_000:
                raise ValueError('Unknown oversized backup inventory')
            page = ET.fromstring(content)
            rows.extend(page.findall('Blobs/Blob'))
            marker = page.findtext('NextMarker') or ''
            if not marker:
                return rows
        raise ValueError('Backup inventory pagination exceeded bound')
    rows = inventory()
    known = []
    etags = {}
    for row in rows:
        name = row.findtext('Name', '')
        if row.findtext('Deleted') == 'true' or not NAME.fullmatch(name):
            continue
        created = row.findtext('Metadata/createdat')
        if not created or not re.fullmatch(r'[a-f0-9]{64}', row.findtext('Metadata/sha256', '')):
            continue
        datetime.fromisoformat(created.replace('Z', '+00:00'))
        known.append({'name': name, 'createdAt': created})
        etags[name] = row.findtext('Properties/Etag')
    for expired in retention_deletions(known, source.name):
        if not etags.get(expired):
            raise ValueError('Retention cannot prove a stable backup version')
        with request(base + '/' + expired, method='DELETE', extra={'If-Match': etags[expired]}):
            pass
    rows = inventory()  # Deleted blobs remain billable and are counted, never subtracted optimistically.
    committed = soft_deleted = pending = 0
    for row in rows:
        length = row.findtext('Properties/Content-Length')
        if length is None or not length.isdigit():
            raise ValueError('Provider did not return a measurable retained backup size')
        if row.findtext('Deleted') == 'true':
            soft_deleted += int(length)
            continue
        committed += int(length)
        name = row.findtext('Name')
        if not name:
            raise ValueError('Invalid inventory record')
        with request(base + '/' + urllib.parse.quote(name, safe='/') + '?comp=blocklist&blocklisttype=uncommitted') as response:
            blocks = ET.fromstring(response.read(4_000_000))
        for block in blocks.findall('UncommittedBlocks/Block'):
            value = block.findtext('Size')
            if value is None or not value.isdigit():
                raise ValueError('Unmeasured pending upload')
            pending += int(value)
    if not exists:
        if not capacity_allowed(committed, soft_deleted, pending, size):
            raise ValueError('300 GiB backup ceiling or pending-upload reserve exceeded')
        ids = []
        with source.open('rb') as data:
            index = 0
            while block := data.read(4 * 1024**2):
                block_id = base64.b64encode(f'{index:08d}'.encode()).decode()
                with request(url + '?comp=block&blockid=' + urllib.parse.quote(block_id, safe=''), block, 'PUT'):
                    pass
                ids.append(block_id)
                index += 1
        body = ('<BlockList>' + ''.join(f'<Latest>{value}</Latest>' for value in ids) + '</BlockList>').encode()
        with request(url + '?comp=blocklist', body, 'PUT', {'Content-Type': 'application/xml', 'If-None-Match': '*', 'x-ms-meta-sha256': checksum, 'x-ms-meta-createdat': datetime.now(timezone.utc).isoformat()}):
            pass
    with request(url, method='HEAD') as response:
        if int(response.headers['Content-Length']) != size or response.headers.get('x-ms-meta-sha256') != checksum:
            raise ValueError('Uploaded archive verification failed')
    # Recompute after commit so the new point replaces the oldest daily bucket immediately.
    final_known = []
    final_etags = {}
    for row in inventory():
        name = row.findtext('Name', '')
        created = row.findtext('Metadata/createdat')
        if row.findtext('Deleted') != 'true' and NAME.fullmatch(name) and created and re.fullmatch(r'[a-f0-9]{64}', row.findtext('Metadata/sha256', '')):
            final_known.append({'name': name, 'createdAt': created})
            final_etags[name] = row.findtext('Properties/Etag')
    for expired in retention_deletions(final_known, source.name):
        if not final_etags.get(expired):
            raise ValueError('Unknown backup version after upload')
        with request(base + '/' + expired, method='DELETE', extra={'If-Match': final_etags[expired]}):
            pass
    receipt = {'version': 1, 'backupReference': source.name, 'sha256': checksum, 'bytes': size}
    host.atomic_write('/var/lib/academy-backup/upload-receipt.json', json.dumps(receipt) + '\n')
    host.atomic_write(str(source) + '.uploaded.json', json.dumps(receipt) + '\n')
    # The remote 7/4/3 set is authoritative; keep only this successful local encrypted cache.
    # Failed/unverified archives are never swept automatically.
    for marker in source.parent.glob('academy-*.tar.age.uploaded.json'):
        old = Path(str(marker).removesuffix('.uploaded.json'))
        if old != source and NAME.fullmatch(old.name):
            old.unlink(missing_ok=True)
            marker.unlink()
    print('Encrypted backup committed; 7 daily / 4 weekly / 3 monthly retention applied. Restore remains untested.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Backup upload failed; keep the encrypted archive and inspect protected state.')
