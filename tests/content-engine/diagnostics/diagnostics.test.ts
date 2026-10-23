import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CODES, makeDiagnostic, formatDiagnostic, fromZodError, toPointer, fromPointer } from '@/content-engine/diagnostics';
import { LessonBlockSchema } from '@/content-engine/schema/lesson';
import { IdSchema } from '@/content-engine/schema/common';

describe('codes and messages', () => {
  it('every code has a severity and a vi + en template', () => {
    for (const code of Object.keys(CODES)) {
      const d = makeDiagnostic(code as keyof typeof CODES, { docId: 'manifest', path: '/x', meta: { id: 'a', limit: 3, expected: 'x', received: 'y', locale: 'vi', host: 'h', type: 't', valid: 'a, b', detail: 'd' } });
      expect(d.message.vi.length).toBeGreaterThan(3);
      expect(d.message.en.length).toBeGreaterThan(3);
      expect(['error', 'warning', 'info']).toContain(d.severity);
    }
  });
  it('interpolates meta and formats with location', () => {
    const d = makeDiagnostic('E_DUPLICATE_ID', { docId: 'l1', path: '/blocks/2/id', meta: { id: 'quiz-1' } });
    expect(d.message.en).toContain('quiz-1');
    expect(formatDiagnostic(d, 'en')).toMatch(/^error E_DUPLICATE_ID l1 \/blocks\/2\/id: /);
  });
  it('allows severity override (publish vs draft)', () => {
    expect(makeDiagnostic('E_RENDERER_UNSUPPORTED', { docId: 'l1', path: '/blocks/0', meta: { type: 'math' }, severity: 'warning' }).severity).toBe('warning');
  });
});

describe('JSON pointers', () => {
  it('round-trips with escaping', () => {
    expect(toPointer(['blocks', 2, 'a/b', 'c~d'])).toBe('/blocks/2/a~1b/c~0d');
    expect(fromPointer('/blocks/2/a~1b/c~0d')).toEqual(['blocks', 2, 'a/b', 'c~d']);
    expect(toPointer([])).toBe('');
  });
});

describe('fromZodError', () => {
  it('maps issues to E_SCHEMA with pointer paths and picks the matching union branch', () => {
    const r = LessonBlockSchema.safeParse({ id: 'q1', type: 'quiz', questions: [{ id: 'x', type: 'single_choice', content: { blocks: [{ type: 'paragraph', content: [{ text: 'a' }] }] }, options: [{ id: 'a', content: { blocks: [{ type: 'paragraph', content: [{ text: 'A' }] }] } }], correctAnswer: 'a' }] });
    expect(r.success).toBe(false);
    const ds = fromZodError(r.error!, 'l1');
    expect(ds.some((d) => d.code === 'E_SCHEMA' && d.path === '/questions/0/options')).toBe(true);
  });
  it('maps known refine messages to specific codes', () => {
    const r = LessonBlockSchema.safeParse({ type: 'embed', url: 'https://evil.example.com/x', title: 'no' });
    const ds = fromZodError(r.error!, 'l1');
    expect(ds.some((d) => d.code === 'E_EMBED_HOST_NOT_ALLOWED' && d.path === '/url')).toBe(true);
  });
  it('maps bad ids to E_ID_FORMAT', () => {
    const r = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'id must be kebab-case: a-z, 0-9, "-", max 64 chars') }).safeParse({ id: 'Bad Id' });
    expect(fromZodError(r.error!, 'd')[0].code).toBe('E_ID_FORMAT');
  });
  it('maps the real IdSchema failure to E_ID_FORMAT', () => {
    expect(fromZodError(IdSchema.safeParse('Bad Id').error!, 'd')[0].code).toBe('E_ID_FORMAT');
  });
});
