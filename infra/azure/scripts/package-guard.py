#!/usr/bin/env python3
"""Create an allowlisted source-only Function package, with no credentials or runtime state."""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1] / 'cost-guard'
files = ['host.json', 'package.json', 'policy.cjs', 'accounting.cjs', 'runner.cjs', 'azure-client.cjs', 'timer/index.cjs', 'timer/function.json']
if len(sys.argv) != 2:
    raise SystemExit('Usage: package-guard.py /absolute/output/cost-guard.zip')
output = Path(sys.argv[1])
if not output.is_absolute() or output.exists():
    raise SystemExit('Choose a new absolute output file outside the source tree')
if output.resolve().is_relative_to(root.parents[2]):
    raise SystemExit('Package output must be outside the repository')
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for relative in files:
        archive.write(root / relative, relative)
print('Created allowlisted Function package. No runtime settings included.')
