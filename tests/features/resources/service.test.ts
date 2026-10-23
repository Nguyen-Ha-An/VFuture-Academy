import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import { InMemoryResolver } from '@/content-engine/validate';
import {
  createResourceService,
  resourceFiltersFromUrl,
  type ResourceDatabase,
} from '@/features/resources/service';
import type { Actor } from '@/lib/permissions';

type Result = { data: unknown; error: unknown | null; count?: number | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];

  constructor(private readonly result: Result) {}

  select(value: string, options?: unknown) { this.calls.push(options === undefined ? ['select', value] : ['select', value, options]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  contains(column: string, value: unknown) { this.calls.push(['contains', column, value]); return this; }
  or(value: string) { this.calls.push(['or', value]); return this; }
  not(column: string, operator: string, value: string) { this.calls.push(['not', column, operator, value]); return this; }
  textSearch(column: string, value: string, options?: unknown) { this.calls.push(['textSearch', column, value, options]); return this; }
  order(column: string, options?: unknown) { this.calls.push(['order', column, options]); return this; }
  limit(value: number) { this.calls.push(['limit', value]); return this; }
  range(from: number, to: number) { this.calls.push(['range', from, to]); return this; }
  upsert(value: unknown, options?: unknown) { this.calls.push(['upsert', value, options]); return this; }
  insert(value: unknown) { this.calls.push(['insert', value]); return this; }
  update(value: unknown) { this.calls.push(['update', value]); return this; }
  single() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class DatabaseStub implements ResourceDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];
  readonly rpcs: Array<{ name: string; args?: Record<string, unknown> }> = [];

  constructor(private readonly results: Record<string, Result[]>, private readonly rpcResults: Result[] = []) {}

  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? { data: null, error: null });
    this.queries.push({ table, query });
    return query;
  }

  async rpc(name: string, args?: Record<string, unknown>) {
    this.rpcs.push({ name, args });
    return this.rpcResults.shift() ?? { data: { id: 'prompting-guide', status: 'published' }, error: null };
  }
}

const actor: Actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };
const requirePermission = vi.fn(async (_permission?: unknown) => actor);
const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const resource = () => ({
  schemaVersion: 1,
  kind: 'resource',
  id: 'prompting-guide',
  languages: ['vi', 'en'],
  defaultLanguage: 'vi',
  title: { vi: 'Huong dan', en: 'Guide' },
  summary: { vi: 'Tom tat', en: 'Summary' },
  resourceType: 'guide',
  tags: ['ai'],
  pathways: ['ai-emerging-technology'],
  body: { vi: rich('Noi dung'), en: rich('Body') },
});

