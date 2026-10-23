import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(__dirname, '../..');
const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const script = 'scripts/audit-json-compatibility.ts';
const fixtures = join(repoRoot, 'src', 'content-engine', 'fixtures');

const run = (args: string[]) => spawnSync(process.execPath, [tsx, script, ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });

interface Finding { file: string; docId: string; path: string; code: string; severity: string; message: string; meta?: Record<string, string | number> }
interface RegexFinding { file: string; docId: string; path: string; pattern: string; reason: string; detail: string; caseSensitive: boolean }
interface Report {
  target: string;
  documents: { file: string; shape: string }[];
  findings: Finding[];
  regex: RegexFinding[];
  references: { mode: 'unverified' | 'resolved'; unverified: { file: string; docId: string; path: string; operation: string }[] };
  summary: { files: number; findings: number; errors: number; warnings: number; regexUnsupported: number; referencesUnverified: number };
}

const audit = (args: string[]): { report: Report; status: number | null; stderr: string } => {
  const r = run(['--json', ...args]);
  expect(r.stderr, 'audit must not crash').not.toMatch(/at .*\n\s+at /);
  let report: Report;
  try {
    report = JSON.parse(r.stdout) as Report;
  } catch {
    throw new Error(`expected JSON report, got status=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  return { report, status: r.status, stderr: r.stderr };
};

const lesson = (id: string, questions: unknown[]) => ({
  schemaVersion: 1, kind: 'lesson', id, title: id, objectives: ['Audit it.'], estimatedMinutes: 3,
  blocks: [{ id: 'quiz-1', type: 'quiz', questions }],
});
const shortAnswer = (id: string, correctAnswer: string[], extra: Record<string, unknown> = {}) => ({
  id, type: 'short_answer', matchMode: 'regex', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Name it' }] }] }, correctAnswer, ...extra,
});
const write = (dir: string, name: string, value: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value, null, 2)); return p; };
const tmp = (label: string) => mkdtempSync(join(tmpdir(), `audit-${label}-`));

describe('audit:json-compatibility CLI', { timeout: 60_000 }, () => {
  it('prints usage and exits 2 without a target', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });

  it('exits 2 for a path that does not exist, without a stack trace', () => {
    const r = run(['--json', join(tmpdir(), 'audit-does-not-exist-xyz')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not found|no such/i);
    expect(r.stderr).not.toMatch(/at .*\n\s+at /);
  });
});

describe('reporting unsupported historical regexes', { timeout: 60_000 }, () => {
  it('reports an unsupported pattern in a standalone document with document, path, code and reason', () => {
    const dir = tmp('standalone');
    write(dir, 'legacy.json', lesson('legacy', [shortAnswer('q-legacy', ['^(?=.*gpt)4'])]));
    const { report, status } = audit([join(dir, 'legacy.json')]);

    expect(report.regex).toHaveLength(1);
    expect(report.regex[0]).toMatchObject({
      file: 'legacy.json',
      docId: 'legacy',
      path: '/blocks/0/questions/0/correctAnswer/0',
      pattern: '^(?=.*gpt)4',
      reason: 'unsupported_syntax',
      caseSensitive: false,
    });
    expect(report.regex[0].detail.length).toBeGreaterThan(0);
    expect(report.summary.regexUnsupported).toBe(1);
    expect(status).toBe(1);
  });

  it('reports patterns inside a course workspace against the owning item document', () => {
    const dir = tmp('workspace');
    mkdirSync(join(dir, 'items'));
    write(dir, 'course.json', {
      schemaVersion: 1, kind: 'course', id: 'legacy-course', title: 'Legacy', summary: 'Legacy course.',
      languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills',
      learningOutcomes: ['Audit.'], access: { scope: 'global' }, modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }],
    });
    write(join(dir, 'items'), 'l1.json', lesson('l1', [shortAnswer('q1', ['^ok$', '(a)\\1'])]));

    const { report } = audit([dir]);
    expect(report.regex).toEqual([
      expect.objectContaining({ docId: 'l1', path: '/blocks/0/questions/0/correctAnswer/1', pattern: '(a)\\1', reason: 'unsupported_syntax' }),
    ]);
  });

  it('honours the question case sensitivity and reports each offending pattern once', () => {
    const dir = tmp('multi');
    write(dir, 'multi.json', lesson('multi', [shortAnswer('q1', ['a(?=b)', '(?<=a)b', '^fine$'], { settings: { caseSensitive: true } })]));
    const { report } = audit([join(dir, 'multi.json')]);
    expect(report.regex.map((r) => r.path)).toEqual(['/blocks/0/questions/0/correctAnswer/0', '/blocks/0/questions/0/correctAnswer/1']);
    expect(report.regex.every((r) => r.caseSensitive)).toBe(true);
  });

  it('does not double-report a regex problem as both a regex and a contract finding', () => {
    const dir = tmp('nodupe');
    write(dir, 'dupe.json', lesson('dupe', [shortAnswer('q1', ['a(?=b)'])]));
    const { report } = audit([join(dir, 'dupe.json')]);
    expect(report.regex).toHaveLength(1);
    expect(report.findings.filter((f) => f.path.includes('correctAnswer') && /regex/i.test(f.message))).toEqual([]);
  });

  it('finds unsupported patterns even in a document too broken to schema-validate', () => {
    const dir = tmp('broken');
    // No title, no objectives: the document fails structural validation, but the audit still
    // has to surface the regex a learner is being graded against.
    write(dir, 'broken.json', { schemaVersion: 1, kind: 'lesson', id: 'broken', blocks: [{ id: 'q', type: 'quiz', questions: [shortAnswer('q1', ['(?<=a)b'])] }] });
    const { report } = audit([join(dir, 'broken.json')]);
    expect(report.regex.map((r) => r.reason)).toEqual(['unsupported_syntax']);
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it('reports nothing for supported patterns in the shipped fixtures', () => {
    const { report, status } = audit([join(fixtures, 'all-question-types'), '--fixtures']);
    expect(report.regex).toEqual([]);
    expect(report.summary.regexUnsupported).toBe(0);
    expect(status).toBe(0);
  });

  it('flags a pattern or key that exceeds the safe engine bounds', () => {
    const dir = tmp('bounds');
    write(dir, 'bounds.json', lesson('bounds', [
      shortAnswer('q-long', ['a'.repeat(501)]),
      shortAnswer('q-many', Array.from({ length: 51 }, (_, i) => `^p${i}$`)),
    ]));
    const { report } = audit([join(dir, 'bounds.json')]);
    expect(report.regex.map((r) => r.reason).sort()).toEqual(['pattern_too_long', 'too_many_patterns']);
    expect(report.regex.find((r) => r.reason === 'pattern_too_long')!.pattern.length).toBeLessThanOrEqual(501);
  });
});

describe('contract issues and malformed input', { timeout: 60_000 }, () => {
  it('reports malformed JSON as a finding instead of crashing', () => {
    const dir = tmp('malformed');
    writeFileSync(join(dir, 'broken.json'), '{ "kind": "lesson", ');
    const { report, status } = audit([join(dir, 'broken.json')]);
    expect(report.findings.map((f) => f.code)).toContain('E_JSON_PARSE');
    expect(report.documents[0].shape).toBe('unreadable');
    expect(status).toBe(1);
  });

  it('reports duplicate JSON properties, which a permissive parse would hide', () => {
    const dir = tmp('duplicate');
    writeFileSync(join(dir, 'dup.json'), '{ "schemaVersion": 1, "kind": "lesson", "id": "a", "id": "b", "title": "T", "blocks": [] }');
    const { report, status } = audit([join(dir, 'dup.json')]);
    expect(report.findings).toEqual([
      expect.objectContaining({ file: 'dup.json', code: 'E_JSON_DUPLICATE_KEY', path: '/id', severity: 'error', meta: { key: 'id' } }),
    ]);
    expect(report.documents[0].shape).toBe('unreadable');
    expect(status).toBe(1);
  });

  it('reports an unknown document kind without treating it as a course', () => {
    const dir = tmp('unknown');
    write(dir, 'widget.json', { schemaVersion: 1, kind: 'widget', id: 'w' });
    const { report } = audit([join(dir, 'widget.json')]);
    expect(report.findings.map((f) => f.code)).toContain('E_UNKNOWN_KIND');
  });

  it('audits a lossless {manifest, items} workspace envelope in one file', () => {
    const dir = tmp('envelope');
    write(dir, 'workspace.json', {
      manifest: {
        schemaVersion: 1, kind: 'course', id: 'env', title: 'Env', summary: 'Envelope.', languages: ['en'], defaultLanguage: 'en',
        level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'],
        access: { scope: 'global' }, modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }],
      },
      items: { l1: lesson('l1', [shortAnswer('q1', ['a++'])]) },
    });
    const { report } = audit([join(dir, 'workspace.json')]);
    expect(report.documents[0].shape).toBe('workspace-envelope');
    expect(report.regex).toEqual([expect.objectContaining({ docId: 'l1', reason: 'unsupported_syntax' })]);
  });

  it('reports a missing item document rather than inventing one', () => {
    const { report } = audit([join(fixtures, 'invalid', 'missing-item-document.json')]);
    expect(report.findings.map((f) => f.code)).toContain('E_MISSING_ITEM_DOCUMENT');
  });

  it('audits every JSON document in a directory that is not a course workspace', () => {
    const dir = tmp('many');
    write(dir, 'a.json', lesson('a', [shortAnswer('q1', ['a(?=b)'])]));
    write(dir, 'b.json', lesson('b', [shortAnswer('q1', ['^fine$'])]));
    const { report } = audit([dir]);
    expect(report.summary.files).toBe(2);
    expect(report.documents.map((d) => d.file)).toEqual(['a.json', 'b.json']);
    expect(report.regex.map((r) => r.file)).toEqual(['a.json']);
  });
});

describe('offline honesty about external references', { timeout: 60_000 }, () => {
  it('reports references as unverified when neither --refs nor --fixtures is given', () => {
    const { report } = audit([join(fixtures, 'minimal')]);
    expect(report.references.mode).toBe('unverified');
    expect(report.summary.referencesUnverified).toBeGreaterThan(0);
    // The unverified references are named, so nobody has to guess what went unchecked.
    expect(report.references.unverified[0]).toMatchObject({ path: expect.any(String), operation: expect.any(String) });
    // An unverified reference is never reported as resolved or as missing.
    expect(report.findings.map((f) => f.code)).not.toContain('E_OPPORTUNITY_UNKNOWN');
    expect(report.findings.map((f) => f.code)).not.toContain('E_REFERENCE_LOOKUP_FAILED');
  });

  it('resolves references against --fixtures and stops calling them unverified', () => {
    const { report, status } = audit([join(fixtures, 'minimal'), '--fixtures']);
    expect(report.references.mode).toBe('resolved');
    expect(report.references.unverified).toEqual([]);
    expect(report.summary.referencesUnverified).toBe(0);
    expect(status).toBe(0);
  });

  it('resolves references against an explicit --refs file and reports what is genuinely missing', () => {
    const dir = tmp('refs');
    write(dir, 'refs.json', { resources: [], opportunities: [], branches: [], assets: [], bank: [] });
    const { report } = audit([join(fixtures, 'minimal'), '--refs', join(dir, 'refs.json')]);
    expect(report.references.mode).toBe('resolved');
    expect(report.findings.map((f) => f.code)).toContain('E_OPPORTUNITY_UNKNOWN');
  });
});

describe('compatibility means the save contract, not the read path', { timeout: 60_000 }, () => {
  const course = (items: unknown[]) => ({
    schemaVersion: 1, kind: 'course', id: 'save-contract', title: 'Save', summary: 'Save contract.', languages: ['en'], defaultLanguage: 'en',
    level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'], access: { scope: 'global' },
    modules: [{ id: 'm1', title: 'M', items }],
  });

  it('treats an orphan item document as incompatible, not a read-path warning', () => {
    const dir = tmp('orphan');
    mkdirSync(join(dir, 'items'));
    write(dir, 'course.json', course([{ type: 'lesson', id: 'l1' }]));
    // Both documents must be structurally valid, or their own errors would mask the orphan.
    write(join(dir, 'items'), 'l1.json', lesson('l1', [shortAnswer('q1', ['^ok$'])]));
    write(join(dir, 'items'), 'stray.json', lesson('stray', [shortAnswer('q1', ['^ok$'])]));

    const { report, status } = audit([dir, '--fixtures']);
    expect(report.findings.filter((f) => f.code === 'E_SCHEMA')).toEqual([]);
    const orphan = report.findings.find((f) => f.code.includes('ORPHAN_ITEM_DOCUMENT'));
    expect(orphan?.severity).toBe('error');
    expect(status).toBe(1);
  });

  it('treats a missing item document as incompatible', () => {
    const dir = tmp('missing');
    write(dir, 'course.json', course([{ type: 'lesson', id: 'absent' }]));
    const { report, status } = audit([dir, '--fixtures']);
    expect(report.findings.find((f) => f.code === 'E_MISSING_ITEM_DOCUMENT')?.severity).toBe('error');
    expect(status).toBe(1);
  });

  it('treats an unrenderable block as incompatible rather than a warning', () => {
    const { report, status } = audit([join(fixtures, 'invalid', 'unsupported-renderer.json'), '--fixtures']);
    const renderer = report.findings.filter((f) => f.code === 'E_RENDERER_UNSUPPORTED');
    expect(renderer.length).toBeGreaterThan(0);
    expect(renderer.every((f) => f.severity === 'error')).toBe(true);
    expect(status).toBe(1);
  });
});

describe('renderer support in standalone documents', { timeout: 60_000 }, () => {
  const reserved = { type: 'math', latex: 'x^2' };
  const resource = (body: unknown) => ({ schemaVersion: 1, kind: 'resource', id: 'resource-math', title: 'Math', summary: 'S', resourceType: 'guide', body });

  it('reports a resource whose body is a block nothing can render', () => {
    // Regression: this document validated clean and persisted, and no renderer could draw it.
    const dir = tmp('resource');
    write(dir, 'resource.json', resource({ blocks: [reserved] }));
    const { report, status } = audit([join(dir, 'resource.json'), '--fixtures']);
    expect(report.findings).toEqual([
      expect.objectContaining({ code: 'E_RENDERER_UNSUPPORTED', docId: 'resource-math', path: '/body/blocks/0', severity: 'error', meta: { type: 'math' } }),
    ]);
    expect(status).toBe(1);
  });

  it('reports a reserved block nested in a localized resource body', () => {
    const dir = tmp('resource-l10n');
    write(dir, 'resource.json', resource({ vi: { blocks: [{ type: 'callout', variant: 'info', blocks: [reserved] }] } }));
    const { report } = audit([join(dir, 'resource.json'), '--fixtures']);
    expect(report.findings.map((f) => f.path)).toEqual(['/body/vi/blocks/0/blocks/0']);
  });

  it('reports a reserved block inside a workspace item quiz intro, which the workspace pass misses', () => {
    const dir = tmp('workspace-intro');
    mkdirSync(join(dir, 'items'));
    write(dir, 'course.json', {
      schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 'S', languages: ['en'], defaultLanguage: 'en',
      level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'],
      access: { scope: 'global' }, modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }],
    });
    write(join(dir, 'items'), 'l1.json', {
      schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'l1', objectives: ['Audit.'], estimatedMinutes: 3,
      blocks: [{ id: 'quiz-1', type: 'quiz', intro: { blocks: [reserved] }, questions: [shortAnswer('q1', ['^ok$'])] }],
    });

    const { report, status } = audit([dir, '--fixtures']);
    expect(report.findings.filter((f) => f.code === 'E_RENDERER_UNSUPPORTED')).toEqual([
      expect.objectContaining({ file: 'items/l1.json', docId: 'l1', path: '/blocks/0/intro/blocks/0', severity: 'error', meta: { type: 'math' } }),
    ]);
    expect(status).toBe(1);
  });

  it('reports a workspace item block once, not once per pass', () => {
    const dir = tmp('workspace-dedupe');
    mkdirSync(join(dir, 'items'));
    write(dir, 'course.json', {
      schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 'S', languages: ['en'], defaultLanguage: 'en',
      level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'],
      access: { scope: 'global' }, modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }],
    });
    write(join(dir, 'items'), 'l1.json', {
      schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'l1', objectives: ['Audit.'], estimatedMinutes: 3,
      blocks: [reserved, { id: 'quiz-1', type: 'quiz', questions: [shortAnswer('q1', ['^ok$'])] }],
    });

    const { report } = audit([dir, '--fixtures']);
    expect(report.findings.filter((f) => f.code === 'E_RENDERER_UNSUPPORTED')).toEqual([
      expect.objectContaining({ file: 'items/l1.json', docId: 'l1', path: '/blocks/0', severity: 'error' }),
    ]);
  });
});

describe('exit codes distinguish unchecked references from incompatibility', { timeout: 60_000 }, () => {
  it('exits 3 and reports UNVERIFIED when reference checks could not run', () => {
    const r = run([join(fixtures, 'minimal')]);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain('UNVERIFIED');
    expect(r.stdout).not.toContain('OK —');
  });

  it('exits 0 and reports OK only when everything was actually checked', () => {
    const r = run([join(fixtures, 'minimal'), '--fixtures']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK —');
    expect(r.stdout).not.toContain('UNVERIFIED');
  });

  it('prefers exit 1 when content is incompatible and references were also unchecked', () => {
    const dir = tmp('both');
    write(dir, 'legacy.json', lesson('legacy', [shortAnswer('q1', ['a(?=b)'])]));
    const { report, status } = audit([dir]);
    expect(report.summary.regexUnsupported).toBe(1);
    expect(status).toBe(1);
  });

  it('exits 2 for a target directory holding no JSON at all', () => {
    const r = run(['--json', tmp('empty')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no json/i);
    expect(r.stderr).not.toMatch(/at .*\n\s+at /);
  });
});

describe('input errors stay concise', { timeout: 60_000 }, () => {
  it('rejects a malformed --refs file without a stack trace', () => {
    const dir = tmp('badrefs');
    writeFileSync(join(dir, 'refs.json'), '{ "assets": [ ');
    const r = run([join(fixtures, 'minimal'), '--refs', join(dir, 'refs.json')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/refs\.json/);
    expect(r.stderr).not.toMatch(/at .*\n\s+at /);
    expect(r.stderr.split('\n').filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it('rejects a --refs file with duplicate properties, like any other strict parse', () => {
    const dir = tmp('duprefs');
    writeFileSync(join(dir, 'refs.json'), '{ "assets": [], "assets": ["a"] }');
    const r = run([join(fixtures, 'minimal'), '--refs', join(dir, 'refs.json')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/assets|duplicate|twice/i);
  });

  it('rejects a --refs path that is a directory without a stack trace', () => {
    const r = run([join(fixtures, 'minimal'), '--refs', tmp('dirrefs')]);
    expect(r.status).toBe(2);
    expect(r.stderr).not.toMatch(/at .*\n\s+at /);
  });
});

describe('byte budgets follow the document and envelope contract', { timeout: 60_000 }, () => {
  const filler = (bytes: number) => 'x'.repeat(bytes);

  it('rejects a content document over the 1 MiB document limit', () => {
    const dir = tmp('bigdoc');
    writeFileSync(join(dir, 'big.json'), JSON.stringify({ schemaVersion: 1, kind: 'lesson', id: 'big', title: 'Big', blocks: [], pad: filler(1_100_000) }));
    const { report, status } = audit([join(dir, 'big.json')]);
    expect(report.findings.map((f) => f.code)).toContain('E_LIMIT_EXCEEDED');
    expect(report.findings.find((f) => f.code === 'E_LIMIT_EXCEEDED')?.meta?.expected).toBe(1_048_576);
    expect(status).toBe(1);
  });

  it('accepts a workspace envelope between the document and envelope limits', () => {
    const dir = tmp('bigenvelope');
    const items: Record<string, unknown> = {};
    // Six ~200 KiB lessons: over 1 MiB in total, each well under the document limit.
    for (let i = 0; i < 6; i++) {
      items[`l${i}`] = { ...lesson(`l${i}`, []), summary: filler(200_000) };
    }
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({
      manifest: {
        schemaVersion: 1, kind: 'course', id: 'big-env', title: 'Big', summary: 'Big envelope.', languages: ['en'], defaultLanguage: 'en',
        level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'], access: { scope: 'global' },
        modules: [{ id: 'm1', title: 'M', items: Object.keys(items).map((id) => ({ type: 'lesson', id })) }],
      },
      items,
    }));
    const { report } = audit([join(dir, 'workspace.json'), '--fixtures']);
    expect(report.documents[0].shape).toBe('workspace-envelope');
    expect(report.findings.filter((f) => f.code === 'E_LIMIT_EXCEEDED')).toEqual([]);
  });

  it('rejects one oversized document inside an otherwise legal envelope', () => {
    const dir = tmp('bigitem');
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({
      manifest: {
        schemaVersion: 1, kind: 'course', id: 'big-item', title: 'Big', summary: 'One huge item.', languages: ['en'], defaultLanguage: 'en',
        level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Audit.'], access: { scope: 'global' },
        modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'huge' }] }],
      },
      items: { huge: { ...lesson('huge', []), summary: filler(1_100_000) } },
    }));
    const { report, status } = audit([join(dir, 'workspace.json'), '--fixtures']);
    const limit = report.findings.find((f) => f.code === 'E_LIMIT_EXCEEDED');
    expect(limit?.docId).toContain('huge');
    expect(status).toBe(1);
  });

  it('rejects an envelope over the 2 MiB envelope limit', () => {
    const dir = tmp('hugeenvelope');
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ manifest: {}, items: {}, pad: filler(2_200_000) }));
    const { report, status } = audit([join(dir, 'workspace.json')]);
    expect(report.findings.find((f) => f.code === 'E_LIMIT_EXCEEDED')?.meta?.expected).toBe(2_097_152);
    expect(status).toBe(1);
  });
});

describe('the audit is read-only and deterministic', { timeout: 60_000 }, () => {
  it('never mutates, repairs or rewrites the documents it reads', () => {
    const dir = tmp('readonly');
    const file = write(dir, 'legacy.json', lesson('legacy', [shortAnswer('q1', ['a(?=b)'])]));
    const before = { bytes: readFileSync(file), mtimeMs: statSync(file).mtimeMs };

    const { report } = audit([join(dir, 'legacy.json')]);
    expect(report.regex).toHaveLength(1); // it did read and audit the file

    expect(readFileSync(file).equals(before.bytes)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(before.mtimeMs);
  });

  it('produces byte-identical output across runs', () => {
    const dir = tmp('deterministic');
    mkdirSync(join(dir, 'items'));
    write(dir, 'a.json', lesson('a', [shortAnswer('q1', ['a(?=b)', '(a)\\1'])]));
    write(dir, 'b.json', lesson('b', [shortAnswer('q1', ['(?<=x)y'])]));
    const first = run(['--json', dir]).stdout;
    const second = run(['--json', dir]).stdout;
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('reads no database, environment or secret material', () => {
    const source = readFileSync(join(repoRoot, script), 'utf8');
    for (const forbidden of [/process\s*\.\s*env/, /supabase/i, /createClient/, /load-env/, /\bfetch\s*\(/, /dotenv/]) {
      expect(forbidden.test(source), `${script} must not reference ${forbidden}`).toBe(false);
    }
  });

  it('writes a human report by default and machine JSON only on request', () => {
    const dir = tmp('text');
    write(dir, 'legacy.json', lesson('legacy', [shortAnswer('q1', ['a(?=b)'])]));
    const r = run([join(dir, 'legacy.json')]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('legacy.json');
    expect(r.stdout).toMatch(/unsupported/i);
    expect(() => JSON.parse(r.stdout)).toThrow();
  });
});
