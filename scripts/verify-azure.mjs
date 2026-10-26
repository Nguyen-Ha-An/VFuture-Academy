#!/usr/bin/env node
// Local compilation/syntax gates only: never authenticate or contact Azure resources.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntime } from '../infra/azure/preflight.mjs';

if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Azure verification stays local; GitHub Actions is deployment-only.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'infra/azure');
const bicep = process.env.BICEP_BIN || 'bicep';
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'pipe' });
let version;
try { version = run(bicep, ['--version']).toString('utf8').trim(); }
catch { throw new Error('Install official Bicep CLI 0.48.1 or set BICEP_BIN to its executable. See docs/deployment/azure-small-supabase.md.'); }
if (!/^Bicep CLI version 0\.48\.1(?:\s|$)/.test(version)) throw new Error('Azure verification requires pinned Bicep CLI 0.48.1.');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ['node_modules', '__pycache__'].includes(entry.name) ? [] : files(path);
    return entry.isFile() ? [path] : [];
  });
}
const errors = validateRuntime(JSON.parse(readFileSync(join(source, 'runtime/compose.json'), 'utf8')));
if (errors.length) throw new Error(errors.join('\n'));
const temporary = mkdtempSync(join(tmpdir(), 'academy-bicep-'));
try {
  run(bicep, ['build', join(source, 'main.bicep'), '--outfile', join(temporary, 'main.json')]);
  for (const path of files(source)) {
    if (/\.(?:mjs|cjs)$/.test(path)) run(process.execPath, ['--check', path]);
    else if (path.endsWith('.sh')) run('bash', ['-n', path]);
    else if (path.endsWith('.py')) run('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), filename=sys.argv[1])', path]);
    else if (path.endsWith('.json')) JSON.parse(readFileSync(path, 'utf8'));
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
console.log('Azure local gates passed: pinned Bicep compile, runtime constraints, Node/Bash/Python syntax and JSON parsing. No Azure resources or credentials accessed.');
