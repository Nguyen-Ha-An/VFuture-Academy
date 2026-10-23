/**
 * Read-only, offline compatibility audit for exported content JSON.
 *
 * Answers one question about content that already exists: would it still be **saved** today,
 * and are its regex answer keys still gradeable on the bounded engine? It runs the shared
 * strict parser, the shared workspace assessment under the save contract, and the shared
 * safe-regex adapter, so its verdict is the one the editor and the server reach — a missing
 * document, an orphan document or an unrenderable block is incompatible here, not a warning.
 *
 * It never writes, repairs, migrates or renames anything, and it never opens a database,
 * reads environment variables or makes a network call. External references are checked only
 * when the caller supplies them with --refs or --fixtures; otherwise they are reported as
 * unverified and the run exits 3, because an unchecked reference is not a clean bill of health.
 *
 * usage: tsx scripts/audit-json-compatibility.ts <dir|file.json> [--json] [--refs refs.json]
 *        [--fixtures] [--recursive] [--lang vi|en]
 *
 * exit: 0 fully checked and compatible · 1 incompatible · 2 bad input
 *       3 compatible so far, but reference verification was incomplete
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import {
  MAX_DOCUMENT_BYTES,
  assessWorkspace,
  checkStandaloneRendererSupport,
  documentSizeDiagnostics,
  parseJsonDocument,
  parseJsonEnvelope,
  utf8ByteLength,
  validateStandaloneDocument,
  validateWorkspace,
} from '../src/content-engine/validate';
import { InMemoryResolver, ResolverUnavailableError, type ReferenceResolver } from '../src/content-engine/validate/semantic/refs';
import { fixtureResolver } from '../src/content-engine/fixtures/resolver';
import { itemRef, makeDiagnostic, type Diagnostic } from '../src/content-engine/diagnostics';
import { inspectSafeRegexPatterns, type SafeRegexRejectReason } from '../src/content-engine/grading/safe-regex';
import { loadWorkspaceFromPath } from './lib/load-workspace';

type Shape = 'course' | 'workspace-envelope' | 'standalone' | 'unreadable';
type Verdict = 'OK' | 'UNVERIFIED' | 'INCOMPATIBLE';

interface Finding { file: string; docId: string; path: string; code: string; severity: string; message: string; meta?: Record<string, string | number> }
interface RegexFinding { file: string; docId: string; path: string; pattern: string; reason: SafeRegexRejectReason; detail: string; caseSensitive: boolean }
interface UnverifiedReference { file: string; docId: string; path: string; operation: string }

interface AuditReport {
  target: string;
  verdict: Verdict;
  documents: { file: string; shape: Shape }[];
  findings: Finding[];
  regex: RegexFinding[];
  references: { mode: 'unverified' | 'resolved'; unverified: UnverifiedReference[] };
  summary: { files: number; findings: number; errors: number; warnings: number; regexUnsupported: number; referencesUnverified: number };
}

/** Raised for anything that makes the request itself unanswerable; reported as one line. */
class InputError extends Error {}

/** A rejection the safe-regex section already reports; kept out of the contract findings. */
const REGEX_REASONS = new Set<string>(['unsupported_syntax', 'pattern_too_long', 'too_many_patterns']);

const pointerSegment = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function shapeOf(value: unknown): Shape {
  const o = asRecord(value);
  if (!o) return 'standalone';
  if (asRecord(o.manifest) && asRecord(o.items)) return 'workspace-envelope';
  return o.kind === 'course' ? 'course' : 'standalone';
}

/**
 * The documents inside one file, so a finding is attributed to the document that owns it
 * rather than to the envelope that happens to carry it.
 */
function attributedDocuments(value: unknown, fallbackId: string): { docId: string; basePath: string; value: unknown }[] {
  const o = asRecord(value);
  if (o && shapeOf(value) === 'workspace-envelope') {
    const manifest = asRecord(o.manifest)!;
    const items = asRecord(o.items)!;
    return [
      { docId: typeof manifest.id === 'string' ? manifest.id : 'course', basePath: '/manifest', value: manifest },
      ...Object.entries(items).map(([id, doc]) => ({ docId: id, basePath: `/items/${pointerSegment(id)}`, value: doc })),
    ];
  }
  return [{ docId: o && typeof o.id === 'string' ? o.id : fallbackId, basePath: '', value }];
}