describe('resource service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to publish a stored resource containing an activity block', async () => {
    const invalid = resource() as Record<string, unknown>;
    invalid.body = {
      vi: { blocks: [{ id: 'quiz-one', type: 'quiz', questions: [] }] },
      en: { blocks: [{ id: 'quiz-one', type: 'quiz', questions: [] }] },
    };
    const database = new DatabaseStub({
      resources: [{ data: { id: 'prompting-guide', status: 'draft', document: invalid }, error: null }],
    });
    const service = createResourceService({ database, requirePermission });

    await expect(service.publish('prompting-guide')).rejects.toMatchObject({
      status: 400,
      code: 'PUBLISH_VALIDATION_FAILED',
      issues: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('content blocks') }),
      ]),
    });
    expect(database.queries).toHaveLength(1);
  });

  it('builds one branch-scope filter with typed filters and a 50-row page', async () => {
    const database = new DatabaseStub({ resources: [{ data: [], error: null }] });
    const service = createResourceService({ database, requirePermission });

    await service.list(
      { type: 'guide', tag: 'ai', pathway: 'ai-emerging-technology', search: 'prompt design', page: 2 },
      { branchId: 'branch-one', locale: 'en' },
    );

    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['eq', 'document->>resourceType', 'guide'],
      ['contains', 'document', { tags: ['ai'] }],
      ['contains', 'document', { pathways: ['ai-emerging-technology'] }],
      ['textSearch', 'search', 'prompt design', { config: 'simple', type: 'websearch' }],
      ['or', 'branch_scope->>scope.eq.global,branch_scope->branchIds.cs.["branch-one"]'],
      ['range', 50, 99],
    ]));
    expect(database.queries[0].query.calls.filter(([method]) => method === 'or')).toHaveLength(1);
  });

  it('saves a new validated resource as a global draft owned by the editor', async () => {
    const database = new DatabaseStub({
      resources: [
        { data: null, error: null },
        { data: { id: 'prompting-guide', status: 'draft' }, error: null },
      ],
    });
    const service = createResourceService({ database, requirePermission });

    await expect(service.saveDraft(resource())).resolves.toMatchObject({ id: 'prompting-guide', status: 'draft' });
    expect(requirePermission).toHaveBeenCalledWith('resource.edit');
    expect(database.queries[0].query.calls).toContainEqual([
      'select',
      'id,status,published_at,owner_id,document,updated_at,ownership_kind,owner_branch_id',
    ]);
    expect(database.queries[1].query.calls).toContainEqual([
      'insert',
      expect.objectContaining({
        id: 'prompting-guide',
        owner_id: 'editor-1',
        status: 'draft',
        published_at: null,
        branch_scope: { scope: 'global' },
      }),
    ]);
  });

  it('validates resource asset references with the injected resolver', async () => {
    const withAsset = resource() as ReturnType<typeof resource> & {
      attachments: Array<{ src: { assetId: string }; label: string }>;
    };
    withAsset.attachments = [{ src: { assetId: 'resource-image' }, label: 'Image' }];
    const database = new DatabaseStub({
      resources: [
        { data: null, error: null },
        { data: { id: 'prompting-guide', status: 'draft' }, error: null },
      ],
    });
    const service = createResourceService({
      database,
      requirePermission,
      resolver: new InMemoryResolver({ assets: ['resource-image'] }),
    });

    await expect(service.saveDraft(withAsset)).resolves.toMatchObject({ id: 'prompting-guide' });
  });

  it('does not overwrite owner_id when editing an existing draft', async () => {
    const database = new DatabaseStub({
      resources: [
        { data: { id: 'prompting-guide', status: 'draft', owner_id: 'owner-1', published_at: null }, error: null },
        { data: { id: 'prompting-guide', status: 'draft' }, error: null },
      ],
    });
    const service = createResourceService({ database, requirePermission });

    await service.saveDraft(resource());

    const update = database.queries[1].query.calls.find(([method]) => method === 'update');
    expect(update?.[1]).not.toHaveProperty('owner_id');
  });

  it('saves an edit of a published resource as a separate draft without demoting the live row', async () => {
    const database = new DatabaseStub({
      resources: [{
        data: { id: 'prompting-guide', status: 'published', owner_id: 'owner-1', published_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' },
        error: null,
      }],
    }, [{ data: { id: 'prompting-guide', status: 'draft', revision_key: '2026-09-08 12:00:00.123456+00', live_status: 'published' }, error: null }]);
    const service = createResourceService({
      database,
      requirePermission,
    });

    await expect(service.saveDraft(resource())).resolves.toMatchObject({
      status: 'draft',
      live_status: 'published',
    });
    expect(database.queries).toHaveLength(1);
    expect(database.rpcs).toEqual([{ name: 'cms_save_content_draft', args: expect.objectContaining({
      p_actor_user_id: actor.userId,
      p_content_type: 'resource',
      p_content_id: 'prompting-guide',
      p_expected_revision: '2026-09-01T00:00:00.000Z',
      p_source: { document: expect.objectContaining({ id: 'prompting-guide' }) },
    }) }]);
  });

  it('reloads the pending resource draft and its revision while retaining the live publication', async () => {
    const live = resource();
    const pending = { ...live, title: { vi: 'Bản nháp', en: 'Pending draft' } };
    const database = new DatabaseStub({ resources: [{ data: {
      id: live.id, document: live, status: 'published', owner_id: actor.userId,
      published_at: '2026-09-01T00:00:00.000Z', updated_at: 'live-revision',
    }, error: null }] }, [{ data: {
      has_draft: true, revision_key: '2026-09-08 12:00:00.123456+00', source: { document: pending },
    }, error: null }]);

    await expect(createResourceService({ database, requirePermission }).getStudio(live.id)).resolves.toMatchObject({
      document: pending,
      status: 'draft',
      updatedAt: '2026-09-08T12:00:00.123456Z',
      publishedAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('validates branch-scoped resource IDs with the resolver', async () => {
    const scoped = resource() as ReturnType<typeof resource> & {
      branchScope: { scope: 'branches'; branchIds: string[] };
    };
    scoped.branchScope = { scope: 'branches', branchIds: ['branch-one'] };
    const database = new DatabaseStub({
      resources: [
        { data: null, error: null },
        { data: { id: 'prompting-guide', status: 'draft' }, error: null },
      ],
    });
    const service = createResourceService({
      database,
      requirePermission,
      resolver: new InMemoryResolver({ branches: ['branch-one'] }),
    });

    await service.saveDraft(scoped);

    expect(database.queries[1].query.calls).toContainEqual([
      'insert',
      expect.objectContaining({ branch_scope: { scope: 'branches', branchIds: ['branch-one'] } }),
    ]);

    const invalidService = createResourceService({
      database: new DatabaseStub({ resources: [] }),
      requirePermission,
      resolver: new InMemoryResolver({ branches: [] }),
    });
    await expect(invalidService.saveDraft(scoped)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_RESOURCE',
      issues: [expect.objectContaining({ path: ['branchScope', 'branchIds', 0] })],
    });
  });

  it('delegates publish auditing and ownership preservation to the atomic database transaction', async () => {
    const database = new DatabaseStub({
      resources: [
        { data: { id: 'prompting-guide', status: 'draft', document: resource() }, error: null },
        { data: { id: 'prompting-guide', status: 'published', published_at: '2026-09-03T00:00:00.000Z' }, error: null },
      ],
    });
    const service = createResourceService({ database, requirePermission });

    await service.publish('prompting-guide');

    expect(database.rpcs[0]).toMatchObject({ name: 'cms_publish_content' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('uses the atomic CMS publication gate instead of updating the live row directly', async () => {
    const current = resource();
    const revision = '2026-09-05T01:00:00.000Z';
    const database = new DatabaseStub({ resources: [{ data: {
      id: current.id, document: current, status: 'draft', owner_id: actor.userId,
      published_at: null, updated_at: revision,
    }, error: null }] }, [{ data: { id: current.id, status: 'published' }, error: null }]);
    const service = createResourceService({ database, requirePermission });

    await service.publish(current.id, { document: current, expectedUpdatedAt: revision });

    expect(database.rpcs).toEqual([{ name: 'cms_publish_content', args: {
      p_actor_user_id: actor.userId,
      p_content_type: 'resource',
      p_content_id: current.id,
      p_revision_key: revision,
    } }]);
    expect(database.queries.flatMap(({ query }) => query.calls).some(([name]) => name === 'update')).toBe(false);
  });

  it('publishes the supplied current document atomically while keeping a published row public', async () => {
    const before = resource();
    const current = { ...before, title: { vi: 'Moi', en: 'Current editor title' } };
    const updatedAt = '2026-09-05T01:00:00.000Z';
    const publishedAt = '2026-09-01T00:00:00.000Z';
    const stored = { id: before.id, document: before, status: 'published', owner_id: 'owner-1', published_at: publishedAt, updated_at: updatedAt };
    const durable = { ...stored, document: current, updated_at: '2026-09-05T02:00:00.000Z' };
    const database = new DatabaseStub({ resources: [{ data: stored, error: null }, { data: durable, error: null }] });
    const service = createResourceService({ database, requirePermission });

    await expect(service.publish(before.id, { document: current, expectedUpdatedAt: updatedAt })).resolves.toMatchObject({
      status: 'published', document: current, publishedAt,
    });
    expect(requirePermission.mock.calls.map(([permission]) => permission)).toEqual(['resource.edit', 'resource.publish']);
    expect(database.rpcs[0]).toEqual({ name: 'cms_publish_content', args: expect.objectContaining({ p_revision_key: updatedAt }) });
  });

  it('returns a counted, stably ordered learner page', async () => {
    const database = new DatabaseStub({ resources: [{ data: [], error: null, count: 123 }] });
    const service = createResourceService({ database, requirePermission });
    await expect(service.listPage({ page: 2 }, { branchId: null, locale: 'en' })).resolves.toEqual({ items: [], total: 123, page: 2, pageSize: 50 });
    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['select', 'id,document,published_at', { count: 'exact' }],
      ['order', 'published_at', { ascending: false }], ['order', 'id', { ascending: true }], ['range', 50, 99],
    ]));
  });

  describe('internal fixture guard', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('leaves the learner list untouched while HIDE_INTERNAL_CONTENT is unset', async () => {
      const database = new DatabaseStub({ resources: [{ data: [], error: null, count: 0 }] });
      await createResourceService({ database, requirePermission }).listPage({}, { branchId: null, locale: 'en' });
      expect(database.queries[0].query.calls.filter(([method]) => method === 'not')).toEqual([]);
    });

    it('excludes fixtures in SQL so the counted total excludes them too', async () => {
      vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
      vi.stubEnv('INTERNAL_CONTENT_IDS', 'schema-stress');
      const database = new DatabaseStub({ resources: [{ data: [], error: null, count: 0 }] });
      await createResourceService({ database, requirePermission }).listPage({}, { branchId: null, locale: 'en' });
      expect(database.queries[0].query.calls.filter(([method]) => method === 'not')).toEqual([
        ['not', 'id', 'like', 'recovery-%'],
        ['not', 'id', 'in', '(schema-stress)'],
      ]);
    });
  });

  it('does not overwrite a resource created after the seed missing-state lookup', async () => {
    const expected = resource();
    const competing = { ...expected, title: { vi: 'Ban khac', en: 'Competing draft' } };
    const database = new DatabaseStub({
      resources: [
        { data: { id: expected.id, status: 'draft', document: competing }, error: null },
        { data: { id: expected.id, status: 'draft' }, error: null },
      ],
    });
    const service = createResourceService({ database, requirePermission });
    const createOnly = service.saveDraft as unknown as (
      raw: unknown,
      options: { createOnly: true },
    ) => Promise<unknown>;

    await expect(createOnly(expected, { createOnly: true })).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_DRAFT_CONFLICT',
    });
    expect(database.queries).toHaveLength(1);
  });

  it('does not overwrite a resource that wins the create-only insert race', async () => {
    const expected = resource();
    const competing = { ...expected, title: { vi: 'Ban khac', en: 'Competing draft' } };
    const database = new DatabaseStub({
      resources: [
        { data: null, error: null },
        { data: null, error: { code: '23505' } },
        { data: { id: expected.id, status: 'draft', document: competing }, error: null },
      ],
    });
    const service = createResourceService({ database, requirePermission });
    const createOnly = service.saveDraft as unknown as (
      raw: unknown,
      options: { createOnly: true },
    ) => Promise<unknown>;

    await expect(createOnly(expected, { createOnly: true })).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_DRAFT_CONFLICT',
    });
    expect(database.queries[1].query.calls).toContainEqual(['insert', expect.objectContaining({ id: expected.id })]);
    expect(database.queries.flatMap(({ query }) => query.calls).some(([method]) => method === 'upsert')).toBe(false);
  });

  describe('create replay ownership', () => {
    const document = () => ({ ...resource(), branchScope: { scope: 'global' } });
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 'prompting-guide', document: document(), status: 'draft', owner_id: actor.userId,
      ownership_kind: 'branch', owner_branch_id: 'school-a',
      updated_at: '2026-09-05T01:00:00.000Z', published_at: null, ...overrides,
    });
    const serviceFor = (database: DatabaseStub) => createResourceService({
      database, requirePermission, scope: { kind: 'branch', branchId: 'school-a' },
      resolver: new InMemoryResolver({}),
    });

    it.each([false, true])('rejects an identical foreign creator draft (insert race: %s)', async (race) => {
      const existing = { data: row({ owner_id: 'foreign-editor' }), error: null };
      const database = new DatabaseStub({ resources: race
        ? [{ data: null, error: null }, { data: null, error: { code: '23505' } }, existing]
        : [existing] });
      await expect(serviceFor(database).saveDraft(resource(), { createOnly: true }))
        .rejects.toMatchObject({ status: 409, code: 'RESOURCE_DRAFT_CONFLICT' });
    });

    it.each([false, true])('rejects creator replay in another workspace (insert race: %s)', async (race) => {
      const existing = { data: row({ owner_branch_id: 'school-b' }), error: null };
      const database = new DatabaseStub({ resources: race
        ? [{ data: null, error: null }, { data: null, error: { code: '23505' } }, existing]
        : [existing] });
      await expect(serviceFor(database).saveDraft(resource(), { createOnly: true }))
        .rejects.toMatchObject({ status: 409, code: 'RESOURCE_DRAFT_CONFLICT' });
    });

    it.each([false, true])('allows same creator and workspace retry (insert race: %s)', async (race) => {
      const existing = { data: row(), error: null };
      const database = new DatabaseStub({ resources: race
        ? [{ data: null, error: null }, { data: null, error: { code: '23505' } }, existing]
        : [existing] });
      await expect(serviceFor(database).saveDraft(resource(), { createOnly: true }))
        .resolves.toMatchObject({ id: 'prompting-guide' });
      expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('creates content and its workspace in the same insert', async () => {
      const database = new DatabaseStub({ resources: [{ data: null, error: null }, { data: row(), error: null }] });
      await expect(serviceFor(database).saveDraft(resource(), { createOnly: true })).resolves.toMatchObject({ id: 'prompting-guide' });
      expect(database.queries[1].query.calls).toContainEqual(['insert', expect.objectContaining({
        owner_id: actor.userId, ownership_kind: 'branch', owner_branch_id: 'school-a',
      })]);
      expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(actor, 'resource.create',
        { type: 'resource', id: 'prompting-guide' }, null,
        { status: 'draft', ownershipKind: 'branch', ownerBranchId: 'school-a' });
    });
  });

  it('refuses guarded publication when the resource changed after the seed state check', async () => {
    const expected = resource();
    const changed = { ...expected, title: { vi: 'Da sua', en: 'Edited' } };
    const database = new DatabaseStub({
      resources: [{ data: {
        id: expected.id,
        status: 'draft',
        updated_at: '2026-09-05T01:00:00.000Z',
        document: changed,
      }, error: null }],
    });
    const service = createResourceService({ database, requirePermission });
    const guardedPublish = service.publish as unknown as (
      id: string,
      options: { expectedDraft: typeof expected },
    ) => Promise<unknown>;

    await expect(guardedPublish(expected.id, { expectedDraft: expected })).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_DRAFT_CONFLICT',
    });
    expect(database.queries).toHaveLength(1);
  });

  it('fails guarded publication when PostgreSQL reports a stale reviewed revision', async () => {
    const expected = resource();
    const updatedAt = '2026-09-05T01:00:00.000Z';
    const database = new DatabaseStub({
      resources: [
        { data: { id: expected.id, status: 'draft', updated_at: updatedAt, document: expected }, error: null },
      ],
    }, [{ data: null, error: { message: 'CMS_STALE_REVIEW' } }]);
    const service = createResourceService({ database, requirePermission });
    const guardedPublish = service.publish as unknown as (
      id: string,
      options: { expectedDraft: typeof expected },
    ) => Promise<unknown>;

    await expect(guardedPublish(expected.id, { expectedDraft: expected })).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_DRAFT_CONFLICT',
    });
    expect(database.rpcs[0]).toMatchObject({ name: 'cms_publish_content' });
  });

  it('does not resume an archived resource as a matching draft', async () => {
    const expected = resource();
    const database = new DatabaseStub({
      resources: [{ data: {
        id: expected.id,
        status: 'archived',
        updated_at: '2026-09-05T01:00:00.000Z',
        document: expected,
      }, error: null }],
    });
    const service = createResourceService({ database, requirePermission });
    const guardedPublish = service.publish as unknown as (
      id: string,
      options: { expectedDraft: typeof expected },
    ) => Promise<unknown>;

    await expect(guardedPublish(expected.id, { expectedDraft: expected })).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_DRAFT_CONFLICT',
    });
    expect(database.queries).toHaveLength(1);
  });

  it('rejects invalid page filters', () => {
    expect(() => resourceFiltersFromUrl('https://academy.example/resources?page=0')).toThrow();
  });

  it('returns the requested locale with default-language fallback', async () => {
    const database = new DatabaseStub({
      resources: [{ data: { id: 'prompting-guide', status: 'published', document: resource() }, error: null }],
    });
    const service = createResourceService({ database, requirePermission });

    await expect(service.get('prompting-guide', { branchId: null, locale: 'en' })).resolves.toMatchObject({
      id: 'prompting-guide',
      title: 'Guide',
      summary: 'Summary',
      body: rich('Body'),
    });
  });
});

it('saves another published-resource draft using its CMS revision and returns a complete acknowledgment', async () => {
  const db = new DatabaseStub({ resources: [{ data: { id: 'prompting-guide', document: resource(), status: 'published', owner_id: actor.userId, published_at: '2026-09-01T00:00:00Z', updated_at: 'live-revision' }, error: null }] }, [{ data: { id: 'prompting-guide', status: 'draft', revision_key: '2026-09-08T12:00:00Z' }, error: null }]);
  const service = createResourceService({ database: db, requirePermission, resolver: new InMemoryResolver({}) });
  const saved = await service.saveDraft(resource(), { expectedUpdatedAt: '2026-09-08T11:00:00.000123Z' });
  expect(db.rpcs[0]).toMatchObject({ name: 'cms_save_content_draft', args: { p_expected_revision: '2026-09-08T11:00:00.000123Z' } });
  expect(saved).toMatchObject({ id: 'prompting-guide', status: 'draft', updatedAt: '2026-09-08T12:00:00Z', document: { id: 'prompting-guide' } });
  expect(db.queries).toHaveLength(1);
});
