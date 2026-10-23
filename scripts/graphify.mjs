#!/usr/bin/env node
// Local-only, offline Graphify coverage and freshness gate. See docs/architecture/Graphify-policy.md.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat, mkdtemp, rm, rename, statfs, realpath, open, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '0.9.91';
const MANIFEST = 'docs/architecture/graphify-manifest.json';
const GRAPH = 'graphify-out/graph.json';
const RECEIPT = 'graphify-out/receipt.json';
const POLICY = 'whole-owned-text-v1';
const MAX_FILES = 15000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 96 * 1024 * 1024;
const MAX_GRAPH_BYTES = 128 * 1024 * 1024;
const REQUIRED_FREE_BYTES = 512 * 1024 * 1024;
const MAX_TEMP_BYTES = 384 * 1024 * 1024;
const LIMITATIONS = [
  'File nodes prove file coverage only; unsupported docs/config/SQL formats have no semantic relation extraction.',
  'AST relations are the pinned extractor output, including its own labeled static inferences; no runtime, authorization, database or call-contract completeness is implied.',
  'External-module stub nodes identify imports, not owned code. No semantic APIs, clustering, HTML or remote services are used.',
];
const BUILTIN_IGNORES = [
  '**/.git/**', '**/node_modules/**', '**/vendor/**', '**/.next/**', '**/graphify-out/**',
  '**/.env*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/secrets/**',
  '**/credentials/**', '**/*credentials*.json', '**/*service-account*.json',
  '**/secrets.*', '**/*.secret.*', '**/id_rsa', '**/id_ed25519', '**/.aws/**', '**/.ssh/**', '**/.kube/**',
  '**/playwright/.auth/**', '**/.worktrees/**', '**/.vercel/**', '**/.venv/**',
  MANIFEST,
];
const sha = (data) => createHash('sha256').update(data).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map((k) => [k, stable(value[k])]));
  return value;
}
const json = (value) => `${JSON.stringify(stable(value))}\n`;
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000,
    ...options,
  });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    try {
      bytes += entry.isDirectory() ? await directoryBytes(location) : (await lstat(location)).size;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes > MAX_TEMP_BYTES) return bytes;
  }
  return bytes;
}
async function extract(args, temporary, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('graphify', args, { cwd: temporary, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', failure, monitoring = false;
    const stop = (message) => {
      failure ??= new Error(message);
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* The process may have already exited. */ }
    };
    const capture = (chunk) => {
      log += chunk.toString('utf8');
      if (Buffer.byteLength(log) > 8 * 1024 * 1024) stop('Graphify log exceeds 8 MiB budget.');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timeout = setTimeout(() => stop('Graphify exceeded ten-minute extraction timeout.'), 10 * 60 * 1000);
    const monitor = setInterval(async () => {
      if (monitoring) return;
      monitoring = true;
      try {
        if (await directoryBytes(temporary) > MAX_TEMP_BYTES) stop('Graphify temporary files exceed 384 MiB budget.');
        const disk = await statfs(temporary);
        if (Number(disk.bavail) * Number(disk.bsize) < 128 * 1024 * 1024) stop('Graphify stopped: temporary storage has less than 128 MiB free.');
      } catch (error) { stop(`Graphify disk monitor failed: ${error.message}`); }
      finally { monitoring = false; }
    }, 250);
    const cleanup = () => { clearTimeout(timeout); clearInterval(monitor); };
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Graphify extraction exited ${code}: ${log.slice(-4000)}`));
      else resolve(log);
    });
  });
}
function glob(pattern) {
  // Repository-relative globs only: * is one segment; ** crosses directories.
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { out += '(?:.*/)?'; i++; }
      else out += '.*';
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[\\^$+?.()|{}[\]]/g, '\\$&');
  }
  return new RegExp(`${out}$`);
}
async function inventory() {
  const ignoreText = await readFile(path.join(ROOT, '.graphifyignore'), 'utf8');
  const patterns = ignoreText.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (patterns.some((p) => p.startsWith('!') || p.startsWith('/') || p.includes('..'))) throw new Error('.graphifyignore requires positive repository-relative globs without ..');
  const ignored = [...BUILTIN_IGNORES, ...patterns].map(glob);
  const candidates = [...new Set(command('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort(compare);
  const files = {};
  let bytes = 0, count = 0;
  for (const relative of candidates) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error(`Unsafe Git path: ${relative}`);
    if (ignored.some((rule) => rule.test(relative))) continue;
    const absolute = path.join(ROOT, relative);
    let info;
    try { info = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Owned file symlinks are not indexed; replace or explicitly exclude: ${relative}`);
    if (!info.isFile()) continue;
    // Read a bounded prefix first: large binary assets are excluded without loading them.
    const handle = await open(absolute, 'r');
    let prefix;
    try { prefix = Buffer.alloc(Math.min(info.size, 8192)); await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
    if (prefix.includes(0)) continue;
    try { new TextDecoder('utf-8', { fatal: true }).decode(prefix, { stream: info.size > prefix.length }); } catch { continue; }
    if (info.size > MAX_FILE_BYTES) throw new Error(`Text file exceeds ${MAX_FILE_BYTES} bytes; review its ownership/exclusion: ${relative}`);
    const data = await readFile(absolute);
    if (data.includes(0)) continue;
    try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { continue; }
    files[relative] = sha(data);
    bytes += data.length;
    if (++count > MAX_FILES || bytes > MAX_SOURCE_BYTES) throw new Error('Owned text corpus exceeds bounded Graphify budget; review policy deliberately.');
  }
  if (!Object.keys(files).length) throw new Error('No eligible owned text files found.');
  return { files, bytes, sourceDigest: sha(json(files)) };
}
async function boundedJson(relative, maximum = MAX_GRAPH_BYTES) {
  const location = path.join(ROOT, relative);
  const info = await lstat(location);
  if (!info.isFile() || info.size > maximum) throw new Error(`Invalid or oversized artifact: ${relative}`);
  return JSON.parse(await readFile(location, 'utf8'));
}
const IMPORT_RELATIONS = new Set(['imports', 'imports_from', 're_exports', 'dynamic_import']);
function isExternalModuleStub(node, files, graph) {
  // Graphify's rescued dynamic-import pass explicitly emits type=module with the
  // bare package name in source_file. Relative/alias/owned paths never qualify.
  const specifier = node.source_file;
  return typeof specifier === 'string' && !Object.hasOwn(files, specifier)
    && /^(?:@[A-Za-z0-9_~.-]+\/)?[A-Za-z0-9_~][A-Za-z0-9_~.:-]*$/.test(specifier)
    && node.type === 'module' && node.label === specifier
    && node.file_type === 'code' && node.confidence === 'EXTRACTED' && node._origin === 'ast'
    && graph.edges.some((edge) => edge.target === node.id && IMPORT_RELATIONS.has(edge.relation) && Object.hasOwn(files, edge.source_file));
}
function normalizeExternalModuleSources(graph, files) {
  for (const node of graph.nodes) {
    if (node.source_file && !Object.hasOwn(files, node.source_file) && isExternalModuleStub(node, files, graph)) {
      node.external_module = node.source_file;
      node.external_module_provenance = 'graphify-ast-dynamic-import-stub';
      node.external = true;
      node.source_file = '';
    }
  }
}
function validateGraph(graph, files) {
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.hyperedges)) throw new Error('Graph must contain nodes, edges and hyperedges arrays.');
  const ids = new Set();
  const coverage = new Set();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) throw new Error(`Invalid or duplicate graph node: ${node.id}`);
    ids.add(node.id);
    if (node.external_module !== undefined && (node.source_file !== '' || node.external !== true || node.external_module_provenance !== 'graphify-ast-dynamic-import-stub' || !isExternalModuleStub({ ...node, source_file: node.external_module }, files, graph))) throw new Error(`Invalid external module provenance: ${node.id}`);
    if (node.type === 'owned_file' && node.id === `owned-file:${node.source_file}`) {
      if (node.sha256 !== files[node.source_file]) throw new Error(`File-node hash mismatch: ${node.source_file}`);
      coverage.add(node.source_file);
    }
    if (node.source_file && !Object.hasOwn(files, node.source_file)) throw new Error(`Graph node source outside owned corpus: ${node.source_file}`);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Dangling graph edge: ${edge.source} -> ${edge.target}`);
    if (edge.source_file && !Object.hasOwn(files, edge.source_file)) throw new Error(`Graph edge source outside owned corpus: ${edge.source_file}`);
  }
  for (const edge of graph.hyperedges) {
    const members = edge.nodes ?? edge.members;
    if (!Array.isArray(members) || members.some((id) => !ids.has(id))) throw new Error('Invalid hyperedge endpoints.');
  }
  for (const file of Object.keys(files)) if (!coverage.has(file)) throw new Error(`Graph lacks file coverage: ${file}`);
  if (coverage.size !== Object.keys(files).length) throw new Error('Graph contains unexpected owned file nodes.');
}
async function atomicWrite(relative, data) {
  const location = path.join(ROOT, relative);
  await mkdir(path.dirname(location), { recursive: true });
  const temporary = `${location}.${process.pid}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, location); }
  finally { await rm(temporary, { force: true }); }
}
async function check() {
  const current = await inventory();
  let manifest;
  try { manifest = await boundedJson(MANIFEST, 4 * 1024 * 1024); }
  catch { throw new Error('Graphify manifest missing/invalid. Run npm run graphify:refresh locally.'); }
  if (manifest.schema !== 1 || manifest.policy !== POLICY || manifest.graphifyVersion !== VERSION) throw new Error('Graphify manifest policy/version mismatch; refresh required.');
  if (json(current.files) !== json(manifest.files) || current.sourceDigest !== manifest.sourceDigest) {
    const previous = manifest.files ?? {};
    const changed = Object.keys(current.files).filter((file) => previous[file] !== current.files[file]);
    const deleted = Object.keys(previous).filter((file) => !Object.hasOwn(current.files, file));
    throw new Error(`Graphify source is stale; changed/new: ${changed.slice(0, 12).join(', ') || 'none'}; deleted/excluded: ${deleted.slice(0, 12).join(', ') || 'none'}. Run npm run graphify:refresh.`);
  }
  let graph, receipt;
  try { graph = await boundedJson(GRAPH); receipt = await boundedJson(RECEIPT, 1024 * 1024); }
  catch { throw new Error('Local graph/receipt missing or invalid (expected on a clean clone). Run npm run graphify:refresh before verify:local.'); }
  const graphDigest = sha(await readFile(path.join(ROOT, GRAPH)));
  if (graphDigest !== manifest.graph.sha256 || receipt.graphDigest !== graphDigest || receipt.sourceDigest !== current.sourceDigest) throw new Error('Graph/manifest/receipt digest mismatch; refresh required.');
  validateGraph(graph, current.files);
  if (manifest.graph.nodes !== graph.nodes.length || manifest.graph.edges !== graph.edges.length || manifest.graph.hyperedges !== graph.hyperedges.length) throw new Error('Graph counts disagree with manifest.');
  const astSources = new Set(graph.nodes.filter((node) => node.type !== 'owned_file' && node.source_file).map((node) => node.source_file));
  const coverage = { ownedTextFiles: Object.keys(current.files).length, filesWithAstNodes: astSources.size, fileOnly: Object.keys(current.files).length - astSources.size };
  if (json(manifest.coverage) !== json(coverage)) throw new Error('Graph coverage counts disagree with manifest.');
  console.log(`Graphify check passed: ${Object.keys(current.files).length} owned text files, ${graph.nodes.length} nodes, ${graph.edges.length} edges; source and graph SHA-256 verified.`);
}
async function refresh() {
  const version = command('graphify', ['--version'], { env: { ...process.env, GRAPHIFY_NO_AUTO_REFRESH: '1' } }).trim();
  if (version !== `graphify ${VERSION}`) throw new Error(`Require graphify ${VERSION}; found ${version}. Install explicitly with uv tool install graphifyy==${VERSION}.`);
  const current = await inventory();
  const disk = await statfs(ROOT);
  const temporaryDisk = await statfs(tmpdir());
  if (Number(disk.bavail) * Number(disk.bsize) < REQUIRED_FREE_BYTES || Number(temporaryDisk.bavail) * Number(temporaryDisk.bsize) < REQUIRED_FREE_BYTES) throw new Error('Graphify refresh requires at least 512 MiB free in repository and temporary storage.');
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'vfuture-graphify-')));
  try {
    const snapshot = path.join(temporary, 'source');
    const output = path.join(temporary, 'output');
    await mkdir(snapshot);
    for (const [relative, expected] of Object.entries(current.files)) {
      const data = await readFile(path.join(ROOT, relative));
      if (sha(data) !== expected) throw new Error(`Source changed during snapshot: ${relative}`);
      await mkdir(path.dirname(path.join(snapshot, relative)), { recursive: true });
      await writeFile(path.join(snapshot, relative), data);
    }
    // Fresh isolated output prevents Graphify's merge behavior from retaining stale semantic nodes.
    // Only this allowlisted environment reaches the AST process; credentials are not inherited.
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'LANG', 'LC_ALL', 'UV_CACHE_DIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { GRAPHIFY_NO_AUTO_REFRESH: '1', GRAPHIFY_MAX_WORKERS: '2', PYTHONDONTWRITEBYTECODE: '1', GRAPHIFY_MAX_GRAPH_BYTES: String(MAX_GRAPH_BYTES) });
    console.log(`Graphify ${VERSION}: AST-only refresh of ${Object.keys(current.files).length} text files (${current.bytes} bytes), max-workers=2.`);
    const log = await extract(['extract', snapshot, '--code-only', '--no-cluster', '--max-workers', '2', '--out', output], temporary, env);
    const graphPath = path.join(output, 'graphify-out', 'graph.json');
    if ((await lstat(graphPath)).size > MAX_GRAPH_BYTES) throw new Error('Graph exceeds 128 MiB output budget.');
    const raw = JSON.parse(await readFile(graphPath, 'utf8'));
    // Absolute snapshot prefixes can occur in IDs/source locations; remove them deterministically.
    const normalize = (value) => {
      if (typeof value === 'string') return value.split(`${snapshot}/`).join('');
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
      return value;
    };
    const graph = normalize(raw);
    graph.hyperedges ??= [];
    normalizeExternalModuleSources(graph, current.files);
    if (graph.input_tokens || graph.output_tokens) throw new Error('Unexpected semantic token use in AST-only extraction.');
    for (const [relative, digest] of Object.entries(current.files)) {
      graph.nodes.push({ id: `owned-file:${relative}`, label: relative, type: 'owned_file', source_file: relative, sha256: digest, provenance: 'git-owned-text-inventory' });
    }
    graph.nodes.sort((a, b) => compare(a.id, b.id));
    graph.edges.sort((a, b) => compare(json(a), json(b)));
    graph.hyperedges.sort((a, b) => compare(json(a), json(b)));
    validateGraph(graph, current.files);
    const after = await inventory();
    if (current.sourceDigest !== after.sourceDigest) throw new Error('Sources changed during extraction; rerun refresh after edits finish.');
    const graphData = json(graph);
    if (Buffer.byteLength(graphData) > MAX_GRAPH_BYTES) throw new Error('Normalized graph exceeds 128 MiB output budget.');
    const graphDigest = sha(graphData);
    const astSources = new Set(graph.nodes.filter((node) => node.type !== 'owned_file' && node.source_file).map((node) => node.source_file));
    const manifest = {
      schema: 1, policy: POLICY, graphifyVersion: VERSION,
      extraction: { mode: 'AST-only', maxWorkers: 2, inputTokens: 0, outputTokens: 0 },
      sourceDigest: current.sourceDigest, files: current.files,
      graph: { path: GRAPH, sha256: graphDigest, nodes: graph.nodes.length, edges: graph.edges.length, hyperedges: graph.hyperedges.length },
      coverage: { ownedTextFiles: Object.keys(current.files).length, filesWithAstNodes: astSources.size, fileOnly: Object.keys(current.files).length - astSources.size },
      limitations: LIMITATIONS,
    };
    await atomicWrite(GRAPH, graphData);
    await atomicWrite(RECEIPT, json({ schema: 1, sourceDigest: current.sourceDigest, graphDigest, graphifyVersion: VERSION }));
    // Written last: an interrupted refresh can never make a mismatched graph pass check.
    await atomicWrite(MANIFEST, json(manifest));
    console.log(log.trim().split('\n').slice(-4).join('\n'));
    await check();
    console.log(`AST node coverage: ${astSources.size} files; file-only coverage: ${manifest.coverage.fileOnly}. Semantic API tokens: 0. See docs/architecture/Graphify-policy.md for relation limits.`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
if (process.env.GITHUB_ACTIONS === 'true') {
  console.error('Graphify is a mandatory local gate; GitHub Actions remains deployment-only.');
  process.exitCode = 1;
} else {
  const mode = process.argv[2];
  if (!['refresh', 'check'].includes(mode) || process.argv.length !== 3) {
    console.error('Usage: node scripts/graphify.mjs <refresh|check>');
    process.exitCode = 1;
  } else {
    try { await (mode === 'refresh' ? refresh() : check()); }
    catch (error) { console.error(`Graphify ${mode} failed: ${error.message}`); process.exitCode = 1; }
  }
}