interface RegexSite { path: string; patterns: string[]; caseSensitive: boolean }

/**
 * Finds regex answer keys structurally, without requiring the document to still be schema
 * valid: content too broken to validate is exactly the content whose regexes need auditing.
 */
function collectRegexSites(value: unknown, path: string, out: RegexSite[]): void {
  if (Array.isArray(value)) { value.forEach((v, i) => collectRegexSites(v, `${path}/${i}`, out)); return; }
  const o = asRecord(value);
  if (!o) return;
  if (o.matchMode === 'regex' && Array.isArray(o.correctAnswer) && o.correctAnswer.every((p) => typeof p === 'string')) {
    out.push({ path: `${path}/correctAnswer`, patterns: o.correctAnswer as string[], caseSensitive: asRecord(o.settings)?.caseSensitive === true });
  }
  for (const [key, child] of Object.entries(o)) collectRegexSites(child, `${path}/${pointerSegment(key)}`, out);
}

const toFinding = (file: string, d: Diagnostic, locale: 'vi' | 'en'): Finding => ({
  file, docId: d.docId, path: d.path, code: d.code, severity: d.severity, message: d.message[locale], ...(d.meta ? { meta: d.meta } : {}),
});

/** Offline: every lookup is honestly unavailable, so nothing is claimed resolved or missing. */
class UnavailableResolver implements ReferenceResolver {
  private fail(operation: string): never { throw new ResolverUnavailableError(operation); }
  async bankQuestion(): Promise<never> { this.fail('bankQuestion'); }
  async bankCandidates(): Promise<never> { this.fail('bankCandidates'); }
  async asset(): Promise<never> { this.fail('asset'); }
  async resourceExists(): Promise<never> { this.fail('resourceExists'); }
  async opportunityExists(): Promise<never> { this.fail('opportunityExists'); }
  async branchExists(): Promise<never> { this.fail('branchExists'); }
}

const jsonFilesIn = (dir: string, recursive: boolean): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (recursive) out.push(...jsonFilesIn(full, true)); continue; }
    if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
};

interface Plan { files: string[]; workspaceRoot?: string }

function planTarget(target: string, recursive: boolean): Plan {
  if (!statSync(target).isDirectory()) return { files: [target] };
  if (existsSync(join(target, 'course.json'))) {
    const items = existsSync(join(target, 'items')) ? jsonFilesIn(join(target, 'items'), recursive) : [];
    return { files: [join(target, 'course.json'), ...items], workspaceRoot: target };
  }
  const files = jsonFilesIn(target, recursive);
  if (files.length === 0) throw new InputError(`no JSON documents found in ${target}${recursive ? '' : ' (try --recursive)'}`);
  return { files };
}

/**
 * A workspace backup legitimately exceeds one document's budget, so it gets the envelope
 * allowance; a single content document does not. Documents inside a course directory are
 * content documents and are parsed with the document budget directly.
 */
function parseFile(file: string, contentDocumentOnly: boolean) {
  const text = readFileSync(file, 'utf8');
  const ref = basename(file, '.json');
  if (contentDocumentOnly) return parseJsonDocument(text, ref, { rootType: 'any' });
  const parsed = parseJsonEnvelope(text, ref, { rootType: 'any' });
  if (parsed.errors.length || shapeOf(parsed.value) === 'workspace-envelope' || shapeOf(parsed.value) === 'course') return parsed;
  const bytes = utf8ByteLength(text);
  if (bytes <= MAX_DOCUMENT_BYTES) return parsed;
  return { ...parsed, value: undefined, errors: [makeDiagnostic('E_LIMIT_EXCEEDED', { ref: parsed.ref, path: '', meta: { limit: 'bytes', received: bytes, expected: MAX_DOCUMENT_BYTES } })] };
}

