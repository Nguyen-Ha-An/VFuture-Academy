#!/usr/bin/env python3
"""Bounded managed-identity reads. Never log access tokens, secret values or signed URLs."""
import argparse
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import re
import tempfile
import subprocess
import urllib.parse
import urllib.request


def token(resource):
    query = urllib.parse.urlencode({'api-version': '2018-02-01', 'resource': resource})
    request = urllib.request.Request('http://169.254.169.254/metadata/identity/oauth2/token?' + query, headers={'Metadata': 'true'})
    # Explicitly bypass environment proxies for the link-local metadata service.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
        return json.load(response)['access_token']


def request_json(url, audience, limit=65536):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token(audience), 'x-ms-version': '2023-11-03'})
    with urllib.request.urlopen(request, timeout=10) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError('Remote document exceeds the configured limit')
    return json.loads(content)


def atomic_write(path, content, mode=0o600, group=None):
    path = Path(path)
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.new-', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        if group is not None:
            os.fchown(fd, 0, group)
        with os.fdopen(fd, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_control(control, now=None):
    now = now or datetime.now(timezone.utc)
    if control.get('version') != 1 or control.get('mode') not in ('normal', 'discretionary-stop', 'drain'):
        raise ValueError('Invalid maintenance control')
    updated = datetime.fromisoformat(control['updatedAt'].replace('Z', '+00:00'))
    expires = datetime.fromisoformat(control['expiresAt'].replace('Z', '+00:00'))
    if not updated.tzinfo or not expires.tzinfo or updated > now + timedelta(seconds=30) or expires <= now or expires - updated > timedelta(minutes=15) or updated < now - timedelta(minutes=15):
        raise ValueError('Stale or invalid maintenance control')
    return control


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['sync-control', 'fetch-secrets', 'upload-telemetry'])
    parser.add_argument('--config', default='/etc/vfuture-academy/host.json')
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    if not re.fullmatch(r'[a-z0-9]{3,24}', config['storageAccount']):
        raise ValueError('Invalid Academy storage account')
    if args.command == 'sync-control':
        control = validate_control(request_json(f"https://{config['storageAccount']}.blob.core.windows.net/control/maintenance.json", 'https://storage.azure.com/'))
        atomic_write('/srv/academy/control/maintenance.json', json.dumps(control) + '\n', 0o644)
    elif args.command == 'upload-telemetry':
        telemetry = json.loads(Path('/srv/academy/gateway-state/telemetry.json').read_text())
        observed = datetime.fromisoformat(telemetry['observedAt'].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        if telemetry.get('version') != 1 or not observed.tzinfo or observed > now:
            raise ValueError('Gateway telemetry is invalid')
        container = subprocess.run(['docker', 'inspect', 'academy-gateway-1', '--format', '{{.State.Running}}'], capture_output=True, check=True, text=True, timeout=10).stdout.strip()
        if container == 'true' and now - observed > timedelta(seconds=60):
            raise ValueError('Running gateway telemetry is stale')
        if container not in ('true', 'false'):
            raise ValueError('Gateway process state unavailable')
        if container == 'false':
            # Real stopped-container evidence, not a guessed zero while the gateway is unreachable.
            telemetry.update({'activeRequests': 0, 'queuedRequests': 0})
        state_path = Path('/srv/academy/host-telemetry-state.json')
        state = json.loads(state_path.read_text())
        if not isinstance(state.get('sequence'), int) or state['sequence'] < 0:
            raise ValueError('Host telemetry sequence missing or corrupt')
        sequence = max(state['sequence'] + 1, telemetry['sequence'])
        atomic_write(state_path, json.dumps({'sequence': sequence}) + '\n')
        telemetry.update({'sequence': sequence, 'observedAt': now.isoformat()})
        reserve = config.get('pendingVariableUsd')
        if not isinstance(reserve, (float, int)) or isinstance(reserve, bool) or not 0 < reserve < 10000:
            raise ValueError('A reviewed positive variable-cost reserve is required')
        vm_id = config['vmResourceId']
        if not re.fullmatch(r'/subscriptions/[a-f0-9-]{36}/resourceGroups/rg-vfuture-academy-sg/providers/Microsoft.Compute/virtualMachines/academy-sg-vm', vm_id, re.IGNORECASE):
            raise ValueError('Unexpected Academy VM scope')
        def used(path):
            st = os.statvfs(path)
            return 1 - st.f_bavail / st.f_blocks
        count = subprocess.run(['docker', 'compose', '--env-file', '/etc/vfuture-academy/runtime.env', '-f', '/opt/vfuture-academy/infra/azure/runtime/compose.json', 'exec', '-T', 'db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-Atqc', "select count(*) from public.exam_attempts where status = 'in_progress'"], capture_output=True, check=True, text=True, timeout=15).stdout.strip()
        if not count.isdigit():
            raise ValueError('Active exam count unavailable')
        telemetry['activeExamAttempts'] = int(count)
        telemetry.update({'vmResourceId': vm_id, 'pendingVariableUsd': reserve, 'diskUsedRatio': max(used('/srv/academy'), used('/srv/academy/objects'))})
        payload = json.dumps(telemetry).encode()
        url = f"https://{config['storageAccount']}.blob.core.windows.net/telemetry/telemetry.json"
        request = urllib.request.Request(url, data=payload, method='PUT', headers={'Authorization': 'Bearer ' + token('https://storage.azure.com/'), 'x-ms-version': '2023-11-03', 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10):
            pass
    else:
        vault = config['keyVault']
        if not re.fullmatch(r'[A-Za-z0-9-]{3,24}', vault):
            raise ValueError('Invalid Academy Key Vault')
        pending = []
        for name, target, mode, group in [('academy-runtime-env', '/etc/vfuture-academy/runtime.env', 0o600, None), ('academy-tls-cert', '/etc/vfuture-academy/tls/fullchain.pem', 0o644, 101), ('academy-tls-key', '/etc/vfuture-academy/tls/privkey.pem', 0o640, 101)]:
            version = config['secretVersions'][name]
            if not re.fullmatch(r'[a-f0-9]{32}', version):
                raise ValueError('Every Key Vault secret requires an immutable version')
            value = request_json(f'https://{vault}.vault.azure.net/secrets/{name}/{version}?api-version=7.4', 'https://vault.azure.net')['value']
            pending.append((target, value, mode, group))
        for target, value, mode, group in pending:
            atomic_write(target, value, mode, group)
        runtime = next(value for target, value, mode, group in pending if target.endswith('/runtime.env'))
        key_match = re.search(r"^SUPABASE_GATEWAY_KEY='([a-f0-9]{64})'$", runtime, re.MULTILINE)
        if not key_match:
            raise ValueError('Expected generated gateway key for private Studio proxy')
        proxy = '''worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr crit;
events { worker_connections 32; }
http {
 access_log off;
 client_body_temp_path /tmp/body;
 proxy_temp_path /tmp/proxy;
 fastcgi_temp_path /tmp/fastcgi;
 uwsgi_temp_path /tmp/uwsgi;
 scgi_temp_path /tmp/scgi;
 server {
  listen 172.31.78.2:8081;
  client_max_body_size 2m;
  location / {
   proxy_pass http://gateway:8080;
   proxy_set_header x-vfuture-gateway-key __KEY__;
   proxy_set_header X-Forwarded-For "";
   proxy_set_header X-Real-IP "";
   proxy_set_header Forwarded "";
   proxy_set_header Connection "";
   proxy_buffering off;
  }
 }
}
'''.replace('__KEY__', key_match.group(1))
        atomic_write('/etc/vfuture-academy/operator-proxy.conf', proxy, 0o640, 101)
        os.chown('/etc/vfuture-academy/tls', 0, 101)
        os.chmod('/etc/vfuture-academy/tls', 0o750)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Avoid urllib exception strings: they can include request paths and credentials.
        raise SystemExit('Academy host sync failed; existing control/secrets were retained. Inspect state locally without logging credentials.')
