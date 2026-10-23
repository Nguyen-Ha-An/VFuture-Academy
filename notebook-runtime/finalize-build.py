"""Merge application policy into generated Lite config and externalize bootstrap JS."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parent
config = json.loads((root / 'lite/jupyter-lite.json').read_text())['jupyter-config-data']

def merge(target, additions):
    for key, value in additions.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge(target[key], value)
        else:
            target[key] = value

path = root / 'dist/jupyter-lite.json'
data = json.loads(path.read_text())
merge(data['jupyter-config-data'], config)
path.write_text(json.dumps(data, indent=2) + '\n')
# Static HTML bootstrap is trusted build output. Make it external so runtime CSP
# does not need unsafe-inline execution to initialize JupyterLite.
for html in (root / 'dist').rglob('*.html'):
    def externalize(match):
        source = match.group(1)
        filename = 'vfuture-bootstrap-' + hashlib.sha256(source.encode()).hexdigest()[:12] + '.js'
        (html.parent / filename).write_text(source)
        return '<script src="' + filename + '"></script>'
    html.write_text(re.sub(r'<script>\s*([\s\S]*?)\s*</script>', externalize, html.read_text()))

content_index = root / "dist/api/contents/all.json"
if not content_index.exists():
    content_index.parent.mkdir(parents=True, exist_ok=True)
    content_index.write_text('{"content":[]}\n')

# Build Output API keeps origin-dependent headers with the prebuilt release.
# Deploy this artifact using `vercel deploy --prebuilt` after linking the runtime project.
import shutil
output = root / '.vercel/output'
if output.exists():
    shutil.rmtree(output)
output.mkdir(parents=True)
shutil.copytree(root / 'dist', output / 'static')
vercel = json.loads((root / 'vercel.json').read_text())
headers = {entry['key']: entry['value'] for entry in vercel['headers'][0]['headers']}
(output / 'config.json').write_text(json.dumps({'version':3,'routes':[{'src':'/(.*)','headers':headers,'continue':True},{'handle':'filesystem'}]},indent=2)+'\n')
