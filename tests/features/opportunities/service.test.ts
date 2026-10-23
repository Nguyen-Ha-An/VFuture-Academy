import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import {
  OpportunityFormSchema,
  createOpportunityService,
  opportunityFiltersFromUrl,
  selectRecommendedOpportunity,
  type OpportunityDatabase,
} from '@/features/opportunities/service';
import { opportunityAvailability, requiredCourseEligibility } from '@/features/opportunities/availability';
import type { Actor } from '@/lib/permissions';

type Result = { data: unknown; error: unknown | null; count?: number | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];

  constructor(private readonly result: Result) {}

  select(value: string, options?: unknown) { this.calls.push(options === undefined ? ['select', value] : ['select', value, options]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  in(column: string, value: unknown[]) { this.calls.push(['in', column, value]); return this; }
  or(value: string) { this.calls.push(['or', value]); return this; }
  not(column: string, operator: string, value: string) { this.calls.push(['not', column, operator, value]); return this; }
  lte(column: string, value: unknown) { this.calls.push(['lte', column, value]); return this; }
  order(column: string, options?: unknown) { this.calls.push(['order', column, options]); return this; }
  limit(value: number) { this.calls.push(['limit', value]); return this; }
  range(from: number, to: number) { this.calls.push(['range', from, to]); return this; }
  upsert(value: unknown, options?: unknown) { this.calls.push(['upsert', value, options]); return this; }
  insert(value: unknown) { this.calls.push(['insert', value]); return this; }
  update(value: unknown) { this.calls.push(['update', value]); return this; }
  delete() { this.calls.push(['delete']); return this; }
  single() { return Promise.resolve(this.result); }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class DatabaseStub implements OpportunityDatabase {
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
    return this.rpcResults.shift() ?? { data: { id: 'ai-internship', status: 'published' }, error: null };
  }
}

const actor: Actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };
const requirePermission = vi.fn(async () => actor);
const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const opportunity = (overrides: Record<string, unknown> = {}) => ({
  id: 'ai-internship',
  title: { vi: 'Thuc tap AI', en: 'AI internship' },
  organization: 'VFuture',
  type: 'external_program',
  description: { vi: rich('Mo ta'), en: rich('Description') },
  eligibility: {},
  recommendedSkills: ['ai'],
  recommendedCourses: ['ai-foundations'],
  requiredCourses: [],
  applicationUrl: 'https://example.com/apply',
  internalApplication: false,
  openAt: '2026-01-01T00:00:00.000Z',
  closeAt: '2026-12-31T00:00:00.000Z',
  startAt: null,
  endAt: null,
  location: 'Ho Chi Minh City',
  online: false,
  branchScope: { scope: 'global' },
  featured: true,
  ...overrides,
});

describe('opportunity form validation', () => {
  it('rejects non-HTTPS application links and reversed date ranges', () => {
    const parsed = OpportunityFormSchema.safeParse(opportunity({
      applicationUrl: 'http://example.com/apply',
      closeAt: '2025-01-01T00:00:00.000Z',
    }));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(expect.arrayContaining([
        'applicationUrl',
        'closeAt',
      ]));
    }
  });
});

