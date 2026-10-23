import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SupabaseResolver, type SupabaseQueryClient } from '@/features/studio/resolver';

type Result = { data: unknown; error: { message: string } | null };

class QueryStub implements PromiseLike<Result> {
  readonly filters: Array<[string, ...unknown[]]> = [];

  constructor(readonly table: string, private readonly result: Result) {}

  select(columns: string) { this.filters.push(['select', columns]); return this; }
  eq(column: string, value: unknown) { this.filters.push(['eq', column, value]); return this; }
  overlaps(column: string, values: string[]) { this.filters.push(['overlaps', column, values]); return this; }
  in(column: string, values: string[]) { this.filters.push(['in', column, values]); return this; }
  not(column: string, operator: string, value: unknown) { this.filters.push(['not', column, operator, value]); return this; }
  async maybeSingle() { return this.result; }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class SupabaseStub implements SupabaseQueryClient {
  readonly queries: QueryStub[] = [];

  constructor(private readonly results: Record<string, Result[]>) {}

  from(table: string) {
    const result = this.results[table]?.shift() ?? { data: null, error: null };
    const query = new QueryStub(table, result);
    this.queries.push(query);
    return query;
  }
}

function successful(data: unknown): Result {
  return { data, error: null };
}

describe('SupabaseResolver', () => {
  it('resolves a published bank question from its current version payload', async () => {
    const client = new SupabaseStub({
      bank_questions: [successful({ ownership_kind: 'central', owner_branch_id: null, id: 'bank-1', type: 'single_choice', tags: ['ai'], difficulty: 'easy', current_version_id: 'version-1' })],
      bank_question_versions: [successful({ id: 'version-1', payload: { ownership_kind: 'central', owner_branch_id: null, id: 'bank-1', type: 'single_choice' } })],
    });

    const question = await new SupabaseResolver(client).bankQuestion('bank-1');

    expect(question).toEqual({
      id: 'bank-1', versionId: 'version-1', question: { ownership_kind: 'central', owner_branch_id: null, id: 'bank-1', type: 'single_choice' }, tags: ['ai'], difficulty: 'easy', type: 'single_choice',
    });
    expect(client.queries[0].filters).toContainEqual(['eq', 'status', 'published']);
    expect(client.queries[1].filters).toContainEqual(['eq', 'question_id', 'bank-1']);
  });

  it('rejects foreign bank answers before reading their version payload', async () => {
    const client = new SupabaseStub({
      courses: [successful({ ownership_kind: 'branch', owner_branch_id: 'school-a' })],
      bank_questions: [successful({ id: 'foreign', ownership_kind: 'branch', owner_branch_id: 'school-b', current_version_id: 'secret', type: 'single_choice' })],
      bank_question_versions: [successful({ id: 'secret', payload: { correctAnswer: 'secret' } })],
    });
    await expect(new SupabaseResolver(client, { courseId: 'course-a' }).bankQuestion('foreign')).resolves.toBeNull();
    expect(client.queries.map((query) => query.table)).not.toContain('bank_question_versions');
  });

  it('limits pools to central and persisted course-owned banks', async () => {
    const client = new SupabaseStub({
      courses: [successful({ ownership_kind: 'branch', owner_branch_id: 'school-a' })],
      bank_questions: [successful([
        { id: 'central', ownership_kind: 'central', owner_branch_id: null },
        { id: 'own', ownership_kind: 'branch', owner_branch_id: 'school-a' },
        { id: 'foreign', ownership_kind: 'branch', owner_branch_id: 'school-b' },
      ])],
    });
    await expect(new SupabaseResolver(client, { courseId: 'course-a' }).bankCandidates({})).resolves.toEqual(['central', 'own']);
  });

  it.each([
    ['central', null, 'central', null, true],
    ['branch', 'school-a', 'central', null, true],
    ['branch', 'school-a', 'branch', 'school-a', true],
    ['central', null, 'branch', 'school-a', false],
    ['branch', 'school-a', 'branch', 'school-b', false],
    ['branch', 'school-a', undefined, undefined, false],
  ])('resolves explicit banks according to persisted course %s/%s and bank %s/%s', async (courseKind, courseBranch, bankKind, bankBranch, allowed) => {
    const client = new SupabaseStub({
      courses: [successful({ ownership_kind: courseKind, owner_branch_id: courseBranch })],
      bank_questions: [successful({ id: 'bank-1', ownership_kind: bankKind, owner_branch_id: bankBranch, current_version_id: 'version-1', type: 'true_false' })],
      bank_question_versions: [successful({ id: 'version-1', payload: { id: 'bank-1', type: 'true_false', correctAnswer: true } })],
    });
    const result = await new SupabaseResolver(client, { courseId: 'course-a' }).bankQuestion('bank-1');
    expect(result !== null).toBe(allowed);
    expect(client.queries.some((query) => query.table === 'bank_question_versions')).toBe(allowed);
  });

  it('does not grant branch-bank access without a persisted course owner', async () => {
    const client = new SupabaseStub({ bank_questions: [successful([{ id: 'foreign', ownership_kind: 'branch', owner_branch_id: 'school-b' }])] });
    await expect(new SupabaseResolver(client).bankCandidates({})).resolves.toEqual([]);
  });

  it('reports course ownership lookup outages rather than treating them as missing references', async () => {
    const client = new SupabaseStub({ courses: [{ data: null, error: { message: 'offline' } }] });
    await expect(new SupabaseResolver(client, { courseId: 'course-a' }).bankQuestion('bank-1'))
      .rejects.toMatchObject({ name: 'ResolverUnavailableError' });
    expect(client.queries).toHaveLength(1);
  });

  it('returns no bank question when the published record has no current version', async () => {
    const client = new SupabaseStub({
      bank_questions: [successful({ ownership_kind: 'central', owner_branch_id: null, id: 'bank-1', type: 'single_choice', tags: [], difficulty: null, current_version_id: null })],
    });

    await expect(new SupabaseResolver(client).bankQuestion('bank-1')).resolves.toBeNull();
    expect(client.queries).toHaveLength(1);
  });

  it('applies tag overlap, difficulty, and type filters to published current bank candidates', async () => {
    const client = new SupabaseStub({ bank_questions: [successful([{ id: 'bank-1', ownership_kind: 'central', owner_branch_id: null }, { id: 'bank-2', ownership_kind: 'central', owner_branch_id: null }])] });

    await expect(new SupabaseResolver(client).bankCandidates({ tags: ['ai', 'prompting'], difficulty: ['easy'], types: ['single_choice'] }))
      .resolves.toEqual(['bank-1', 'bank-2']);

    expect(client.queries[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['not', 'current_version_id', 'is', null],
      ['overlaps', 'tags', ['ai', 'prompting']],
      ['in', 'difficulty', ['easy']],
      ['in', 'type', ['single_choice']],
    ]));
  });

  it.each([
    [{ tags: ['not a tag'] }, 'tags'],
    [{ difficulty: ['legendary'] }, 'difficulty'],
    [{ types: ['select *'] }, 'types'],
  ])('rejects invalid bank candidate %s before building a database filter', async (filter, _field) => {
    const client = new SupabaseStub({});

    await expect(new SupabaseResolver(client).bankCandidates(filter)).rejects.toBeDefined();
    expect(client.queries).toEqual([]);
  });

  it('returns the authenticated media route and mime for an asset', async () => {
    const client = new SupabaseStub({ media_assets: [successful({ id: 'asset/one', mime: 'application/pdf' })] });

    await expect(new SupabaseResolver(client).asset('asset/one')).resolves.toEqual({
      id: 'asset/one', url: '/api/v1/media/asset%2Fone', mime: 'application/pdf',
    });
  });

  it('accepts only published resources and opportunities as reference targets', async () => {
    const client = new SupabaseStub({
      resources: [successful({ id: 'guide-1' })],
      opportunities: [successful(null)],
    });
    const resolver = new SupabaseResolver(client);

    await expect(new SupabaseResolver(client).resourceExists('guide-1')).resolves.toBe(true);
    await expect(resolver.opportunityExists('opportunity-1')).resolves.toBe(false);
    expect(client.queries.slice(0, 2).map((query) => query.table)).toEqual(['resources', 'opportunities']);
    expect(client.queries[0].filters).toContainEqual(['eq', 'status', 'published']);
    expect(client.queries[1].filters).toContainEqual(['eq', 'status', 'published']);
  });

  it('returns false for a branch that does not exist', async () => {
    const client = new SupabaseStub({ branches: [successful(null)] });

    await expect(new SupabaseResolver(client).branchExists('missing-branch')).resolves.toBe(false);
    expect(client.queries[0].filters).toContainEqual(['eq', 'id', 'missing-branch']);
  });
});
