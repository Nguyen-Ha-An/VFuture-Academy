#!/usr/bin/env bash
# Creates an encrypted, consistent backup only after an approved drain. Never changes admission.
set -euo pipefail
set +x
[[ ${EUID} -eq 0 && ${1:-} == --approved-drain ]] || { echo 'Requires root and --approved-drain.' >&2; exit 1; }
exec 9>/run/academy-backup.lock
flock -n 9 || { echo 'Another backup is already running.' >&2; exit 1; }
cd /opt/vfuture-academy/infra/azure
python3 scripts/azure-host.py sync-control
python3 - <<'PY'
import json,sys,os
x=json.load(open('/srv/academy/control/maintenance.json'))
if x['mode'] != 'drain' or x.get('drainReason') != os.environ.get('BACKUP_DRAIN_KIND') or not x.get('drainStartedAt'):sys.exit('Backup requires independently approved matching drain control.')
PY
compose=(docker compose --env-file /etc/vfuture-academy/runtime.env -f runtime/compose.json)
active=$("${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -Atqc "select count(*) from public.exam_attempts where status = 'in_progress'")
[[ $active =~ ^[0-9]+$ ]] || { echo 'Active exam count unavailable.' >&2; exit 1; }
if [[ ${BACKUP_DRAIN_KIND:-} != financial && $active != 0 ]]; then
  echo 'Active exam attempts remain; scheduled backup postponed.' >&2; exit 1
fi
# The public listener closes first. Existing requests have up to 120 seconds to complete.
"${compose[@]}" stop -t 130 tls gateway auth rest storage studio meta operator-proxy
# Deliberately do not restart on an error. The operator investigates while admission stays drained.
# Prevent the resident SQL scheduler from starting jobs during the consistent snapshot.
# No external SQL listener exists; privileged operator writes are prohibited during this window.
"${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET cron.launch_active_jobs = 'off'" >/dev/null
"${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_reload_conf()" >/dev/null
for attempt in $(seq 1 12); do
  writing=$("${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -Atqc "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state in ('active','idle in transaction')")
  [[ $writing == 0 ]] && break
  sleep 5
done
[[ $writing == 0 ]] || { echo 'Database writers did not drain; backup stopped.' >&2; exit 1; }
"${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE postgres SET default_transaction_read_only = on" >/dev/null
"${compose[@]}" exec -T -e 'PGOPTIONS=-c default_transaction_read_only=off' db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c CHECKPOINT >/dev/null
config=/etc/vfuture-academy/host.json
recipient=$(python3 -c 'import json; print(json.load(open("/etc/vfuture-academy/host.json"))["backupAgeRecipient"])')
[[ $recipient == age1* ]] || { echo 'An offline age public recipient is required.' >&2; exit 1; }
install -d -m 0700 /var/lib/academy-backup
[[ $(df -B1 --output=avail /var/lib/academy-backup | tail -1) -ge 21474836480 ]] || { echo 'At least 20 GiB OS-disk staging space is required.' >&2; exit 1; }
staging=$(mktemp -d /var/lib/academy-backup/staging.XXXXXXXX)
trap 'rm -f "$staging/database.dump" "$staging/roles.sql" "$staging/manifest.json"; rmdir "$staging" 2>/dev/null || true' EXIT
umask 077
# No parallel backup workers or compression CPU load. Secret-bearing dumps never enter logs.
( ulimit -f 4194304; "${compose[@]}" exec -T db pg_dump -U supabase_admin -d postgres -Fc -Z0 > "$staging/database.dump" )
"${compose[@]}" exec -T db pg_dumpall -U supabase_admin --roles-only > "$staging/roles.sql"
"${compose[@]}" exec -T db pg_restore --list < "$staging/database.dump" >/dev/null
[[ ${BACKUP_CYCLE_ID:-} =~ ^(daily-[0-9]{8}|drain-[a-f0-9]{24})$ ]] || { echo 'An immutable backup cycle ID is required.' >&2; exit 1; }
output=/var/lib/academy-backup/academy-${BACKUP_CYCLE_ID}.tar.age
[[ ! -e $output ]] || { echo 'This cycle already has an archive; retry upload through the coordinator, never replace it.' >&2; exit 1; }
python3 - "$staging/manifest.json" <<'PY'
import json,sys,datetime,hashlib
from pathlib import Path
root=Path('/opt/vfuture-academy/infra/azure')
x={'version':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'supabaseSourceCommit':json.loads((root/'upstream-lock.json').read_text())['commit'],'control':json.loads(Path('/srv/academy/control/maintenance.json').read_text()),'contents':['database.dump','roles.sql','objects','postgres-config','gateway-state','host-telemetry-state.json','runtime.env']}
x['objects'] = []
for path in sorted(Path('/srv/academy/objects').rglob('*')):
    if path.is_symlink(): raise SystemExit('Unexpected symlink in object store')
    if not path.is_file(): continue
    digest=hashlib.sha256()
    with path.open('rb') as data:
        while block:=data.read(4*1024*1024): digest.update(block)
    x['objects'].append({'path':str(path.relative_to('/srv/academy/objects')),'bytes':path.stat().st_size,'sha256':digest.hexdigest()})
Path(sys.argv[1]).write_text(json.dumps(x)+'\n')
PY
# The archive includes only the mounted object contents, not the 10 GiB loop backing file.
tar -cf - -C "$staging" database.dump roles.sql manifest.json -C /srv/academy objects postgres-config gateway-state host-telemetry-state.json -C /etc/vfuture-academy runtime.env | age -r "$recipient" -o "$output.partial"
mv "$output.partial" "$output"
python3 scripts/upload-backup.py "$output"
# The coordinator issues a checkpoint only after this command succeeds and DB flush is rechecked.
printf 'Encrypted backup uploaded. Services remain stopped until the coordinator verifies a matching normal control or manual recovery.\n'