describe('opportunity service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds one combined branch/open filter and a counted, stable 50-row page', async () => {
    const database = new DatabaseStub({ opportunities: [{ data: [], error: null, count: 123 }] });
    const service = createOpportunityService({ database, requirePermission });
    const now = new Date('2026-09-03T00:00:00.000Z');

    await expect(service.listPage(
      { type: 'external_program', openNow: true, featured: true, page: 2 },
      { userId: 'learner-1', branchId: 'branch-one', locale: 'en', now },
    )).resolves.toEqual({ items: [], total: 123, page: 2, pageSize: 50 });

    expect(database.queries[0].query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'published'],
      ['eq', 'type', 'external_program'],
      ['eq', 'featured', true],
      ['select', '*', { count: 'exact' }],
      ['or', `and(or(branch_scope->>scope.eq.global,branch_scope->branchIds.cs.["branch-one"]),or(open_at.is.null,open_at.lte.${now.toISOString()}),or(close_at.is.null,close_at.gte.${now.toISOString()}))`],
      ['range', 50, 99],
      ['order', 'id', { ascending: true }],
    ]));
    expect(database.queries[0].query.calls.filter(([method]) => method === 'or')).toHaveLength(1);
  });

  describe('internal fixture guard', () => {
    afterEach(() => vi.unstubAllEnvs());
    const context = { userId: 'learner-1', branchId: null, locale: 'en' as const, now: new Date('2026-09-03T00:00:00.000Z') };
    const notCalls = (database: DatabaseStub, table: string) => database.queries
      .find((entry) => entry.table === table)?.query.calls.filter(([method]) => method === 'not');

    it('adds no predicate while HIDE_INTERNAL_CONTENT is unset', async () => {
      const database = new DatabaseStub({ opportunities: [{ data: [], error: null, count: 0 }, { data: [], error: null }] });
      const service = createOpportunityService({ database, requirePermission });
      await service.listPage({}, context);
      await service.recommended(context);
      expect(database.queries.filter(({ table }) => table === 'opportunities').flatMap(({ query }) => query.calls.filter(([method]) => method === 'not'))).toEqual([]);
    });

    it('excludes fixtures from the counted list and the home recommendation', async () => {
      vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
      const database = new DatabaseStub({ opportunities: [{ data: [], error: null, count: 0 }] });
      await createOpportunityService({ database, requirePermission }).listPage({}, context);
      expect(notCalls(database, 'opportunities')).toEqual([['not', 'id', 'like', 'recovery-%']]);

      const home = new DatabaseStub({ opportunities: [{ data: [], error: null }] });
      await createOpportunityService({ database: home, requirePermission }).recommended(context);
      expect(notCalls(home, 'opportunities')).toEqual([['not', 'id', 'like', 'recovery-%']]);
    });
  });

  it('stores a published opportunity edit as a separate draft', async () => {
    const database = new DatabaseStub({
      opportunities: [{ data: {
        id: 'ai-internship', status: 'published', published_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
      }, error: null }],
    }, [{ data: { id: 'ai-internship', status: 'draft', revision_key: '2026-09-08 12:00:00.123456+00', live_status: 'published' }, error: null }]);
    const service = createOpportunityService({
      database,
      requirePermission,
    });

    await expect(service.saveDraft(opportunity())).resolves.toMatchObject({ status: 'draft', live_status: 'published' });
    expect(database.queries).toHaveLength(1);
    expect(database.rpcs).toEqual([{ name: 'cms_save_content_draft', args: expect.objectContaining({
      p_actor_user_id: actor.userId,
      p_content_type: 'opportunity',
      p_content_id: 'ai-internship',
      p_expected_revision: '2026-09-01T00:00:00.000Z',
      p_source: { record: expect.objectContaining({ id: 'ai-internship' }) },
    }) }]);
  });

  it('reloads the pending opportunity draft revision instead of the live row', async () => {
    const live = opportunity();
    const pending = opportunity({ organization: 'Pending organization' });
    const liveRow = {
      id: live.id, title: live.title, organization: live.organization, type: live.type,
      description: live.description, eligibility: live.eligibility, recommended_skills: live.recommendedSkills,
      recommended_courses: live.recommendedCourses, required_courses: live.requiredCourses,
      application_url: live.applicationUrl, internal_application: live.internalApplication,
      open_at: live.openAt, close_at: live.closeAt, start_at: live.startAt, end_at: live.endAt,
      location: live.location, online: live.online, branch_scope: live.branchScope, featured: live.featured,
      status: 'published', published_at: '2026-09-01T00:00:00.000Z', updated_at: 'live-revision',
    };
    const pendingRow = { ...liveRow, organization: pending.organization };
    const database = new DatabaseStub({ opportunities: [{ data: liveRow, error: null }] }, [{ data: {
      has_draft: true, revision_key: '2026-09-08 12:00:00.123456+00', source: { record: pendingRow },
    }, error: null }]);

    await expect(createOpportunityService({ database, requirePermission }).getStudio(live.id)).resolves.toMatchObject({
      organization: 'Pending organization', status: 'draft', updated_at: '2026-09-08T12:00:00.123456Z',
      published_at: '2026-09-01T00:00:00.000Z',
    });
  });

  it('delegates publish auditing to the atomic CMS transaction', async () => {
    const stored = opportunity();
    const database = new DatabaseStub({
      opportunities: [
        { data: {
          id: stored.id,
          title: stored.title,
          organization: stored.organization,
          type: stored.type,
          description: stored.description,
          eligibility: stored.eligibility,
          recommended_skills: stored.recommendedSkills,
          recommended_courses: stored.recommendedCourses,
          required_courses: stored.requiredCourses,
          application_url: stored.applicationUrl,
          internal_application: stored.internalApplication,
          open_at: stored.openAt,
          close_at: stored.closeAt,
          start_at: stored.startAt,
          end_at: stored.endAt,
          location: stored.location,
          online: stored.online,
          branch_scope: stored.branchScope,
          featured: stored.featured,
          status: 'draft',
        }, error: null },
        { data: { id: stored.id, status: 'published', published_at: '2026-09-03T00:00:00.000Z' }, error: null },
      ],
    });
    const service = createOpportunityService({ database, requirePermission });

    await service.publish(stored.id);

    expect(database.rpcs[0]).toMatchObject({ name: 'cms_publish_content' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('publishes through the atomic CMS review transaction', async () => {
    const current = opportunity();
    const revision = '2026-09-05T01:00:00.000Z';
    const database = new DatabaseStub({ opportunities: [{ data: {
      id: current.id, title: current.title, organization: current.organization, type: current.type,
      description: current.description, eligibility: current.eligibility,
      recommended_skills: current.recommendedSkills, recommended_courses: current.recommendedCourses,
      required_courses: current.requiredCourses, application_url: current.applicationUrl,
      internal_application: current.internalApplication, open_at: current.openAt, close_at: current.closeAt,
      start_at: current.startAt, end_at: current.endAt, location: current.location, online: current.online,
      branch_scope: current.branchScope, featured: current.featured, status: 'draft', updated_at: revision,
    }, error: null }] }, [{ data: { id: current.id, status: 'published' }, error: null }]);
    const service = createOpportunityService({ database, requirePermission });

    await service.publish(current.id, { document: current, expectedUpdatedAt: revision });

    expect(database.rpcs).toEqual([{ name: 'cms_publish_content', args: {
      p_actor_user_id: actor.userId,
      p_content_type: 'opportunity',
      p_content_id: current.id,
      p_revision_key: revision,
    } }]);
    expect(database.queries.flatMap(({ query }) => query.calls).some(([name]) => name === 'update')).toBe(false);
  });

  it('publishes the current form with CAS and preserves the original published timestamp', async () => {
    const current = opportunity({ organization: 'Current form organization' });
    const database = new DatabaseStub({
      opportunities: [
        { data: {
          id: current.id,
          status: 'published',
          published_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-05T01:00:00.000Z',
        }, error: null },
        { data: {
          id: current.id, status: 'published', published_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-05T02:00:00.000Z',
        }, error: null },
      ],
    });
    const service = createOpportunityService({ database, requirePermission });

    await service.publish(current.id, {
      document: current,
      expectedUpdatedAt: '2026-09-05T01:00:00.000Z',
    });

    expect(database.rpcs[0]).toEqual({ name: 'cms_publish_content', args: expect.objectContaining({
      p_revision_key: '2026-09-05T01:00:00.000Z',
    }) });
  });

  it('treats an exact published current-form replay as idempotent', async () => {
    const current = opportunity({ organization: 'Already published' });
    const row = {
      id: current.id, title: current.title, organization: current.organization, type: current.type,
      description: current.description, eligibility: current.eligibility,
      recommended_skills: current.recommendedSkills, recommended_courses: current.recommendedCourses,
      required_courses: current.requiredCourses, application_url: current.applicationUrl,
      internal_application: current.internalApplication, open_at: current.openAt, close_at: current.closeAt,
      start_at: current.startAt, end_at: current.endAt, location: current.location, online: current.online,
      branch_scope: current.branchScope, featured: current.featured, status: 'published',
      published_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-05T02:00:00.000Z',
    };
    const database = new DatabaseStub({ opportunities: [{ data: row, error: null }] });
    const service = createOpportunityService({ database, requirePermission });

    await expect(service.publish(current.id, {
      document: current,
      expectedUpdatedAt: '2026-09-05T01:00:00.000Z',
    })).resolves.toEqual(row);
    expect(database.queries).toHaveLength(1);
  });

  it('does not overwrite an opportunity created after the seed missing-state lookup', async () => {
    const expected = opportunity();
    const competing = opportunity({ title: { vi: 'Ban khac', en: 'Competing draft' } });
    const database = new DatabaseStub({
      opportunities: [
        { data: { ...competing, status: 'draft' }, error: null },
        { data: { id: expected.id, status: 'draft' }, error: null },
      ],
    });
    const service = createOpportunityService({ database, requirePermission });
    const createOnly = service.saveDraft as unknown as (
      raw: unknown,
      options: { createOnly: true },
    ) => Promise<unknown>;

    await expect(createOnly(expected, { createOnly: true })).rejects.toMatchObject({
      status: 409,
      code: 'OPPORTUNITY_DRAFT_CONFLICT',
    });
    expect(database.queries).toHaveLength(1);
  });

  it('does not overwrite an opportunity that wins the create-only insert race', async () => {
    const expected = opportunity();
    const competing = opportunity({ title: { vi: 'Ban khac', en: 'Competing draft' } });
    const database = new DatabaseStub({
      opportunities: [
        { data: null, error: null },
        { data: null, error: { code: '23505' } },
        { data: { ...competing, status: 'draft' }, error: null },
      ],
    });
    const service = createOpportunityService({ database, requirePermission });
    const createOnly = service.saveDraft as unknown as (
      raw: unknown,
      options: { createOnly: true },
    ) => Promise<unknown>;

    await expect(createOnly(expected, { createOnly: true })).rejects.toMatchObject({
      status: 409,
      code: 'OPPORTUNITY_DRAFT_CONFLICT',
    });
    expect(database.queries[1].query.calls).toContainEqual(['insert', expect.objectContaining({ id: expected.id })]);
    expect(database.queries.flatMap(({ query }) => query.calls).some(([method]) => method === 'upsert')).toBe(false);
  });

  it('refuses guarded publication when the opportunity changed after the seed state check', async () => {
    const expected = opportunity();
    const changed = opportunity({ title: { vi: 'Da sua', en: 'Edited' } });
    const database = new DatabaseStub({
      opportunities: [{ data: {
        ...changed,
        recommended_skills: changed.recommendedSkills,
        recommended_courses: changed.recommendedCourses,
        required_courses: changed.requiredCourses,
        application_url: changed.applicationUrl,
        internal_application: changed.internalApplication,
        open_at: changed.openAt,
        close_at: changed.closeAt,
        start_at: changed.startAt,
        end_at: changed.endAt,
        branch_scope: changed.branchScope,
        status: 'draft',
        updated_at: '2026-09-05T01:00:00.000Z',
      }, error: null }],
    });
    const service = createOpportunityService({ database, requirePermission });
    const guardedPublish = service.publish as unknown as (
      id: string,
      options: { expectedDraft: typeof expected },
    ) => Promise<unknown>;

    await expect(guardedPublish(expected.id, { expectedDraft: expected })).rejects.toMatchObject({
      status: 409,
      code: 'OPPORTUNITY_DRAFT_CONFLICT',
    });
    expect(database.queries).toHaveLength(1);
  });

  it('fails guarded publication when PostgreSQL reports a stale reviewed revision', async () => {
    const expected = opportunity();
    const updatedAt = '2026-09-05T01:00:00.000Z';
    const row = {
      id: expected.id,
      title: expected.title,
      organization: expected.organization,
      type: expected.type,
      description: expected.description,
      eligibility: expected.eligibility,
      recommended_skills: expected.recommendedSkills,
      recommended_courses: expected.recommendedCourses,
      required_courses: expected.requiredCourses,
      application_url: expected.applicationUrl,
      internal_application: expected.internalApplication,
      open_at: expected.openAt,
      close_at: expected.closeAt,
      start_at: expected.startAt,
      end_at: expected.endAt,
      location: expected.location,
      online: expected.online,
      branch_scope: expected.branchScope,
      featured: expected.featured,
      status: 'draft',
      updated_at: updatedAt,
    };
    const database = new DatabaseStub({
      opportunities: [
        { data: row, error: null },
      ],
    }, [{ data: null, error: { message: 'CMS_STALE_REVIEW' } }]);
    const service = createOpportunityService({ database, requirePermission });
    const guardedPublish = service.publish as unknown as (
      id: string,
      options: { expectedDraft: typeof expected },
    ) => Promise<unknown>;

    await expect(guardedPublish(expected.id, { expectedDraft: expected })).rejects.toMatchObject({
      status: 409,
      code: 'OPPORTUNITY_DRAFT_CONFLICT',
    });
    expect(database.rpcs[0]).toMatchObject({ name: 'cms_publish_content' });
  });

  it('localizes direct title and rich-content values allowed by the schema', async () => {
    const database = new DatabaseStub({ opportunities: [{ data: [{
      id: 'direct-content', title: 'Direct title', organization: 'VFuture', type: 'event',
      description: rich('Direct description'), recommended_courses: [], status: 'published', featured: false,
    }], error: null }] });
    const service = createOpportunityService({ database, requirePermission });

    await expect(service.list({}, { userId: 'learner-1', branchId: null, locale: 'en' })).resolves.toMatchObject([{
      id: 'direct-content', title: 'Direct title', description: rich('Direct description'),
    }]);
  });

  it('drops a stored application URL unless it is HTTPS', async () => {
    const database = new DatabaseStub({ opportunities: [{ data: [{
      id: 'unsafe-link', title: 'Unsafe', organization: 'VFuture', type: 'event',
      description: rich('Description'), recommended_courses: [], status: 'published', featured: false,
      application_url: 'javascript:alert(1)', internal_application: false,
    }], error: null }] });
    const service = createOpportunityService({ database, requirePermission });

    await expect(service.list({}, { userId: 'learner-1', branchId: null, locale: 'en' }))
      .resolves.toMatchObject([{ id: 'unsafe-link', applicationUrl: null }]);
  });

  it('sets interest idempotently with an upsert and explicit removal', async () => {
    const database = new DatabaseStub({
      opportunities: [
        { data: { id: 'ai-internship', internal_application: true, status: 'published' }, error: null },
        { data: { id: 'ai-internship', internal_application: true, status: 'published' }, error: null },
      ],
      opportunity_interest: [
        { data: { opportunity_id: 'ai-internship', user_id: 'learner-1' }, error: null },
        { data: null, error: null },
      ],
    });
    const service = createOpportunityService({ database, requirePermission });
    const context = { userId: 'learner-1', branchId: null, locale: 'en' as const };

    await expect(service.setInterest('ai-internship', true, context)).resolves.toEqual({ interested: true });
    await expect(service.setInterest('ai-internship', false, context)).resolves.toEqual({ interested: false });

    const interestQueries = database.queries.filter(({ table }) => table === 'opportunity_interest');
    expect(interestQueries[0].query.calls).toContainEqual([
      'upsert',
      { opportunity_id: 'ai-internship', user_id: 'learner-1', updated_at: expect.any(String) },
      { onConflict: 'opportunity_id,user_id' },
    ]);
    expect(interestQueries[1].query.calls).toContainEqual(['delete']);
  });

  it('keeps internal interest as a bookmark outside application windows and course eligibility', async () => {
    const database = new DatabaseStub({
      opportunities: [{ data: {
        id: 'future-cohort', internal_application: true, status: 'published',
        open_at: '2027-01-01T00:00:00.000Z', required_courses: ['prerequisite'],
      }, error: null }],
      opportunity_interest: [{ data: { opportunity_id: 'future-cohort', user_id: 'learner-1' }, error: null }],
    });
    const service = createOpportunityService({ database, requirePermission });

    await expect(service.setInterest('future-cohort', true, {
      userId: 'learner-1', branchId: null, locale: 'en', now: new Date('2026-09-05T00:00:00.000Z'),
    })).resolves.toEqual({ interested: true });

    expect(database.queries.map(({ table }) => table)).toEqual(['opportunities', 'opportunity_interest']);
  });

  it('rejects invalid page filters', () => {
    expect(() => opportunityFiltersFromUrl('https://academy.example/opportunities?page=0')).toThrow();
  });

  it('treats empty URL filters as absent', () => {
    expect(opportunityFiltersFromUrl('https://academy.example/opportunities?type=&openNow=true&featured=&page=')).toEqual({ openNow: true });
    expect(() => opportunityFiltersFromUrl('https://academy.example/opportunities?featured=maybe')).toThrow();
  });

  it('loads completed courses and returns the intersecting featured opportunity', async () => {
    const database = new DatabaseStub({
      enrollments: [{ data: [{ course_id: 'ai-foundations', status: 'completed' }], error: null }],
      opportunities: [{ data: [
        {
          id: 'fallback', title: { en: 'Fallback' }, organization: 'VFuture', type: 'event',
          description: { en: rich('Fallback') }, recommended_courses: [], status: 'published', featured: true,
        },
        {
          id: 'matched', title: { en: 'Matched' }, organization: 'VFuture', type: 'event',
          description: { en: rich('Matched') }, recommended_courses: ['ai-foundations'], status: 'published', featured: true,
        },
      ], error: null }],
    });
    const service = createOpportunityService({ database, requirePermission });

    await expect(service.recommended({ userId: 'learner-1', branchId: null, locale: 'en', now: new Date('2026-09-03T00:00:00.000Z') }))
      .resolves.toMatchObject({ id: 'matched' });
    expect(database.queries.find(({ table }) => table === 'enrollments')?.query.calls).toContainEqual(['eq', 'status', 'completed']);
  });
});

describe('recommended opportunity selection', () => {
  const rows = [
    { id: 'featured-fallback', status: 'published', featured: true, openAt: null, closeAt: null, recommendedCourses: [] },
    { id: 'matched', status: 'published', featured: true, openAt: null, closeAt: null, recommendedCourses: ['ai-foundations'] },
    { id: 'closed', status: 'published', featured: true, openAt: null, closeAt: '2026-01-01T00:00:00.000Z', recommendedCourses: ['ai-foundations'] },
  ];

  it('prefers an open featured opportunity intersecting completed courses', () => {
    expect(selectRecommendedOpportunity(rows, ['ai-foundations'], new Date('2026-09-03T00:00:00.000Z'))?.id).toBe('matched');
  });

  it('falls back to the first open featured opportunity', () => {
    expect(selectRecommendedOpportunity(rows, ['other-course'], new Date('2026-09-03T00:00:00.000Z'))?.id).toBe('featured-fallback');
  });
});

describe('opportunity availability and eligibility', () => {
  const openAt = '2026-09-05T01:00:00.000Z';
  const closeAt = '2026-09-05T02:00:00.000Z';

  it('uses the established inclusive open and close boundaries', () => {
    expect(opportunityAvailability(openAt, closeAt, new Date('2026-09-05T00:59:59.999Z'))).toBe('upcoming');
    expect(opportunityAvailability(openAt, closeAt, new Date(openAt))).toBe('open');
    expect(opportunityAvailability(openAt, closeAt, new Date(closeAt))).toBe('open');
    expect(opportunityAvailability(openAt, closeAt, new Date('2026-09-05T02:00:00.001Z'))).toBe('closed');
  });

  it('requires every declared course while treating an empty requirement as eligible', () => {
    expect(requiredCourseEligibility([], new Map())).toEqual({ eligible: true, incompleteCourseIds: [] });
    expect(requiredCourseEligibility(['course-a', 'course-b'], new Map([
      ['course-a', 'completed'], ['course-b', 'active'],
    ]))).toEqual({ eligible: false, incompleteCourseIds: ['course-b'] });
  });
});

it('saves another published-opportunity draft against CMS revision and returns updated_at', async () => {
  const db = new DatabaseStub({ opportunities: [{ data: { id: 'ai-internship', status: 'published', updated_at: 'live-revision' }, error: null }] }, [{ data: { id: 'ai-internship', status: 'draft', revision_key: '2026-09-08T12:00:00Z' }, error: null }]);
  const saved = await createOpportunityService({ database: db, requirePermission }).saveDraft(opportunity(), { expectedUpdatedAt: '2026-09-08T11:00:00.000123Z' });
  expect(db.rpcs[0]).toMatchObject({ name: 'cms_save_content_draft', args: { p_expected_revision: '2026-09-08T11:00:00.000123Z' } });
  expect(saved).toMatchObject({ id: 'ai-internship', status: 'draft', updated_at: '2026-09-08T12:00:00Z' });
  expect(db.queries).toHaveLength(1);
});
