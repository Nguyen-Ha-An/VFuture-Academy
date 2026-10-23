import { beforeAll, describe, expect, it } from 'vitest';
import { compileBankQuestion, compileCourse, type GradingItem } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import type { Locale } from '@/content-engine/schema/common';
import type { BankListQuery, BankSource } from '@/features/exams/types';
import { drawPools } from '@/features/exams/pools';

const locales: Locale[] = ['vi', 'en'];

const bank: BankSource = {
  async listPublished(query: BankListQuery) {
    const ids = 'from' in query
      ? query.from.map((ref) => ref.replace(/^bank:/, ''))
      : await fixtureResolver.bankCandidates(query.filter);
    const entries = await Promise.all(ids.map(async (id) => {
      const snapshot = await fixtureResolver.bankQuestion(id);
      if (!snapshot) return null;
      const compiled = await compileBankQuestion(snapshot.question as never, locales, 'vi');
      return { id, versionId: snapshot.versionId, grading: compiled.grading, renders: compiled.renders };
    }));
    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null).reverse();
  },
};

let sections: NonNullable<GradingItem['exam']>['sections'];

beforeAll(async () => {
  const result = await compileCourse(FIXTURES['ai-foundations'], fixtureResolver, { publish: true });
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  sections = result.compiled!.items['exam-m1'].grading.exam!.sections;
});

describe('drawPools', () => {
  it('is deterministic, creates section-composite ids, and excludes inline question ids', async () => {
    const first = await drawPools(sections, bank, 'attempt-42', ['s2/ai-basics-003']);
    const again = await drawPools(sections, bank, 'attempt-42', ['s2/ai-basics-003']);

    expect(first).toEqual(again);
    expect(first.s2).toHaveLength(2);
    expect(first.s2.map((question) => question.sourceId).sort()).toEqual(['ai-basics-004', 'ai-basics-005']);
    expect(first.s2.every((question) => question.id === `s2/${question.sourceId}`)).toBe(true);
    expect(first.s2.every((question) => question.grading.id === question.id)).toBe(true);
    expect(first.s2.every((question) => Object.values(question.renders).every((render) => (render as { id: string }).id === question.id))).toBe(true);
  });

  it('throws the typed pool error when exclusions leave too few published candidates', async () => {
    await expect(drawPools(sections, bank, 'attempt-42', [
      'ai-basics-003', 'ai-basics-004', 'ai-basics-005',
    ])).rejects.toMatchObject({ code: 'POOL_UNSATISFIABLE' });
  });

  it('never draws the same bank question into two sections of one attempt', async () => {
    const [candidate] = await bank.listPublished({ from: ['bank:ai-basics-003'] });
    const filter = structuredClone(sections.find((section) => section.pools.length)?.pools[0]?.filter);
    expect(candidate).toBeDefined();
    expect(filter).toBeDefined();
    const sharedSections = [
      {
        id: 'first',
        questionIds: [],
        pools: [{ id: 'first-pool', count: 1, filter: filter!, sectionId: 'first' }],
      },
      {
        id: 'second',
        questionIds: [],
        pools: [{ id: 'second-pool', count: 1, filter: filter!, sectionId: 'second' }],
      },
    ] as typeof sections;
    const oneQuestionBank: BankSource = {
      async listPublished() {
        return [candidate!];
      },
    };

    await expect(drawPools(sharedSections, oneQuestionBank, 'attempt-shared-filter'))
      .rejects.toMatchObject({ code: 'POOL_UNSATISFIABLE', details: { sectionId: 'second', available: 0 } });
  });
});
