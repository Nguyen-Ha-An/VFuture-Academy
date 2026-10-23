import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseService: vi.fn(),
  supabaseUser: vi.fn(),
}));

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import { InMemoryResolver } from '@/content-engine/validate';
import { actorPermissionCheck, bankFiltersFromUrl, createBankService, type BankDatabase } from '@/features/bank/service';

const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const question = (id = 'bank-question') => ({
  id, type: 'single_choice', content: rich('Which answer?'),
  options: [{ id: 'a', content: rich('A') }, { id: 'b', content: rich('B') }],
  correctAnswer: 'a', difficulty: 'easy', tags: ['ai'],
});
const bundle = (questions = [question()]) => ({
  schemaVersion: 1, kind: 'question_bundle', id: 'bank-import', languages: ['vi', 'en'], defaultLanguage: 'vi', questions,
});

type Result = { data: unknown; error: { code?: string; message?: string; details?: string | null } | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly result: Result) {}
  select(value: string) { this.calls.push(['select', value]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  overlaps(column: string, value: string[]) { this.calls.push(['overlaps', column, value]); return this; }
  in(column: string, value: string[]) { this.calls.push(['in', column, value]); return this; }
  update(value: Record<string, unknown>) { this.calls.push(['update', value]); return this; }
  order(column: string, options?: unknown) { this.calls.push(['order', column, options]); return this; }
  limit(value: number) { this.calls.push(['limit', value]); return this; }
  range(from: number, to: number) { this.calls.push(['range', from, to]); return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return Promise.resolve(this.result).then(onfulfilled, onrejected); }
}

class DatabaseStub implements BankDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];
  readonly rpcCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  constructor(private readonly results: Record<string, Result[]>) {}
  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? { data: null, error: null });
    this.queries.push({ table, query });
    return query;
  }
  rpc(name: string, args?: Record<string, unknown>) {
    this.rpcCalls.push([name, args]);
    return Promise.resolve(this.results[`rpc:${name}`]?.shift() ?? { data: null, error: null });
  }
}

const actor: Actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };
const allowed = async () => actor;