async function audit(target: string, opts: { recursive: boolean; locale: 'vi' | 'en'; resolver: ReferenceResolver; offline: boolean }): Promise<AuditReport> {
  const plan = planTarget(target, opts.recursive);
  const root = statSync(target).isDirectory() ? target : undefined;
  const label = (file: string) => (root ? relative(root, file).split(sep).join('/') : basename(file));

  const documents: AuditReport['documents'] = [];
  const findings: Finding[] = [];
  const regex: RegexFinding[] = [];
  const unverified: UnverifiedReference[] = [];
  const parsedByFile = new Map<string, unknown>();

  // Which file each document came from, so a workspace finding points at the item that
  // owns it rather than at the manifest that happens to declare it.
  const fileByDocId = new Map<string, string>();
  const seen = new Set<string>();

  const collect = (fallbackFile: string, diagnostics: Diagnostic[]) => {
    for (const d of diagnostics) {
      const name = fileByDocId.get(d.docId) ?? fallbackFile;
      if (d.code === 'E_REFERENCE_LOOKUP_FAILED' && opts.offline) {
        unverified.push({ file: name, docId: d.docId, path: d.path, operation: String(d.meta?.operation ?? 'reference') });
        continue;
      }
      // Regex rejections are reported once, in the regex section.
      if (d.code === 'E_ANSWER_SHAPE' && REGEX_REASONS.has(String(d.meta?.reason ?? ''))) continue;
      // Two passes can reach the same problem; a report says it once.
      const key = `${name}|${d.docId}|${d.path}|${d.code}|${d.severity}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(toFinding(name, d, opts.locale));
    }
  };

  // Pass 1: strict parse, then a structural regex sweep per attributed document.
  for (const file of plan.files) {
    const name = label(file);
    const parsed = parseFile(file, plan.workspaceRoot !== undefined);
    if (parsed.errors.length) {
      documents.push({ file: name, shape: 'unreadable' });
      collect(name, parsed.errors);
      continue;
    }
    documents.push({ file: name, shape: shapeOf(parsed.value) });
    parsedByFile.set(file, parsed.value);
    for (const doc of attributedDocuments(parsed.value, basename(file, '.json'))) {
      if (!fileByDocId.has(doc.docId)) fileByDocId.set(doc.docId, name);
      const sites: RegexSite[] = [];
      collectRegexSites(doc.value, '', sites);
      for (const site of sites) {
        for (const r of inspectSafeRegexPatterns(site.patterns, { caseSensitive: site.caseSensitive })) {
          regex.push({ file: name, docId: doc.docId, path: r.index < 0 ? site.path : `${site.path}/${r.index}`, pattern: r.pattern, reason: r.reason, detail: r.detail, caseSensitive: site.caseSensitive });
        }
      }
    }
  }

  // Pass 2: the shared contract pipeline under the save contract. A course workspace is
  // assessed as a whole; every other document is assessed on its own terms.
  const auditWorkspace = async (name: string, path: string) => {
    const ws = loadWorkspaceFromPath(path);
    const report = await validateWorkspace(ws, opts.resolver, { save: true });
    collect(name, [...report.errors, ...report.warnings, ...documentSizeDiagnostics(ws.manifest, ws.items)]);
    // `checkRendererSupport` covers a workspace item's own blocks and question players, but
    // not the prose an activity or a question carries — a reserved block inside a quiz intro
    // or a question stem would otherwise pass. Duplicates collapse in `collect`.
    const assessed = assessWorkspace(ws, { requireComplete: true }).parsed;
    if (assessed) for (const [id, item] of Object.entries(assessed.items)) collect(name, checkStandaloneRendererSupport(item, itemRef(id)));
  };

  if (plan.workspaceRoot) {
    await auditWorkspace(label(join(plan.workspaceRoot, 'course.json')), plan.workspaceRoot);
  } else {
    for (const file of plan.files) {
      if (!parsedByFile.has(file)) continue;
      const name = label(file);
      const value = parsedByFile.get(file);
      const shape = shapeOf(value);
      if (shape === 'workspace-envelope' || shape === 'course') { await auditWorkspace(name, file); continue; }
      const docId = asRecord(value)?.id;
      const result = await validateStandaloneDocument(value, itemRef(typeof docId === 'string' ? docId : basename(file, '.json')), opts.resolver);
      collect(name, [...result.report.errors, ...result.report.warnings]);
    }
  }

  const order = (a: { file: string; docId: string; path: string }, b: { file: string; docId: string; path: string }) =>
    a.file.localeCompare(b.file) || a.docId.localeCompare(b.docId) || a.path.localeCompare(b.path);
  findings.sort((a, b) => order(a, b) || a.code.localeCompare(b.code));
  regex.sort(order);
  unverified.sort(order);

  const errors = findings.filter((f) => f.severity === 'error').length;
  const verdict: Verdict = errors > 0 || regex.length > 0 ? 'INCOMPATIBLE' : opts.offline && unverified.length > 0 ? 'UNVERIFIED' : 'OK';
  return {
    target,
    verdict,
    documents,
    findings,
    regex,
    references: { mode: opts.offline ? 'unverified' : 'resolved', unverified },
    summary: {
      files: plan.files.length,
      findings: findings.length,
      errors,
      warnings: findings.length - errors,
      regexUnsupported: regex.length,
      referencesUnverified: unverified.length,
    },
  };
}

const USAGE = 'usage: tsx scripts/audit-json-compatibility.ts <dir|file.json> [--json] [--refs refs.json] [--fixtures] [--recursive] [--lang vi|en]';
const EXIT = { compatible: 0, incompatible: 1, badInput: 2, unverified: 3 } as const;

function printText(report: AuditReport): void {
  for (const r of report.regex) {
    console.log(`unsupported regex  ${r.file} ${r.docId} ${r.path}: ${r.reason} — ${r.detail}${r.pattern ? ` · /${r.pattern}/` : ''}`);
  }
  for (const f of report.findings) console.log(`${f.severity} ${f.code} ${f.file} ${f.docId} ${f.path}: ${f.message}`);
  for (const u of report.references.unverified) console.log(`unverified ref     ${u.file} ${u.docId} ${u.path}: ${u.operation} not checked (pass --refs or --fixtures)`);
  const s = report.summary;
  console.log(`\n${report.verdict} — ${s.files} files · ${s.errors} errors, ${s.warnings} warnings · ${s.regexUnsupported} unsupported regex · ${s.referencesUnverified} references ${report.references.mode === 'resolved' ? 'checked against supplied data' : 'unverified'}`);
  if (report.references.mode === 'unverified' && s.referencesUnverified > 0) {
    console.log('External references were not checked. Supply --refs <file> or --fixtures to verify them; this run cannot say whether they exist.');
  }
}

/** The refs file is input like any other: strictly parsed, never trusted to JSON.parse. */
function resolverFrom(refs: string | undefined, fixtures: boolean): { resolver: ReferenceResolver; offline: boolean } {
  if (refs) {
    if (!existsSync(refs)) throw new InputError(`not found: ${refs}`);
    if (statSync(refs).isDirectory()) throw new InputError(`--refs must be a file, not a directory: ${refs}`);
    const parsed = parseJsonEnvelope(readFileSync(refs, 'utf8'), 'refs');
    if (parsed.errors.length) throw new InputError(`invalid --refs file ${refs}: ${parsed.errors[0].message.en}`);
    return { resolver: new InMemoryResolver(parsed.value as ConstructorParameters<typeof InMemoryResolver>[0]), offline: false };
  }
  if (fixtures) return { resolver: fixtureResolver, offline: false };
  return { resolver: new UnavailableResolver(), offline: true };
}

async function main(): Promise<void> {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { json: { type: 'boolean', default: false }, refs: { type: 'string' }, fixtures: { type: 'boolean', default: false }, recursive: { type: 'boolean', default: false }, lang: { type: 'string', default: 'en' } },
    });
    const target = positionals[0];
    if (!target) throw new InputError(USAGE);
    if (values.lang !== 'vi' && values.lang !== 'en') throw new InputError(`unsupported locale: ${values.lang}`);
    if (!existsSync(target)) throw new InputError(`not found: ${target}`);

    const { resolver, offline } = resolverFrom(values.refs, values.fixtures);
    const report = await audit(target, { recursive: values.recursive, locale: values.lang, resolver, offline });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else printText(report);
    process.exitCode = report.verdict === 'INCOMPATIBLE' ? EXIT.incompatible : report.verdict === 'UNVERIFIED' ? EXIT.unverified : EXIT.compatible;
  } catch (error) {
    // One line, never a stack: a bad request is not an internal failure.
    console.error(error instanceof InputError ? error.message : `audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = EXIT.badInput;
  }
}

void main();
