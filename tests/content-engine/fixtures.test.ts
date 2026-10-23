import { describe, it, expect } from 'vitest';
import { FIXTURES, INVALID_FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import { validateWorkspace } from '@/content-engine/validate';
import { compileCourse, assertNoAnswerKeys } from '@/content-engine/compile';
import { QUESTION_TYPES } from '@/content-engine/schema/questions';
import { RENDERABLE_BLOCK_TYPES } from '@/content-engine/manifest/blocks';

describe('golden fixtures', () => {
  for (const [name, ws] of Object.entries(FIXTURES)) {
    it(`${name} validates for publish with zero errors and compiles in every declared locale`, async () => {
      const report = await validateWorkspace(ws, fixtureResolver, { publish: true });
      expect(report.errors, JSON.stringify(report.errors, null, 2)).toEqual([]);
      const r = await compileCourse(ws, fixtureResolver, { publish: true });
      expect(r.ok).toBe(true);
      for (const item of Object.values(r.compiled!.items)) for (const render of Object.values(item.renders)) expect(() => assertNoAnswerKeys(render)).not.toThrow();
      expect(r.compiled!.languages.every((l) => Object.values(r.compiled!.items).every((i) => i.renders[l]))).toBe(true);
    });
  }
  it('all-question-types exercises all 13 types and every renderable block type', async () => {
    const report = await validateWorkspace(FIXTURES['all-question-types'], fixtureResolver);
    for (const t of QUESTION_TYPES) expect(report.summary.questions[t], t).toBeGreaterThan(0);
    const json = JSON.stringify(FIXTURES['all-question-types']);
    for (const b of RENDERABLE_BLOCK_TYPES) expect(json, b).toContain(`"type":"${b}"`);
  });
  it('ai-foundations is bilingual with a warning-free summary', async () => {
    const report = await validateWorkspace(FIXTURES['ai-foundations'], fixtureResolver, { publish: true });
    expect(report.summary.languages).toEqual(['vi', 'en']);
    expect(report.summary.items).toEqual({ lesson: 2, exam: 1, assignment: 1 });
    expect(report.warnings.filter((w) => w.code !== 'W_EXTERNAL_MEDIA')).toEqual([]);
  });
});

describe('invalid fixtures', () => {
  for (const f of INVALID_FIXTURES) {
    it(`${f.name} → ${f.expect.join(', ')}`, async () => {
      const report = await validateWorkspace(f.workspace, fixtureResolver, { publish: true });
      const codes = [...report.errors, ...report.warnings].map((d) => d.code);
      for (const c of f.expect) expect(codes, JSON.stringify(codes)).toContain(c);
    });
  }
});
