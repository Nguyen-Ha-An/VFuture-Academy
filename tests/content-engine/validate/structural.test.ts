import { describe, it, expect } from 'vitest';
import { validateDocument } from '@/content-engine/validate/structural';

const lesson = { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }] };

describe('validateDocument', () => {
  it('returns the typed document for a valid lesson', () => {
    const r = validateDocument(lesson, 'l1');
    expect(r.ok && r.kind === 'lesson' && r.doc.id === 'l1').toBe(true);
  });
  it('flags unknown kind and unsupported schemaVersion', () => {
    expect(validateDocument({ ...lesson, kind: 'book' }, 'l1')).toMatchObject({ ok: false, diagnostics: [{ code: 'E_UNKNOWN_KIND', path: '/kind' }] });
    expect(validateDocument({ ...lesson, schemaVersion: 7 }, 'l1')).toMatchObject({ ok: false, diagnostics: [{ code: 'E_SCHEMA_VERSION_UNSUPPORTED', path: '/schemaVersion' }] });
    expect(validateDocument(null, 'l1')).toMatchObject({ ok: false, diagnostics: [{ code: 'E_UNKNOWN_KIND' }] });
  });
  it('maps schema issues to pointers', () => {
    const r = validateDocument({ ...lesson, blocks: [{ type: 'heading', level: 9, content: [{ text: 'x' }] }] }, 'l1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diagnostics.map((d) => d.path)).toContain('/blocks/0/level');
  });
});
