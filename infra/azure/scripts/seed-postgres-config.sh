#!/usr/bin/env bash
set -euo pipefail
set +x
exec python3 /opt/vfuture-academy/infra/azure/scripts/seed-postgres-config.py
