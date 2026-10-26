#!/usr/bin/env bash
set -euo pipefail
set +x
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the approved Academy VM.' >&2; exit 1; }
[[ $(findmnt -n -o TARGET --target /srv/academy) == /srv/academy ]] || { echo 'Data disk is not mounted; refusing OS-disk database storage.' >&2; exit 1; }
[[ $(findmnt -n -o TARGET --target /srv/academy/objects) == /srv/academy/objects ]] || { echo 'Bounded object filesystem is not mounted.' >&2; exit 1; }
cd /opt/vfuture-academy/infra/azure
[[ -s /etc/vfuture-academy/runtime.env && -s /etc/vfuture-academy/tls/privkey.pem && -s /etc/vfuture-academy/tls/fullchain.pem ]] || { echo 'Retrieve the versioned Key Vault secrets first.' >&2; exit 1; }
[[ $(stat -c '%a' /etc/vfuture-academy/runtime.env) == 600 ]] || { echo 'Runtime secrets must be mode 0600.' >&2; exit 1; }
python3 scripts/fetch-upstream.py
# Quiet validation is essential: compose config without --quiet prints credentials.
docker compose --env-file /etc/vfuture-academy/runtime.env -f runtime/compose.json config --quiet
systemctl start academy-control.service
# No mutable tag fallback; manifests are pinned to checked registry digests.
docker compose --env-file /etc/vfuture-academy/runtime.env -f runtime/compose.json pull
scripts/seed-postgres-config.sh
if [[ ${1:-} == --initialize-state ]]; then
  docker compose --env-file /etc/vfuture-academy/runtime.env -f runtime/compose.json run --rm --no-deps gateway node server.mjs --initialize-state
elif [[ $# -ne 0 ]]; then
  echo 'Only the explicit first-run --initialize-state flag is accepted.' >&2; exit 1
fi
docker compose --env-file /etc/vfuture-academy/runtime.env -f runtime/compose.json up -d --wait
