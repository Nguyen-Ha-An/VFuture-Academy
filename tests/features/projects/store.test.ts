import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(), supabaseUser: vi.fn() }));

import {
  createProjectService,
  createSupabaseProjectStore,
  type ProjectDatabase,
  type ProjectMember,
  type ProjectRecord,
} from '@/features/projects/service';

type Result = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };

class Query implements PromiseLike<Result> {
  readonly calls: Array<[string, ...unknown[]]> = [];
  constructor(private readonly result: Result) {}
  select(value: string, options?: unknown) { this.calls.push(['select', value, options]); return this; }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this; }
  gte(column: string, value: unknown) { this.calls.push(['gte', column, value]); return this; }
  in(column: string, value: unknown[]) { this.calls.push(['in', column, value]); return this; }
  insert(value: unknown) { this.calls.push(['insert', value]); return this; }
  update(value: unknown) { this.calls.push(['update', value]); return this; }
  delete() { this.calls.push(['delete']); return this; }
  upsert(value: unknown, options?: unknown) { this.calls.push(['upsert', value, options]); return this; }
  order(column: string, options?: unknown) { this.calls.push(['order', column, options]); return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class Database implements ProjectDatabase {
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

const project: ProjectRecord = {
  id: 'climate-lab',
  title: { vi: 'Khí hậu', en: 'Climate lab' },
  summary: { vi: 'Dự án', en: 'Project' },
  status: 'active',
  outputLinks: [],
  skills: ['data-literacy'],
  courseIds: ['ai-foundations'],
  ownerId: '00000000-0000-4000-8000-000000000001',
  coverAssetId: 'asset_cover',
  approved: true,
  branchScope: { scope: 'branches', branchIds: ['branch-b'] },
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
};
const row = {
  id: project.id,
  title: project.title,
  summary: project.summary,
  status: project.status,
  output_links: [],
  skills: project.skills,
  course_ids: project.courseIds,
  owner_id: project.ownerId,
  cover_asset_id: project.coverAssetId,
  approved: true,
  branch_scope: project.branchScope,
  created_at: project.createdAt,
  updated_at: project.updatedAt,
};
const members: ProjectMember[] = [{
  userId: project.ownerId,
  role: 'owner',
  displayName: null,
  handle: null,
}];

describe('Supabase project store', () => {
  it('uses the CMS draft revision as the project editor acknowledgement', async () => {
    const database = new Database({
      'rpc:cms_get_editor_content': [{ data: { has_draft: true, revision_key: '2026-09-03 01:00:00+00', source: { record: row } }, error: null }],
      'rpc:cms_save_content_draft': [{ data: { revision_key: '2026-09-03 02:00:00+00' }, error: null }],
    });
    const store = createSupabaseProjectStore(database);

    await expect(store.findReviewDraft(project.ownerId, project.id)).resolves.toMatchObject({ updatedAt: '2026-09-03T01:00:00.000Z' });
    await expect(store.saveReviewDraft(project.ownerId, project, members, project.updatedAt)).resolves.toMatchObject({ updatedAt: '2026-09-03T02:00:00.000Z' });
  });

  it('preserves database branch scope so service-role reads cannot leak cross-branch projects', async () => {
    const database = new Database({
      projects: [{ data: [row], error: null }],
      profiles: [{ data: { branch_id: 'branch-a' }, error: null }],
    });
    const service = createProjectService({
      store: createSupabaseProjectStore(database),
      authorize: async () => ({ userId: project.ownerId, roles: [] }),
    });

    await expect(service.list('00000000-0000-4000-8000-000000000002', {})).resolves.toEqual([]);
    expect(database.queries.find(({ table }) => table === 'projects')?.query.calls[0][1]).toContain('branch_scope');
  });

  it('drops malformed project branch scopes instead of treating them as global', async () => {
    const database = new Database({
      projects: [{ data: [{ ...row, branch_scope: { scope: 'branches' } }], error: null }],
      profiles: [{ data: { branch_id: 'branch-a' }, error: null }],
    });
    const service = createProjectService({
      store: createSupabaseProjectStore(database),
      authorize: async () => ({ userId: project.ownerId, roles: [] }),
    });

    await expect(service.list('00000000-0000-4000-8000-000000000002', {})).resolves.toEqual([]);
  });

  it('filters related course metadata against the viewer branch access scope', async () => {
    const database = new Database({
      courses: [{ data: [{ id: 'ai-foundations', current_version_id: 'version-1' }], error: null }],
      course_version_outline: [{ data: [{
        version_id: 'version-1',
        meta: { title: { en: 'AI Foundations' } },
        access: { scope: 'branches', branchIds: ['branch-b'] },
      }], error: null }],
    });

    await expect(createSupabaseProjectStore(database).listCourses(['ai-foundations'], 'branch-a')).resolves.toEqual([]);
  });

  it('uses one database RPC for project and membership replacement', async () => {
    const database = new Database({ 'rpc:studio_project_save_guarded': [{ data: row, error: null }] });

    await expect(createSupabaseProjectStore(database).updateProject(project.ownerId, project, members, project.updatedAt)).resolves.toEqual(project);
    expect(database.rpcCalls).toEqual([['studio_project_save_guarded', expect.objectContaining({
      p_create: false,
      p_expected_revision: project.updatedAt,
      p_members: [{ user_id: project.ownerId, role: 'owner' }],
    })]]);
    expect(database.queries).toEqual([]);
  });

  it('maps the atomic update missing-project signal to a public 404', async () => {
    const database = new Database({
      'rpc:studio_project_save_guarded': [{ data: null, error: { code: 'P0002', message: 'PROJECT_NOT_FOUND' } }],
    });

    await expect(createSupabaseProjectStore(database).updateProject(project.ownerId, project, members, project.updatedAt))
      .rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
  });

  it('passes the service-owned proposal window and limit to the atomic limiter RPC', async () => {
    const database = new Database({ 'rpc:learner_project_propose': [{ data: row, error: null }] });

    await createSupabaseProjectStore(database).createProposal(
      { ...project, approved: false, status: 'idea' },
      members,
      '2026-09-03T00:00:00.000Z',
      5,
    );

    expect(database.rpcCalls).toEqual([['learner_project_propose', expect.objectContaining({
      p_since: '2026-09-03T00:00:00.000Z',
      p_limit: 5,
    })]]);
  });

  it('orders project memberships by creation time in the executed query chain', async () => {
    const database = new Database({
      project_members: [{ data: [{ user_id: project.ownerId, role: 'owner' }], error: null }],
      profiles: [{ data: [{ id: project.ownerId, display_name: 'Owner', handle: 'owner' }], error: null }],
    });

    await createSupabaseProjectStore(database).listMembers(project.id);

    const memberQuery = database.queries.find(({ table }) => table === 'project_members')?.query;
    expect(memberQuery?.calls).toContainEqual(['order', 'created_at', { ascending: true }]);
  });

  it('loads only the viewer project roles used for private participation', async () => {
    const database = new Database({
      project_members: [{ data: [
        { project_id: 'climate-lab', role: 'member' },
        { project_id: 'research-lab', role: 'mentor' },
      ], error: null }],
    });

    await expect(createSupabaseProjectStore(database).listViewerMemberships(project.ownerId)).resolves.toEqual([
      { projectId: 'climate-lab', role: 'member' },
      { projectId: 'research-lab', role: 'mentor' },
    ]);
    expect(database.queries[0]?.query.calls).toContainEqual(['eq', 'user_id', project.ownerId]);
  });

  it('loads Studio content media and learner project covers as cover candidates only', async () => {
    const database = new Database({
      media_assets: [
        { data: { id: 'asset_cover', owner_id: project.ownerId, mime: 'image/png', purpose: 'project_cover' }, error: null },
        { data: { id: 'asset_avatar', owner_id: project.ownerId, mime: 'image/png', purpose: 'avatar' }, error: null },
      ],
    });
    const store = createSupabaseProjectStore(database);

    await expect(store.findMediaAsset('asset_cover')).resolves.toEqual({ id: 'asset_cover', ownerId: project.ownerId, mime: 'image/png', purpose: 'project_cover' });
    expect(database.queries[0]?.query.calls).toContainEqual(['eq', 'bucket', 'media']);
    expect(database.queries[0]?.query.calls).toContainEqual(['in', 'purpose', ['content', 'project_cover']]);
    await expect(store.findMediaAsset('asset_avatar')).resolves.toBeNull();
  });

  it('maps the serialized proposal quota signal to a public rate-limit error', async () => {
    const database = new Database({
      'rpc:learner_project_propose': [{ data: null, error: { code: 'P0001', message: 'PROJECT_PROPOSAL_LIMIT' } }],
    });

    await expect(createSupabaseProjectStore(database).createProposal(
      { ...project, approved: false, status: 'idea' },
      members,
      '2026-09-03T00:00:00.000Z',
      5,
    )).rejects.toMatchObject({ status: 429, code: 'PROJECT_PROPOSAL_LIMIT' });
  });
});
