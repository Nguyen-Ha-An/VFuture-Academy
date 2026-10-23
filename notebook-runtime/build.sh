#!/usr/bin/env bash
set -euo pipefail

runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
allowed_origins_csv="${VFUTURE_ALLOWED_PARENT_ORIGINS:-http://127.0.0.1:3001,http://localhost:3000}"
IFS=',' read -r -a allowed_origins <<< "$allowed_origins_csv"

for allowed_origin in "${allowed_origins[@]}"; do
  case "$allowed_origin" in
    http://localhost:*|http://127.0.0.1:*|https://*)
      ;;
    *)
      echo "Every VFUTURE_ALLOWED_PARENT_ORIGINS entry must be one exact HTTPS origin (or localhost for development)." >&2
      exit 2
      ;;
  esac
  if [[ "$allowed_origin" == *"*"* || "$allowed_origin" == */ || "$allowed_origin" == *" "* ]]; then
    echo "Allowed parent origins must not contain wildcards, paths, trailing slashes, or spaces." >&2
    exit 2
  fi
done

python3 - "${allowed_origins[@]}" <<'PY_VALIDATE'
import os,sys
from urllib.parse import urlsplit
for value in sys.argv[1:]:
    url=urlsplit(value)
    if url.username or url.password or url.query or url.fragment or url.path or not url.hostname:
        raise SystemExit('Allowed parent must be an exact origin')
    if url.scheme not in ('https','http') or (url.scheme=='http' and url.hostname not in ('localhost','127.0.0.1')):
        raise SystemExit('Parent origin requires HTTPS')
    if os.environ.get('VERCEL_ENV')=='production' and url.scheme!='https':
        raise SystemExit('Production parent origin requires HTTPS')
    if value!=url.scheme+'://'+url.netloc:
        raise SystemExit('Invalid parent origin')
    port=url.port
PY_VALIDATE

if [[ ! -x "$runtime_dir/.venv/bin/python" ]]; then
  uv venv --python 3.12 "$runtime_dir/.venv"
fi
uv sync --frozen --project "$runtime_dir"
"$runtime_dir/.venv/bin/python" -m ensurepip
"$runtime_dir/.venv/bin/python" -m pip download --only-binary=:all: --no-deps -r "$runtime_dir/browser-wheels.txt" -d "$runtime_dir/lite/pypi"

npm --prefix "$runtime_dir/extension" ci
npm --prefix "$runtime_dir/extension" run build

rm -rf "$runtime_dir/lite/extensions/@vfuture/notebook-bridge"
mkdir -p "$runtime_dir/lite/extensions/@vfuture/notebook-bridge"
cp -R "$runtime_dir/extension/labextension/." "$runtime_dir/lite/extensions/@vfuture/notebook-bridge/"

rm -rf "$runtime_dir/dist"
"$runtime_dir/.venv/bin/jupyter" lite build \
  --lite-dir "$runtime_dir/lite" \
  --output-dir "$runtime_dir/dist" \
  --FederatedExtensionAddon.extra_labextensions_path="$runtime_dir/lite/extensions"

python_payload="import json, pathlib, sys; pathlib.Path(sys.argv[1]).write_text(json.dumps({'allowedParentOrigins': sys.argv[2:]}, separators=(',', ':')) + '\\n')"
"$runtime_dir/.venv/bin/python" -c "$python_payload" \
  "$runtime_dir/dist/lab/vfuture-runtime-config.json" "${allowed_origins[@]}"

allowed_origins_space="${allowed_origins[*]}"
csp="default-src 'self' blob: data: https://cdn.jsdelivr.net; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src 'self' blob: data:; connect-src 'self' blob: data: https://cdn.jsdelivr.net; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors $allowed_origins_space; object-src 'none'; base-uri 'self'"
vercel_payload="import json, pathlib, sys; headers=[{'source':'/(.*)','headers':[{'key':'Cross-Origin-Opener-Policy','value':'same-origin'},{'key':'Cross-Origin-Embedder-Policy','value':'require-corp'},{'key':'Cross-Origin-Resource-Policy','value':'cross-origin'},{'key':'Content-Security-Policy','value':sys.argv[2]},{'key':'X-Content-Type-Options','value':'nosniff'},{'key':'Referrer-Policy','value':'no-referrer'}]}]; pathlib.Path(sys.argv[1]).write_text(json.dumps({'version':2,'cleanUrls':True,'trailingSlash':False,'headers':headers}, indent=2) + '\\n')"
"$runtime_dir/.venv/bin/python" -c "$vercel_payload" \
  "$runtime_dir/vercel.json" "$csp"

"$runtime_dir/.venv/bin/python" "$runtime_dir/finalize-build.py"

echo "Built JupyterLite runtime in $runtime_dir/dist for parents $allowed_origins_space"
