#!/usr/bin/env bash
set -euo pipefail
set +x
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the approved Academy VM.' >&2; exit 1; }
[[ $(hostname) == academy-sg ]] || { echo 'Unexpected host; refusing setup.' >&2; exit 1; }
[[ ${1:-} == --initialize-empty-disk || ${1:-} == --use-existing-disk ]] || { echo 'Choose --initialize-empty-disk or --use-existing-disk explicitly.' >&2; exit 1; }
device=/dev/disk/azure/scsi1/lun0
[[ -b $device ]] || { echo 'The expected LUN0 data disk is absent.' >&2; exit 1; }
[[ $(blockdev --getsize64 "$device") == 68719476736 ]] || { echo 'The data disk is not the approved 64 GiB size.' >&2; exit 1; }
if [[ $1 == --initialize-empty-disk ]]; then
  [[ -z $(wipefs -n "$device" --output TYPE --noheadings) ]] || { echo 'Disk contains a signature; refusing formatting.' >&2; exit 1; }
  [[ -z $(lsblk -n -o MOUNTPOINTS "$device" | tr -d '[:space:]') ]] || { echo 'Disk is mounted; refusing formatting.' >&2; exit 1; }
  mkfs.ext4 -L academy-data "$device"
fi
[[ $(blkid -s TYPE -o value "$device") == ext4 ]] || { echo 'Expected an ext4 Academy data disk.' >&2; exit 1; }
uuid=$(blkid -s UUID -o value "$device")
mkdir -p /srv/academy
if ! findmnt -n /srv/academy >/dev/null; then
  # A failed mount must stop startup, never create an empty database on the OS disk.
  if ! grep -q "UUID=$uuid " /etc/fstab; then printf 'UUID=%s /srv/academy ext4 defaults,nodev,nosuid 0 2\n' "$uuid" >> /etc/fstab; fi
  mount /srv/academy
fi
[[ $(findmnt -n -o UUID /srv/academy) == "$uuid" ]] || { echo 'Wrong data disk mounted.' >&2; exit 1; }
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 python3 age
systemctl enable --now docker
install -d -m 0700 /etc/vfuture-academy
install -d -m 0750 /etc/vfuture-academy/tls
install -d -m 0755 /srv/academy/control /srv/academy/gateway-state
if [[ ! -e /srv/academy/host-telemetry-state.json ]]; then
  [[ $1 == --initialize-empty-disk ]] || { echo 'Host telemetry ledger missing on existing disk; restore it, never reset counters.' >&2; exit 1; }
  ( umask 077; printf '{"sequence":0}\n' > /srv/academy/host-telemetry-state.json )
fi
chown 10001:10001 /srv/academy/gateway-state
install -d -m 0700 /srv/academy/postgres /srv/academy/postgres-config
install -d -m 0755 /srv/academy/objects
# An independently sized filesystem bounds all writes, including imports bypassing the app.
object_image=/srv/academy/objects.ext4
if [[ ! -e $object_image ]]; then
  [[ -z $(ls -A /srv/academy/objects) ]] || { echo 'Existing object files need an approved migration; refusing initialization.' >&2; exit 1; }
  fallocate -l 10737418240 "$object_image"
  chmod 0600 "$object_image"
  mkfs.ext4 -m 0 -L academy-objects "$object_image"
fi
[[ $(stat -c '%s' "$object_image") == 10737418240 && $(blkid -s TYPE -o value "$object_image") == ext4 ]] || { echo 'Unexpected object filesystem; refusing mount.' >&2; exit 1; }
if ! grep -q '^/srv/academy/objects.ext4 ' /etc/fstab; then
  printf '/srv/academy/objects.ext4 /srv/academy/objects ext4 loop,nodev,nosuid,noexec,x-systemd.requires-mounts-for=/srv/academy 0 2\n' >> /etc/fstab
fi
mountpoint -q /srv/academy/objects || mount /srv/academy/objects

install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-control.service /etc/systemd/system/academy-control.service
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-control.timer /etc/systemd/system/academy-control.timer
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-telemetry.service /etc/systemd/system/academy-telemetry.service
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-telemetry.timer /etc/systemd/system/academy-telemetry.timer
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-backup.service /etc/systemd/system/academy-backup.service
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-runtime.service /etc/systemd/system/academy-runtime.service
install -m 0644 /opt/vfuture-academy/infra/azure/systemd/academy-monitor.slice /etc/systemd/system/academy-monitor.slice
for unit in academy-daily-backup.service academy-daily-backup.timer academy-cost-backup.service academy-cost-backup.timer; do
  install -m 0644 "/opt/vfuture-academy/infra/azure/systemd/$unit" "/etc/systemd/system/$unit"
done
# Docker restart policies must not bypass the runtime mount checks during host boot.
install -d -m 0755 /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/academy-mounts.conf <<'MOUNTS'
[Unit]
RequiresMountsFor=/srv/academy /srv/academy/objects
After=srv-academy.mount srv-academy-objects.mount
BindsTo=srv-academy.mount srv-academy-objects.mount
MOUNTS
systemctl daemon-reload
systemctl enable --now academy-control.timer academy-telemetry.timer
printf 'Host prepared. Install nonsecret host.json and versioned Key Vault secrets before starting the runtime.\n'