describe('question bank service', () => {
  it('treats the server filter form all-options as absent filters', () => {
    expect(bankFiltersFromUrl('http://localhost/studio/bank?type=all&difficulty=all&status=all&tags=')).toEqual({});
  });

  it('validates a standalone question without writing a version', async () => {
    const database = new DatabaseStub({});
    const requirePermission = vi.fn().mockResolvedValue(actor);
    const service = createBankService({ database, requirePermission });

    await expect(service.validate(question())).resolves.toEqual({ valid: true });
    expect(requirePermission).toHaveBeenCalledWith('bank.edit');
    expect(database.queries).toEqual([]);
    expect(database.rpcCalls).toEqual([]);
  });

  it('validates question media assets with the injected resolver', async () => {
    const database = new DatabaseStub({});
    const withAsset = {
      ...question(),
      content: { blocks: [{ type: 'image', src: { assetId: 'question-image' }, alt: 'Diagram' }] },
    };
    const service = createBankService({
      database,
      requirePermission: allowed,
      resolver: new InMemoryResolver({ assets: ['question-image'] }),
    });

    await expect(service.validate(withAsset)).resolves.toEqual({ valid: true });
    expect(database.queries).toEqual([]);
  });

  it('returns standalone validation issues without writing a version', async () => {
    const database = new DatabaseStub({});
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.validate({ ...question(), correctAnswer: 'missing' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_QUESTION',
      issues: expect.any(Array),
    });
    expect(database.queries).toEqual([]);
    expect(database.rpcCalls).toEqual([]);
  });

  it('imports a validated bundle atomically with draft version one and learner-safe renders', async () => {
    const database = new DatabaseStub({ 'rpc:studio_bank_import_bundle': [{ data: [{ id: 'bank-question', version: 1 }], error: null }] });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.importBundle(bundle())).resolves.toEqual([{ id: 'bank-question', version: 1 }]);
    expect(database.rpcCalls).toHaveLength(1);
    const [name, args] = database.rpcCalls[0];
    expect(name).toBe('studio_bank_import_bundle');
    expect(args?.p_actor_id).toBe('editor-1');
    const row = (args?.p_questions as Array<Record<string, unknown>>)[0];
    expect(row.version).toBe(1);
    expect(row.renders).toMatchObject({ vi: { id: 'bank-question' }, en: { id: 'bank-question' } });
    expect(JSON.stringify(row.renders)).not.toContain('correctAnswer');
    expect(row.grading).toMatchObject({ correctAnswer: 'a' });
  });

  it('does not write any rows when an imported bundle fails engine validation', async () => {
    const database = new DatabaseStub({});
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.importBundle(bundle([{ ...question(), correctAnswer: 'missing' }]))).rejects.toMatchObject({ status: 400, code: 'INVALID_DOCUMENT' });
    expect(database.rpcCalls).toEqual([]);
    expect(database.queries).toEqual([]);
  });

  it('rejects every duplicated question id in a bundle before writing', async () => {
    const database = new DatabaseStub({});
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.importBundle(bundle([
      question('first-question'),
      question('second-question'),
      question('first-question'),
      question('second-question'),
    ]))).rejects.toMatchObject({
      status: 400,
      code: 'DUPLICATE_QUESTION_IDS',
      issues: [
        { path: ['questions', 'first-question'], message: 'Question id is duplicated in this bundle' },
        { path: ['questions', 'second-question'], message: 'Question id is duplicated in this bundle' },
      ],
    });
    expect(database.rpcCalls).toEqual([]);
  });

  it('returns a conflict with every id reported by a colliding bundle import', async () => {
    const database = new DatabaseStub({
      'rpc:studio_bank_import_bundle': [{
        data: null,
        error: {
          code: 'P2001',
          message: 'BANK_QUESTION_EXISTS',
          details: '["first-question","second-question"]',
        },
      }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.importBundle(bundle([
      question('first-question'),
      question('second-question'),
    ]))).rejects.toMatchObject({
      status: 409,
      code: 'BANK_QUESTION_EXISTS',
      issues: [
        { path: ['questions', 'first-question'], message: 'Question id already exists' },
        { path: ['questions', 'second-question'], message: 'Question id already exists' },
      ],
    });
  });

  it('creates a stable next version through the atomic version procedure', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', languages: ['en'], status: 'published', current_version_id: 'version-1' }, error: null }],
      'rpc:studio_bank_create_version_guarded': [{ data: { id: 'version-2', version: 2 }, error: null }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.update('bank-question', question(), 'version-1')).resolves.toEqual({ id: 'version-2', versionId: 'version-2', version: 2 });
    expect(database.rpcCalls).toEqual([['studio_bank_create_version_guarded', expect.objectContaining({
      p_question_id: 'bank-question',
      p_actor_id: 'editor-1',
      p_expected_version_id: 'version-1',
      p_renders: { en: expect.objectContaining({ id: 'bank-question' }) },
    })]]);
    expect(Object.keys(database.rpcCalls[0][1]?.p_renders as object)).toEqual(['en']);
  });

  it('rejects edits to an archived question before creating a version', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', languages: ['vi'], status: 'archived' }, error: null }],
      'rpc:studio_bank_create_version': [{ data: { id: 'version-2', version: 2 }, error: null }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.update('bank-question', question(), 'version-1')).rejects.toMatchObject({
      status: 409, code: 'BANK_QUESTION_ARCHIVED',
    });
    expect(database.rpcCalls).toEqual([]);
  });

  it('maps a concurrent archive during version creation to a conflict', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', languages: ['vi'], status: 'draft' }, error: null }],
      'rpc:studio_bank_create_version_guarded': [{ data: null, error: { code: 'P2002', message: 'BANK_QUESTION_ARCHIVED' } }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.update('bank-question', question(), 'version-1')).rejects.toMatchObject({
      status: 409, code: 'BANK_QUESTION_ARCHIVED',
    });
  });

  it('rejects an update whose document id differs from the route id before writing', async () => {
    const database = new DatabaseStub({});
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.update('bank-question', question('other-question'), 'version-1')).rejects.toMatchObject({ status: 400, code: 'ID_MISMATCH' });
    expect(database.rpcCalls).toEqual([]);
  });

  it('refuses to publish a question with unsupported renderer settings', async () => {
    const database = new DatabaseStub({ bank_questions: [{ data: { id: 'bank-question', status: 'draft', languages: ['vi'], type: 'single_choice' }, error: null }], bank_question_versions: [{ data: { payload: { ...question(), display: { interactionType: 'unknown' } } }, error: null }] });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.publish('bank-question')).rejects.toMatchObject({ status: 400, code: 'PUBLISH_VALIDATION_FAILED' });
    expect(database.queries.some(({ query }) => query.calls.some(([name]) => name === 'update'))).toBe(false);
  });

  it('publishes the latest validated version without returning grading data', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', status: 'draft', languages: ['vi', 'en'], type: 'single_choice' }, error: null }],
      bank_question_versions: [{ data: { id: 'version-1', payload: question() }, error: null }],
      'rpc:studio_bank_publish': [{ data: { id: 'bank-question', status: 'published', current_version_id: 'version-1' }, error: null }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.publish('bank-question')).resolves.toEqual({ id: 'bank-question', status: 'published', currentVersionId: 'version-1' });
    expect(database.rpcCalls).toEqual([['studio_bank_publish', {
      p_question_id: 'bank-question', p_version_id: 'version-1', p_actor_id: 'editor-1',
    }]]);
  });

  it('rejects publication of an archived question before loading its version', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', status: 'archived', languages: ['vi'], type: 'single_choice' }, error: null }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.publish('bank-question')).rejects.toMatchObject({
      status: 409, code: 'BANK_QUESTION_ARCHIVED',
    });
    expect(database.rpcCalls).toEqual([]);
    expect(database.queries).toHaveLength(1);
  });

  it('maps a concurrent archive during publish to a conflict', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', status: 'draft', languages: ['vi'], type: 'single_choice' }, error: null }],
      bank_question_versions: [{ data: { id: 'version-1', payload: question() }, error: null }],
      'rpc:studio_bank_publish': [{ data: null, error: { code: 'P2002', message: 'BANK_QUESTION_ARCHIVED' } }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.publish('bank-question')).rejects.toMatchObject({
      status: 409, code: 'BANK_QUESTION_ARCHIVED',
    });
  });

  it('returns a conflict when a newer version wins the publish race', async () => {
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', status: 'published', languages: ['vi'], type: 'single_choice' }, error: null }],
      bank_question_versions: [{ data: { id: 'version-1', payload: question() }, error: null }],
      'rpc:studio_bank_publish': [{ data: null, error: { code: '40001', message: 'bank question version changed during publish' } }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.publish('bank-question')).rejects.toMatchObject({
      status: 409, code: 'BANK_VERSION_CONFLICT', message: 'Question changed during publish; refresh and retry',
    });
  });

  it('returns question metadata and the latest editable version', async () => {
    const latest = { id: 'version-2', version: 2, payload: question(), renders: { vi: { id: 'bank-question' } }, grading: { correctAnswer: 'a' }, created_at: '2026-09-02T00:00:00Z' };
    const database = new DatabaseStub({
      bank_questions: [{ data: { id: 'bank-question', type: 'single_choice', tags: ['ai'], difficulty: 'easy', status: 'draft', languages: ['vi'], current_version_id: 'version-1' }, error: null }],
      bank_question_versions: [{ data: latest, error: null }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.get('bank-question')).resolves.toEqual({
      id: 'bank-question', type: 'single_choice', tags: ['ai'], difficulty: 'easy', status: 'draft', languages: ['vi'], currentVersionId: 'version-1', latestVersion: latest,
    });
    expect(database.queries[1].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'question_id', 'bank-question'],
      ['order', 'version', { ascending: false }],
      ['limit', 1],
    ]));
  });

  it('applies safe filters and returns only bank metadata', async () => {
    const database = new DatabaseStub({ bank_questions: [{ data: [{ id: 'bank-question', type: 'single_choice', tags: ['ai'], difficulty: 'easy', status: 'published' }], error: null }] });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.list({ tags: ['ai'], difficulties: ['easy'], types: ['single_choice'], status: 'published' }))
      .resolves.toEqual([{ id: 'bank-question', type: 'single_choice', tags: ['ai'], difficulty: 'easy', status: 'published' }]);
    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([['overlaps', 'tags', ['ai']], ['in', 'difficulty', ['easy']], ['in', 'type', ['single_choice']], ['eq', 'status', 'published']]));
    expect(database.queries[0].query.calls).toContainEqual(['range', 0, 49]);
  });

  it('paginates bank metadata in fixed server-side pages of 50', async () => {
    const database = new DatabaseStub({ bank_questions: [{ data: [], error: null }] });
    const service = createBankService({ database, requirePermission: allowed });

    await service.list({ page: 3 });

    expect(database.queries[0].query.calls).toContainEqual(['range', 100, 149]);
  });

  it('returns usage references without leaking course source documents', async () => {
    const database = new DatabaseStub({ 'rpc:studio_bank_question_usages': [{ data: [{ version_id: 'course-version-1', item_id: 'lesson-1', course_id: 'course-1' }], error: null }] });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.usages('bank-question')).resolves.toEqual([{ versionId: 'course-version-1', itemId: 'lesson-1', courseId: 'course-1' }]);
    expect(database.rpcCalls).toEqual([['studio_bank_question_usages', { p_question_id: 'bank-question' }]]);
  });

  it('loads usage counts for many questions with one permission check and one RPC', async () => {
    const database = new DatabaseStub({
      'rpc:studio_bank_question_usages_batch': [{
        data: [
          { question_id: 'first-question', version_id: 'course-version-1', item_id: 'lesson-1', course_id: 'course-1' },
          { question_id: 'first-question', version_id: 'course-version-2', item_id: 'exam-1', course_id: 'course-2' },
          { question_id: 'second-question', version_id: 'course-version-1', item_id: 'lesson-1', course_id: 'course-1' },
        ],
        error: null,
      }],
    });
    const requirePermission = vi.fn().mockResolvedValue(actor);
    const service = createBankService({ database, requirePermission });

    const result = await service.usagesMany(['first-question', 'second-question', 'third-question']);

    expect(result.get('first-question')).toHaveLength(2);
    expect(result.get('second-question')).toHaveLength(1);
    expect(result.get('third-question')).toEqual([]);
    expect(requirePermission).toHaveBeenCalledTimes(1);
    expect(database.rpcCalls).toEqual([[
      'studio_bank_question_usages_batch',
      { p_question_ids: ['first-question', 'second-question', 'third-question'] },
    ]]);
  });

  it('handles scalar-heavy pooled sources without returning their filter payload', async () => {
    const source = {
      title: 'Scalar sibling',
      required: true,
      selection: { $pool: { from: ['bank:bank-question'], filter: { tags: ['ai'], difficulty: 'easy' } } },
    };
    const database = new DatabaseStub({
      'rpc:studio_bank_question_usages': [{
        data: [{ version_id: 'course-version-1', item_id: 'lesson-1', course_id: 'course-1', source }],
        error: null,
      }],
    });
    const service = createBankService({ database, requirePermission: allowed });

    await expect(service.usages('bank-question')).resolves.toEqual([
      { versionId: 'course-version-1', itemId: 'lesson-1', courseId: 'course-1' },
    ]);
  });

  it('denies service access before any database operation when permission is absent', async () => {
    const database = new DatabaseStub({});
    const service = createBankService({ database, requirePermission: async () => { throw new ApiError(403, 'FORBIDDEN', 'Permission denied'); } });

    await expect(service.list({})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(database.queries).toEqual([]);
  });

  it('denies a route-injected actor that lacks the service permission', async () => {
    const database = new DatabaseStub({});
    const contributor: Actor = {
      userId: 'contributor-1',
      roles: [{ role: 'contributor', branchId: null }],
    };
    const service = createBankService({
      database,
      requirePermission: actorPermissionCheck(contributor),
    });

    await expect(service.list({})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(database.queries).toEqual([]);
  });
});
