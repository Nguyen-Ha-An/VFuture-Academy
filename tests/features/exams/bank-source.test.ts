import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { SupabaseBankSource } from '@/features/exams/bank-source';
import type { BankDatabase } from '@/features/exams/bank-source';

type Result = { data: unknown; error: unknown | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly result: Result) {}
  select(columns: string) { this.calls.push(['select', columns]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
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
      }], error: null }],
      bank_question_versions: [{ data: [{
        id: '00000000-0000-4000-8000-000000000001', question_id: 'question-one',
        grading: { id: 'question-one', type: 'single_choice', points: 1, correctAnswer: 'a' },
        renders: { en: { id: 'question-one', type: 'single_choice' } },
      }], error: null }],
    });
    mocks.supabaseService.mockReturnValue(database);
    const source = new SupabaseBankSource();

    await expect(source.listPublished({ from: ['bank:question-one'] })).resolves.toEqual([{
      id: 'question-one',
      versionId: '00000000-0000-4000-8000-000000000001',
      grading: { id: 'question-one', type: 'single_choice', points: 1, correctAnswer: 'a' },
      renders: { en: { id: 'question-one', type: 'single_choice' } },
    }]);
    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
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

    await expect(source.listPublished({ filter: {
      tags: ['ai'], difficulty: ['medium'], types: ['single_choice'],
    } })).resolves.toEqual([]);

    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['overlaps', 'tags', ['ai']],
      ['in', 'difficulty', ['medium']],
      ['in', 'type', ['single_choice']],
    ]));
    expect(database.queries).toHaveLength(1);
  });
});
