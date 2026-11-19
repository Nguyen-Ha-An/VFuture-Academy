import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
export function cleanSource(value) {
  return value && Object.keys(value).length === 3 && value.sourceClean === true
    && /^[a-f0-9]{40}$/.test(value.sourceCommit ?? '') && /^[a-f0-9]{40}$/.test(value.sourceTree ?? '');
}
function members(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    const path = join(folder, entry.name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return members(path, name + '/');
    if (!stat.isFile()) throw new Error('Unsupported forward archive member');
    return [name];
  }).sort();
}

// Content is stable across plan and apply packages. The exact reviewed plan
// bytes have a separate digest so adding them never changes the reviewed source.
export function createBoundedManifest(release, { root = process.cwd(), source, evidence, reviewedPlan } = {}) {
  if (!cleanSource(source)) throw new Error('Clean committed forward source required');
  release.validateEvidence(evidence);
  const sourcePaths = release.sourceFiles();
  const vendor = members(root).filter(path => path.startsWith('node_modules/'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = {};
  for (const path of vendor.filter(path => /^node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(path))) {
    const pkg = JSON.parse(readFileSync(join(root, path), 'utf8'));
    const name = path.slice('node_modules/'.length, -'/package.json'.length);
    if (pkg.name !== name || lock.packages?.[`node_modules/${name}`]?.version !== pkg.version) {
      throw new Error('Unlocked forward runtime dependency');
    }
    dependencies[name] = pkg.version;
  }
  if (!dependencies.pg) throw new Error('Locked pg closure required');
  const files = [...sourcePaths, ...vendor].sort().map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  const basis = { kind: release.kind, source, ...release.metadata(evidence),
    evidenceSha256: sha256(readFileSync(join(root, release.evidencePath))), dependencies, files };
  const contentSha256 = sha256(canonical(basis));
  if (!reviewedPlan) return { ...basis, contentSha256 };
  release.validatePlan(reviewedPlan, evidence, source);
  if (reviewedPlan.packageContentSha256 !== contentSha256) throw new Error('Reviewed forward content changed');
  return { ...basis, contentSha256, reviewedPlanSha256: sha256(readFileSync(join(root, release.planPath))) };
}

export function verifyBoundedArtifact(release, root = process.cwd()) {
  root = resolve(root);
  const read = (path, limit) => {
    const bytes = readFileSync(join(root, path));
    if (bytes.length > limit) throw new Error('Oversized forward metadata');
    return bytes;
  };
  const bytes = read(release.manifestPath, 4 * 1024 * 1024);
  const manifest = JSON.parse(bytes);
  const evidence = release.validateEvidence(JSON.parse(read(release.evidencePath, 65536)));
  const plan = manifest.reviewedPlanSha256 ? JSON.parse(read(release.planPath, 65536)) : undefined;
  const metadata = [release.evidencePath, release.manifestPath, ...(plan ? [release.planPath] : [])];
  const actual = members(root);
  const allowed = new Set([...release.sourceFiles(), ...metadata]);
  if (actual.some(path => !allowed.has(path) && !/^node_modules\/(?:@[^/]+\/)?[^/]+\/.+/.test(path))) {
    throw new Error('Unexpected forward archive member');
  }
  // Reconstruct the exact allowlisted inventory from actual bytes, independently
  // of the paths and digests claimed by the untrusted manifest.
  const rebuilt = createBoundedManifest(release, { root, source: manifest.source, evidence, reviewedPlan: plan });
  if (canonical(rebuilt) !== canonical(manifest)) throw new Error('Forward archive manifest mismatch');
  return { ...manifest, manifestSha256: sha256(bytes) };
}
