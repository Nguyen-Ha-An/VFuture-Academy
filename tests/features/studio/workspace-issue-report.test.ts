import { describe, expect, it } from 'vitest';

import { COURSE_REF, itemRef, makeDiagnostic, refKey, refOf } from '@/content-engine/diagnostics';
import { toValidationIssues } from '@/lib/api-error';
import { workspaceIssueReport } from '@/features/studio/ui/client';

describe('server validation issues re-entering the editor', () => {
  it('round-trips an item whose id is literally `manifest` without collapsing it onto the course', () => {
    const diagnostic = makeDiagnostic('E_MISSING_ITEM_DOCUMENT', { ref: itemRef('manifest'), path: '/blocks/0', meta: { id: 'manifest', type: 'lesson' } });

    const issues = toValidationIssues([diagnostic]);
    const [restored] = workspaceIssueReport(issues).errors;

    expect(refOf(restored)).toEqual({ kind: 'item', id: 'manifest' });
    expect(refKey(refOf(restored))).toBe('item:manifest');
    expect(refKey(refOf(restored))).not.toBe(refKey(COURSE_REF));
  });

  it('keeps a course diagnostic on the course', () => {
    const issues = toValidationIssues([makeDiagnostic('E_SCHEMA', { ref: COURSE_REF, path: '/title' })]);
    expect(refOf(workspaceIssueReport(issues).errors[0])).toEqual({ kind: 'course' });
  });

  it('preserves the code, the JSON pointer, the range and the revision', () => {
    const diagnostic = {
      ...makeDiagnostic('E_REFERENCE_LOOKUP_FAILED', { ref: itemRef('intro'), path: '/blocks/2/ref' }),
      range: { start: { line: 4, col: 3 }, end: { line: 4, col: 19 } },
      revision: 'rev-7',
    };

    const [restored] = workspaceIssueReport(toValidationIssues([diagnostic])).errors;

    expect(restored.code).toBe('E_REFERENCE_LOOKUP_FAILED');
    expect(restored.path).toBe('/blocks/2/ref');
    expect(restored.range).toEqual({ start: { line: 4, col: 3 }, end: { line: 4, col: 19 } });
    expect(restored.revision).toBe('rev-7');
  });

  it('keeps a server warning a warning instead of promoting it to an error', () => {
    const report = workspaceIssueReport(toValidationIssues([makeDiagnostic('W_ORPHAN_ITEM_DOCUMENT', { ref: itemRef('stray'), path: '', meta: { id: 'stray' } })]));

    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].severity).toBe('warning');
  });

  it('keeps both message locales', () => {
    const [restored] = workspaceIssueReport(toValidationIssues([
      makeDiagnostic('E_MISSING_ITEM_DOCUMENT', { ref: itemRef('intro'), path: '', meta: { id: 'intro', type: 'lesson' } }),
    ])).errors;

    expect(restored.message.en).toMatch(/has no document/);
    expect(restored.message.vi).toMatch(/chưa có tài liệu/);
    expect(restored.message.vi).not.toBe(restored.message.en);
  });

  it('falls back to the legacy path shape when the server sends no reference', () => {
    const legacy = workspaceIssueReport([
      { path: ['items', 'intro', 'blocks', 0], message: 'Legacy item issue' },
      { path: ['manifest', 'title'], message: 'Legacy course issue' },
    ]);

    expect(refOf(legacy.errors[0])).toEqual({ kind: 'item', id: 'intro' });
    expect(legacy.errors[0].path).toBe('/blocks/0');
    expect(refOf(legacy.errors[1])).toEqual({ kind: 'course' });
    expect(legacy.errors[1].path).toBe('/title');
    expect(legacy.errors[0].message.vi).toBe('Legacy item issue');
  });

  it('escapes pointer segments that contain a slash or a tilde', () => {
    const [restored] = workspaceIssueReport([{ path: ['manifest', 'a/b', 'c~d'], message: 'x' }]).errors;
    expect(restored.path).toBe('/a~1b/c~0d');
  });

  it('reports an empty issue list as nothing to show', () => {
    expect(workspaceIssueReport(undefined)).toMatchObject({ errors: [], warnings: [] });
    expect(workspaceIssueReport([]).errors).toEqual([]);
  });
});
