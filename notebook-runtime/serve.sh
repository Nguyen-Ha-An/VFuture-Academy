#!/usr/bin/env bash
set -euo pipefail
runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$runtime_dir/.venv/bin/python" "$runtime_dir/serve.py"
