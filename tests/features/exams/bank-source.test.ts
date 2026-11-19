import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { SupabaseBankSource } from '@/features/exams/bank-source';
import type { BankDatabase } from '@/features/exams/bank-source';
import { drawPools } from '@/features/exams/pools';
import type { Scope } from '@/lib/authorization';

type Result = { data: unknown; error: unknown | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly result: Result) {}
  select(columns: string) { this.calls.push(['select', columns]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  is(column: string, value: null) { this.calls.push(['is', column, value]); return this; }
  or(filters: string) { this.calls.push(['or', filters]); return this; }
  in(column: string, value: unknown[]) { this.calls.push(['in', column, value]); return this; }
  overlaps(column: string, value: string[]) { this.calls.push(['overlaps', column, value]); return this; }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class DatabaseStub implements BankDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];
  constructor(private readonly results: Record<string, Result[]>) {}
  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? { data: null, error: null });
    this.queries.push({ table, query });
    return query;
  }
}

describe('SupabaseBankSource', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only published questions pinned to their current compiled versions', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: [{
        id: 'question-one', status: 'published', current_version_id: '00000000-0000-4000-8000-000000000001',
        ownership_kind: 'central', owner_branch_id: null,
      }], error: null }],
      bank_question_versions: [{ data: [{
        id: '00000000-0000-4000-8000-000000000001', question_id: 'question-one',
        grading: { id: 'question-one', type: 'single_choice', points: 1, correctAnswer: 'a' },
        renders: { en: { id: 'question-one', type: 'single_choice' } },
      }], error: null }],
    });
    mocks.supabaseService.mockReturnValue(database);
    const source = new SupabaseBankSource();

    await expect(source.listPublished({ courseOwner: { kind: 'central' }, from: ['bank:question-one'] })).resolves.toEqual([{
      id: 'question-one',
      versionId: '00000000-0000-4000-8000-000000000001',
      grading: { id: 'question-one', type: 'single_choice', points: 1, correctAnswer: 'a' },
      renders: { en: { id: 'question-one', type: 'single_choice' } },
    }]);
    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['eq', 'ownership_kind', 'central'],
      ['is', 'owner_branch_id', null],
      ['in', 'id', ['question-one']],
    ]));
    expect(database.queries[1].query.calls).toContainEqual([
      'in', 'id', ['00000000-0000-4000-8000-000000000001'],
    ]);
  });

  it('translates pool filters to indexed bank metadata predicates', async () => {
    const database = new DatabaseStub({ bank_questions: [{ data: [], error: null }] });
    mocks.supabaseService.mockReturnValue(database);
    const source = new SupabaseBankSource();

    await expect(source.listPublished({ courseOwner: { kind: 'branch', branchId: 'school-a' }, filter: {
      tags: ['ai'], difficulty: ['medium'], types: ['single_choice'],
    } })).resolves.toEqual([]);

    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['or', 'and(ownership_kind.eq.central,owner_branch_id.is.null),and(ownership_kind.eq.branch,owner_branch_id.eq."school-a")'],
      ['overlaps', 'tags', ['ai']],
      ['in', 'difficulty', ['medium']],
      ['in', 'type', ['single_choice']],
    ]));
    expect(database.queries).toHaveLength(1);
  });

  const owners = [
    { id: 'central', ownership_kind: 'central', owner_branch_id: null },
    { id: 'same-school', ownership_kind: 'branch', owner_branch_id: 'school-a' },
    { id: 'other-school', ownership_kind: 'branch', owner_branch_id: 'school-b' },
    { id: 'missing-owner', ownership_kind: 'branch', owner_branch_id: null },
    { id: 'invalid-central', ownership_kind: 'central', owner_branch_id: 'school-a' },
  ];

  describe.each([
    { courseOwner: { kind: 'central' }, expected: ['central'] },
    { courseOwner: { kind: 'branch', branchId: 'school-a' }, expected: ['central', 'same-school'] },
  ] satisfies { courseOwner: Scope; expected: string[] }[])('for a $courseOwner.kind course', ({ courseOwner, expected }) => {
    it.each([
      { filter: { tags: ['course-topic'] } },
      { from: owners.map(({ id }) => `bank:${id}`) },
    ])('loads versions only for eligible questions for selection %j', async (selection) => {
      const database = new DatabaseStub({
        bank_questions: [{ data: owners.map((owner) => ({ ...owner, current_version_id: `v-${owner.id}` })), error: null }],
        bank_question_versions: [{ data: owners.map(({ id }) => ({ id: `v-${id}`, question_id: id, grading: {}, renders: {} })), error: null }],
      });
      const source = new SupabaseBankSource(database);

      const questions = await source.listPublished({ courseOwner, ...selection });

      expect(questions.map(({ id }) => id)).toEqual(expected);
      expect(database.queries[1].query.calls).toContainEqual(['in', 'id', expected.map((id) => `v-${id}`)]);
    });
  });

  it.each([
    { from: ['bank:other-school'] },
    { filter: { tags: ['course-topic'] } },
  ])('reports an unsatisfiable pool without loading an ineligible version for %j', async (selection) => {
    const database = new DatabaseStub({
      bank_questions: [{ data: [{
        id: 'other-school', current_version_id: 'other-version', ownership_kind: 'branch', owner_branch_id: 'school-b',
      }], error: null }],
    });
    const pool = { id: 'practice', sectionId: 'unit', count: 1, ...selection };
    const sections = [{ id: 'unit', questionIds: [], pools: [pool] }];

    await expect(drawPools(sections, new SupabaseBankSource(database), 'attempt', { kind: 'branch', branchId: 'school-a' }))
      .rejects.toMatchObject({ code: 'POOL_UNSATISFIABLE', details: { sectionId: 'unit', required: 1, available: 0 } });
    expect(database.queries.map(({ table }) => table)).toEqual(['bank_questions']);
  });
});
