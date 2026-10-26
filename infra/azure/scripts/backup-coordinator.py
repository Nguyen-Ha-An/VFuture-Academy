#!/usr/bin/env python3
"""Daily and cost-stop backup coordination. No success receipt precedes a real uploaded archive."""
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import os
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid

spec = importlib.util.spec_from_file_location('host', Path(__file__).with_name('azure-host.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
ROOT = Path('/opt/vfuture-academy/infra/azure')
COMPOSE = ['docker', 'compose', '--env-file', '/etc/vfuture-academy/runtime.env', '-f', str(ROOT / 'runtime/compose.json')]


def run(command, timeout=60, env=None):
    # Capture output so SQL, container diagnostics or paths cannot leak into service logs.
    return subprocess.run(command, capture_output=True, check=True, text=True, timeout=timeout, env=env).stdout.strip()


def sql(query):
    return run(COMPOSE + ['exec', '-T', '-e', 'PGOPTIONS=-c default_transaction_read_only=off', 'db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atqc', query])


def active_exams():
    value = sql("select count(*) from public.exam_attempts where status = 'in_progress'")
    if not value.isdigit():
        raise ValueError('active-exam-count-unavailable')
    return int(value)


def scheduled_control_matches(control, request_id):
    return control.get('mode') == 'drain' and control.get('drainReason') == 'scheduled-backup' and control.get('backupRequestId') == request_id and isinstance(control.get('drainStartedAt'), str)


def can_resume(control, receipt):
    try:
        host.validate_control(control)
        return control.get('mode') == 'normal' and datetime.fromisoformat(control['updatedAt'].replace('Z', '+00:00')) > datetime.fromisoformat(receipt['recordedAt'].replace('Z', '+00:00'))
    except (KeyError, ValueError):
        return False


def put(config, name, value, headers=None):
    if name not in ('backup-request.json', 'checkpoint.json', 'backup-alert.json'):
        raise ValueError('unexpected-telemetry-blob')
    url = f"https://{config['storageAccount']}.blob.core.windows.net/telemetry/{name}"
    request_headers = {'Authorization': 'Bearer ' + host.token('https://storage.azure.com/'), 'x-ms-version': '2023-11-03', 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json'}
    request_headers.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(value).encode(), method='PUT', headers=request_headers)
    with urllib.request.urlopen(req, timeout=15):
        pass


def read_checkpoint(config):
    url = f"https://{config['storageAccount']}.blob.core.windows.net/telemetry/checkpoint.json"
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + host.token('https://storage.azure.com/'), 'x-ms-version': '2023-11-03'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read(65537)
            if len(body) > 65536 or not response.headers.get('ETag'):
                raise ValueError('unverifiable-checkpoint-ack')
            return json.loads(body), response.headers['ETag']
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None, None
        raise


def publish_checkpoint(config, receipt, directory=Path('/var/lib/academy-backup'), send=put, read=read_checkpoint):
    # Persist immutable pending evidence first. A local file never proves remote publication.
    if receipt.get('version') != 1 or receipt.get('vmResourceId') != config['vmResourceId'] or receipt.get('backupCompleted') is not True or receipt.get('databaseFlushed') is not True:
        raise ValueError('invalid-local-checkpoint')
    directory = Path(directory)
    host.atomic_write(directory / 'checkpoint.json', json.dumps(receipt) + '\n')
    current, etag = read(config)
    if current != receipt:
        if current is not None and datetime.fromisoformat(current['recordedAt'].replace('Z', '+00:00')) > datetime.fromisoformat(receipt['recordedAt'].replace('Z', '+00:00')):
            raise ValueError('newer-remote-checkpoint-must-not-be-overwritten')
        send(config, 'checkpoint.json', receipt, {'If-Match': etag} if etag else {'If-None-Match': '*'})
    acknowledged, etag = read(config)
    if acknowledged != receipt or not etag:
        raise ValueError('checkpoint-publication-unacknowledged')
    digest = hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()
    host.atomic_write(directory / 'checkpoint-published.json', json.dumps({'version': 1, 'receiptSha256': digest, 'etag': etag}) + '\n')


def control():
    run(['python3', str(ROOT / 'scripts/azure-host.py'), 'sync-control'], 30)
    return host.validate_control(json.loads(Path('/srv/academy/control/maintenance.json').read_text()))


def restart_after_normal(receipt):
    value = control()
    if not can_resume(value, receipt):
        raise ValueError('fresh-post-backup-normal-control-required')
    sql('ALTER DATABASE postgres RESET default_transaction_read_only')
    sql('ALTER SYSTEM RESET cron.launch_active_jobs')
    sql('SELECT pg_reload_conf()')
    run(COMPOSE + ['up', '-d', '--wait', 'auth', 'rest', 'storage', 'gateway', 'tls'], 180)
    host.atomic_write('/var/lib/academy-backup/checkpoint-resumed.json', json.dumps({'receiptSha256': hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()}) + '\n')


def snapshot_admitted(value, active, request_id):
    if value.get('mode') != 'drain' or not value.get('drainStartedAt') or not isinstance(active, int) or isinstance(active, bool) or active < 0:
        return False
    if request_id:
        return scheduled_control_matches(value, request_id) and active == 0
    return value.get('drainReason') == 'financial'


def execute_backup(config, value, request_id=None):
    if not snapshot_admitted(value, active_exams(), request_id):
        raise ValueError('independent-drain-or-exam-admission-required')
    started = datetime.now(timezone.utc)
    cycle = 'daily-' + started.strftime('%Y%m%d') if request_id else 'drain-' + hashlib.sha256(value['drainStartedAt'].encode()).hexdigest()[:24]
    archive = Path('/var/lib/academy-backup') / f'academy-{cycle}.tar.age'
    context_path = Path(str(archive) + '.context.json')
    if archive.exists():
        context = json.loads(context_path.read_text())
        if context.get('drainStartedAt') != value['drainStartedAt']:
            raise ValueError('backup-cycle-belongs-to-another-drain')
        run(['python3', str(ROOT / 'scripts/upload-backup.py'), str(archive)], 1200)
    else:
        host.atomic_write(context_path, json.dumps({'drainStartedAt': value['drainStartedAt']}) + '\n')
        run([str(ROOT / 'scripts/backup.sh'), '--approved-drain'], 1200, {**os.environ, 'BACKUP_CYCLE_ID': cycle, 'BACKUP_DRAIN_KIND': value['drainReason']})
    upload_path = Path('/var/lib/academy-backup/upload-receipt.json')
    if datetime.fromtimestamp(upload_path.stat().st_mtime, timezone.utc) < started:
        raise ValueError('stale-backup-upload-receipt')
    upload = json.loads(upload_path.read_text())
    if upload.get('version') != 1 or not upload.get('backupReference') or not upload.get('sha256') or upload.get('bytes', 0) <= 0:
        raise ValueError('backup-upload-unverified')
    # Verify every writer container actually stopped; the SQL scheduler was disabled by backup.sh.
    running = run(COMPOSE + ['ps', '--services', '--status', 'running']).splitlines()
    if any(service in running for service in ['tls', 'gateway', 'auth', 'rest', 'storage', 'studio', 'meta', 'operator-proxy']):
        raise ValueError('writer-container-still-running')
    remaining_exams = active_exams()
    if request_id and remaining_exams != 0:
        raise ValueError('active-exams-after-scheduled-drain')
    sql('CHECKPOINT')
    current = control()
    if current['mode'] != 'drain' or current.get('drainStartedAt') != value['drainStartedAt']:
        raise ValueError('drain-changed-during-backup')
    receipt = {'version': 1, 'vmResourceId': config['vmResourceId'], 'drainStartedAt': current['drainStartedAt'], 'recordedAt': datetime.now(timezone.utc).isoformat(), 'activeRequests': 0, 'activeExamAttempts': remaining_exams, 'databaseFlushed': True, 'backupCompleted': True, 'backupReference': upload['backupReference'], 'backupSha256': upload['sha256']}
    if request_id:
        receipt['requestId'] = request_id
    publish_checkpoint(config, receipt)
    return receipt


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ('daily', 'cost-drain', 'resume'):
        raise ValueError('choose-daily-cost-drain-or-resume')
    mode = sys.argv[1]
    config = json.loads(Path('/etc/vfuture-academy/host.json').read_text())
    with open('/run/academy-backup-coordinator.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if mode == 'resume':
            restart_after_normal(json.loads(Path('/var/lib/academy-backup/checkpoint.json').read_text()))
            return
        if mode == 'cost-drain':
            value = control()
            receipt_path = Path('/var/lib/academy-backup/checkpoint.json')
            if receipt_path.exists():
                pending = json.loads(receipt_path.read_text())
                if value.get('mode') == 'drain' and pending.get('drainStartedAt') == value.get('drainStartedAt'):
                    # Retry exact bytes after an interrupted/failed PUT, even for a scheduled drain.
                    # Never renew recordedAt to disguise stale checkpoint evidence.
                    publish_checkpoint(config, pending)
                    if datetime.now(timezone.utc) - datetime.fromisoformat(pending['recordedAt'].replace('Z', '+00:00')) > timedelta(minutes=15):
                        raise ValueError('published-checkpoint-expired-requires-real-revalidation')
                    return
                if can_resume(value, pending):
                    resumed = Path('/var/lib/academy-backup/checkpoint-resumed.json')
                    if resumed.exists() and json.loads(resumed.read_text()).get('receiptSha256') == hashlib.sha256(json.dumps(pending, sort_keys=True).encode()).hexdigest():
                        return
                    publish_checkpoint(config, pending)
                    restart_after_normal(pending)
                    put(config, 'backup-alert.json', {'version': 1, 'vmResourceId': config['vmResourceId'], 'status': 'completed', 'recordedAt': datetime.now(timezone.utc).isoformat(), 'backupReference': pending['backupReference']})
                    return
            if value.get('mode') != 'drain' or value.get('drainReason') != 'financial':
                return
            # The independent financial control already applied its bounded save grace.
            # Preserve in-progress rows in the snapshot; do not wait indefinitely for semantic completion.
            execute_backup(config, value)
            return
        if config.get('dailyBackupEnabled') is not True:
            raise ValueError('daily-backup-not-enabled-by-operator')
        # A scheduled backup waits at most two hours for exams; failure is an explicit alert.
        deadline = time.monotonic() + 2 * 60 * 60
        while active_exams() and time.monotonic() < deadline:
            time.sleep(60)
        if active_exams():
            raise ValueError('daily-backup-delayed-by-active-exams')
        requested = datetime.now(timezone.utc)
        request_id = str(uuid.uuid4())
        request = {'version': 1, 'vmResourceId': config['vmResourceId'], 'requestId': request_id, 'requestedAt': requested.isoformat(), 'expiresAt': (requested + timedelta(minutes=30)).isoformat()}
        put(config, 'backup-request.json', request)
        deadline = time.monotonic() + 6 * 60
        value = control()
        while not scheduled_control_matches(value, request_id) and time.monotonic() < deadline:
            time.sleep(15)
            value = control()
        if not scheduled_control_matches(value, request_id):
            raise ValueError('daily-backup-not-admitted-by-independent-guard')
        receipt = execute_backup(config, value, request_id)
        # Only a NEW normal control from the independent guard can reopen services.
        # The guard checks fresh finance + the exact request/receipt; a financial drain stays closed.
        deadline = time.monotonic() + 6 * 60
        while time.monotonic() < deadline:
            if can_resume(control(), receipt):
                restart_after_normal(receipt)
                put(config, 'backup-alert.json', {'version': 1, 'vmResourceId': config['vmResourceId'], 'status': 'completed', 'recordedAt': datetime.now(timezone.utc).isoformat(), 'backupReference': receipt['backupReference']})
                return
            time.sleep(15)
        raise ValueError('backup-complete-awaiting-safe-resume')


if __name__ == '__main__':
    try:
        main()
    except BlockingIOError:
        # Another daily/cost backup already owns the coordinator; never run two snapshots.
        sys.exit(0)
    except Exception:
        # Alert state goes to the independently readable telemetry container and journald.
        try:
            cfg = json.loads(Path('/etc/vfuture-academy/host.json').read_text())
            put(cfg, 'backup-alert.json', {'version': 1, 'vmResourceId': cfg['vmResourceId'], 'status': 'attention-required', 'recordedAt': datetime.now(timezone.utc).isoformat(), 'reason': 'backup-coordination-failed-services-may-remain-drained'})
        except Exception:
            pass
        raise SystemExit('Academy backup needs operator attention; inspect protected state. No successful checkpoint was fabricated.')
