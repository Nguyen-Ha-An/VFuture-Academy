import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES } from '@/content-engine/validate/parse';
import { RECOVERY_EXPORT_KIND, RECOVERY_EXPORT_VERSION } from '@/features/studio/recovery/types';
import {
  decodeAnyImport,
  decodeCourseImport,
  decodeItemImport,
  decodeRawSourceRecovery,
  decodeWorkspaceEnvelope,
  encodeCourseExport,
  encodeRawSourceRecovery,
  encodeWorkspaceEnvelope,
  WORKSPACE_ENVELOPE_KIND,
  WORKSPACE_ENVELOPE_VERSION,
  type DecodeResult,
  type ImportSnapshot,
} from '@/features/studio/content-transfer';

/** Server-side `baseVersionId` is a uuid, so the codec's fixtures use real ones. */
const BASE_VERSION_ID = '5f2b7c48-9a10-4c3e-8d21-6b0f4e7a9c11';

const exampleText = (name: string) => readFileSync(join(process.cwd(), 'docs', 'studio', 'content-schema', 'examples', `${name}.json`), 'utf8');
const exampleJson = (name: string) => JSON.parse(exampleText(name)) as Record<string, unknown>;

function expectOk<T>(result: DecodeResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got: ${result.diagnostics.map((d) => `${d.code} ${d.path}`).join(', ')}`);
  return result.value;
}

function expectFail(result: DecodeResult<unknown>): string[] {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of result.diagnostics) {
    expect(diagnostic.message.vi.length).toBeGreaterThan(0);
    expect(diagnostic.message.en.length).toBeGreaterThan(0);
  }
  expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  return result.diagnostics.map((d) => d.code);
}

/** A valid lesson whose serialized size is roughly `approxBytes`, padded with code blocks. */
function bigLesson(id: string, approxBytes: number): Record<string, unknown> {
  const perBlock = 20000;
  const blocks = Array.from({ length: Math.max(1, Math.ceil(approxBytes / perBlock)) }, () => ({
    type: 'code', language: 'python', code: 'x'.repeat(perBlock),
  }));
  return { schemaVersion: 1, kind: 'lesson', id, title: `Bài ${id}`, blocks };
}

const courseWith = (items: { id: string; type: string }[]): Record<string, unknown> => ({
  ...exampleJson('course'),
  modules: [{ id: 'chuong-1', title: 'Bắt đầu', items }],
});

describe('course import', () => {
  it('accepts the documented inline course and lifts every item out', () => {
    const snapshot = expectOk(decodeCourseImport(exampleText('course'), 'nhap-mon-ai'));
    expect(Object.keys(snapshot.items).sort()).toEqual(['bai-mo-dau', 'bai-thuc-hanh', 'kiem-tra']);
    const manifest = snapshot.manifest as { modules: { items: Record<string, unknown>[] }[] };
    // The manifest keeps stubs only: no item body is duplicated between the two places.
    for (const item of manifest.modules[0].items) expect(item).not.toHaveProperty('blocks');
  });

  it('refuses a course that declares an item it does not carry', () => {
    const text = JSON.stringify(courseWith([{ id: 'bai-vang', type: 'lesson' }]));
    expect(expectFail(decodeCourseImport(text))).toContain('E_MISSING_ITEM_DOCUMENT');
  });

  it('reports an id mismatch instead of renaming the course', () => {
    const result = decodeCourseImport(exampleText('course'), 'khoa-khac');
    expect(expectFail(result)).toContain('E_WORKSPACE_ID_MISMATCH');
  });

  it.each([
    ['a byte order mark', `﻿${exampleText('course')}`],
    ['a markdown code fence', '```json\n' + exampleText('course') + '\n```'],
    ['a trailing comma', exampleText('course').replace(/}\s*$/, '},}')],
    ['a duplicate key', exampleText('course').replace('"kind": "course"', '"kind": "course", "kind": "course"')],
    ['an overflowing number', exampleText('course').replace('"estimatedMinutes": 5', '"estimatedMinutes": 1e999')],
  ])('rejects %s without repairing it', (_label, text) => {
    expect(decodeCourseImport(text).ok).toBe(false);
  });

  it('keeps the document limit at one document for a single-file course', () => {
    const text = JSON.stringify({ ...exampleJson('course'), summary: 'x'.repeat(MAX_DOCUMENT_BYTES) });
    expect(expectFail(decodeCourseImport(text))).toContain('E_LIMIT_EXCEEDED');
  });
});

describe('item import', () => {
  it('returns the document exactly as authored, envelope fields included', () => {
    const document = { ...exampleJson('lesson'), $schema: 'https://example.test/lesson.json', languages: ['vi'], defaultLanguage: 'vi' };
    const imported = expectOk(decodeItemImport(JSON.stringify(document)));
    expect(imported).toMatchObject({ id: 'bai-mo-dau', kind: 'lesson' });
    expect(imported.document).toEqual(document);
  });

  it('refuses a course document', () => {
    expect(expectFail(decodeItemImport(exampleText('course')))).toContain('E_ITEM_KIND_MISMATCH');
  });

  it('names the document being imported in its diagnostics', () => {
    const result = decodeItemImport(JSON.stringify({ ...exampleJson('lesson'), notAField: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].docId).toBe('bai-mo-dau');
  });
});

describe('workspace envelope', () => {
  const snapshot = (): ImportSnapshot => {
    const base = expectOk(decodeCourseImport(exampleText('course')));
    return {
      manifest: base.manifest,
      // Standalone items legitimately carry an envelope of their own; a lossless
      // backup has to bring it back.
      items: { ...base.items, 'bai-mo-dau': { ...(base.items['bai-mo-dau'] as object), $schema: 'https://example.test/lesson.json', languages: ['vi'], defaultLanguage: 'vi' } },
      baseVersionId: BASE_VERSION_ID,
    };
  };

  it('round-trips a snapshot exactly', () => {
    const original = snapshot();
    const decoded = expectOk(decodeWorkspaceEnvelope(JSON.stringify(encodeWorkspaceEnvelope(original))));
    expect(decoded.manifest).toEqual(original.manifest);
    expect({ ...decoded.items }).toEqual({ ...original.items });
    expect(decoded.baseVersionId).toBe(BASE_VERSION_ID);
    expect((decoded.items['bai-mo-dau'] as Record<string, unknown>).languages).toEqual(['vi']);
  });

  it('accepts a plain { manifest, items } object', () => {
    const original = snapshot();
    const decoded = expectOk(decodeWorkspaceEnvelope(JSON.stringify({ manifest: original.manifest, items: original.items })));
    expect({ ...decoded.items }).toEqual({ ...original.items });
    // Absent is not null: the transfer said nothing about a base version, and saying
    // "based on no version" for it would let a save start from scratch.
    expect('baseVersionId' in decoded).toBe(false);
  });

  it('is exactly as strict about a bare object as about a kinded envelope', () => {
    const original = snapshot();
    const text = JSON.stringify({ manifest: original.manifest, items: original.items, garbage: true });
    expect(expectFail(decodeWorkspaceEnvelope(text))).toContain('E_SCHEMA');
  });

  it('re-encodes a decoded envelope to the same value', () => {
    const original = snapshot();
    const once = JSON.stringify(encodeWorkspaceEnvelope(original));
    const twice = JSON.stringify(encodeWorkspaceEnvelope(expectOk(decodeWorkspaceEnvelope(once))));
    expect(twice).toBe(once);
  });

  it.each([
    ['a base version that is not a uuid', { baseVersionId: 'version-7' }],
    ['a numeric base version', { baseVersionId: 7 }],
    ['a version without a kind', { version: 1 }],
  ])('rejects %s', (_label, over) => {
    const original = snapshot();
    const text = JSON.stringify({ manifest: original.manifest, items: original.items, ...over });
    expect(expectFail(decodeWorkspaceEnvelope(text))).toContain('E_SCHEMA');
  });

  it('refuses an envelope whose courseId disagrees with its manifest', () => {
    const original = snapshot();
    const text = JSON.stringify({ ...encodeWorkspaceEnvelope(original), courseId: 'khoa-khac' });
    expect(expectFail(decodeWorkspaceEnvelope(text))).toContain('E_WORKSPACE_ID_MISMATCH');
  });

  it('reads an envelope larger than one document but within the wire limit', () => {
    const items = ['bai-mot', 'bai-hai', 'bai-ba', 'bai-bon', 'bai-nam'].map((id) => bigLesson(id, 260_000));
    const envelope = {
      kind: WORKSPACE_ENVELOPE_KIND,
      version: WORKSPACE_ENVELOPE_VERSION,
      courseId: 'nhap-mon-ai',
      manifest: courseWith(items.map((item) => ({ id: item.id as string, type: 'lesson' }))),
      items: Object.fromEntries(items.map((item) => [item.id as string, item])),
      baseVersionId: null,
    };
    const text = JSON.stringify(envelope);
    expect(text.length).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expect(text.length).toBeLessThan(MAX_ENVELOPE_BYTES);

    expect(Object.keys(expectOk(decodeWorkspaceEnvelope(text)).items)).toHaveLength(5);
  });

  it('still caps each document inside the envelope', () => {
    const item = bigLesson('bai-qua-lon', MAX_DOCUMENT_BYTES + 40_000);
    const text = JSON.stringify({
      manifest: courseWith([{ id: 'bai-qua-lon', type: 'lesson' }]),
      items: { 'bai-qua-lon': item },
    });
    const codes = expectFail(decodeWorkspaceEnvelope(text));
    expect(codes).toContain('E_LIMIT_EXCEEDED');
  });

  it.each([
    ['an unknown envelope kind', { kind: 'something.else', manifest: {}, items: {} }, 'E_UNKNOWN_KIND'],
    ['an unsupported version', { kind: WORKSPACE_ENVELOPE_KIND, version: 99, manifest: {}, items: {} }, 'E_SCHEMA_VERSION_UNSUPPORTED'],
    ['an unknown field', { kind: WORKSPACE_ENVELOPE_KIND, version: 1, manifest: {}, items: {}, extra: 1 }, 'E_SCHEMA'],
    ['a non-object items map', { manifest: {}, items: [] }, 'E_SCHEMA'],
  ])('rejects %s', (_label, envelope, code) => {
    expect(expectFail(decodeWorkspaceEnvelope(JSON.stringify(envelope)))).toContain(code);
  });

  it('treats a __proto__ item key as data, not as a prototype', () => {
    const text = JSON.stringify({ manifest: courseWith([{ id: 'bai-mo-dau', type: 'lesson' }]), items: { __proto__: { polluted: true } } });
    expect(decodeWorkspaceEnvelope(text).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('raw source recovery', () => {
  const brokenSource = '{ "schemaVersion": 1, "kind": "course",';

  it('round-trips raw text byte for byte, however invalid', () => {
    const envelope = encodeRawSourceRecovery('nhap-mon-ai', { course: brokenSource, 'item:manifest': 'still typing' }, 'version-3', { baseUpdatedAt: '2026-09-07T10:00:00.000Z', modifiedAt: '2026-09-07T10:05:00.000Z' });
    const decoded = expectOk(decodeRawSourceRecovery(JSON.stringify(envelope)));

    expect(decoded.courseId).toBe('nhap-mon-ai');
    expect(decoded.sources.course).toBe(brokenSource);
    // An item legitimately named `manifest` keeps its own slot.
    expect(decoded.sources['item:manifest']).toBe('still typing');
    expect(decoded.baseVersionId).toBe('version-3');
    expect(decoded.baseUpdatedAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('keeps an over-long raw source recoverable', () => {
    // Text that has grown past the one-document limit is exactly the work an author
    // must not lose. It is refused at save time, not at recovery time.
    const huge = 'x'.repeat(MAX_DOCUMENT_BYTES + 5_000);
    const text = JSON.stringify(encodeRawSourceRecovery('nhap-mon-ai', { course: huge }, null));
    expect(text.length).toBeGreaterThan(MAX_DOCUMENT_BYTES);
    expect(text.length).toBeLessThan(MAX_ENVELOPE_BYTES);
    expect(expectOk(decodeRawSourceRecovery(text)).sources.course).toBe(huge);
  });

  it('refuses the older bare download that does not say what it is', () => {
    const legacy = { courseId: 'nhap-mon-ai', sources: { manifest: brokenSource }, baseVersionId: null };
    expect(expectFail(decodeRawSourceRecovery(JSON.stringify(legacy)))).toContain('E_UNKNOWN_KIND');
  });

  const envelope = (over: Record<string, unknown>) => JSON.stringify({
    kind: RECOVERY_EXPORT_KIND, version: RECOVERY_EXPORT_VERSION, courseId: 'nhap-mon-ai',
    sources: { course: brokenSource }, baseVersionId: null, baseUpdatedAt: null, modifiedAt: null, ...over,
  });

  it.each([
    ['a legacy docId source key', { sources: { manifest: brokenSource } }, 'E_SCHEMA'],
    ['a malformed item key', { sources: { course: brokenSource, 'item:Not Valid': 'x' } }, 'E_SCHEMA'],
    ['a missing course source', { sources: { 'item:bai-mo-dau': 'x' } }, 'E_SCHEMA'],
    ['a non-string source value', { sources: { course: 42 } }, 'E_SCHEMA'],
    ['an unsupported version', { version: 99 }, 'E_SCHEMA_VERSION_UNSUPPORTED'],
    ['an invalid course id', { courseId: 'Not An Id' }, 'E_ID_FORMAT'],
    ['an unknown field', { surprise: true }, 'E_SCHEMA'],
  ])('rejects %s', (_label, over, code) => {
    expect(expectFail(decodeRawSourceRecovery(envelope(over)))).toContain(code);
  });

  it('never turns a wrongly typed baseVersionId into null', () => {
    expect(expectFail(decodeRawSourceRecovery(envelope({ baseVersionId: 7 })))).toContain('E_SCHEMA');
  });
});

describe('portable course export', () => {
  it('reports what inlining drops and can be imported back', () => {
    const base = expectOk(decodeCourseImport(exampleText('course')));
    const withEnvelope: ImportSnapshot = {
      manifest: base.manifest,
      items: { ...base.items, 'bai-mo-dau': { ...(base.items['bai-mo-dau'] as object), $schema: 'https://example.test/lesson.json', languages: ['vi'] } },
    };
    const exported = encodeCourseExport(withEnvelope);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const kinds = exported.normalizations.filter((n) => n.detail === '$schema' || n.detail === 'languages').map((n) => n.kind);
    expect(kinds).toContain('dropped-item-envelope');
    expect(kinds).toContain('dropped-item-language');
    for (const note of exported.normalizations) expect(note.message.vi.length).toBeGreaterThan(0);

    const reimported = expectOk(decodeCourseImport(JSON.stringify(exported.document)));
    expect(Object.keys(reimported.items).sort()).toEqual(Object.keys(base.items).sort());
  });

  it('will not export a workspace that is missing a document', () => {
    const exported = encodeCourseExport({ manifest: courseWith([{ id: 'bai-vang', type: 'lesson' }]), items: {} });
    expect(exported.ok).toBe(false);
    if (exported.ok) return;
    expect(exported.diagnostics.map((d) => d.code)).toContain('E_MISSING_ITEM_DOCUMENT');
  });
});

describe('form detection', () => {
  it('routes each supported form to its own decoder', () => {
    const base = expectOk(decodeCourseImport(exampleText('course')));
    const cases: [string, string][] = [
      [exampleText('course'), 'course'],
      [JSON.stringify(encodeWorkspaceEnvelope(base)), 'workspace'],
      [exampleText('lesson'), 'item'],
      [JSON.stringify(encodeRawSourceRecovery('nhap-mon-ai', { course: '{' }, null)), 'recovery'],
    ];
    for (const [text, form] of cases) expect(expectOk(decodeAnyImport(text)).form).toBe(form);
  });

  it('says what it expected when the text is none of them', () => {
    expect(expectFail(decodeAnyImport('{"hello":"world"}'))).toContain('E_UNKNOWN_KIND');
  });
});
