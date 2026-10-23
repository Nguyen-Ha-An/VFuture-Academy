import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseService: vi.fn(),
  supabaseUser: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));

import { ApiError } from '@/lib/api';
import { BUILT_IN_ROLE_PERMISSIONS, type Actor, type Permission, type Scope } from '@/lib/permissions';
import {
  createProjectService,
  type ProjectCourse,
  type ProjectMediaAsset,
  type ProjectMember,
  type ProjectRecord,
  type ProjectStore,
} from '@/features/projects/service';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const EDITOR_ID = '00000000-0000-4000-8000-000000000003';

const proposal = (id = 'climate-lab') => ({
  id,
  title: { vi: 'Phòng thí nghiệm khí hậu', en: 'Climate lab' },
  summary: { vi: 'Một dự án dữ liệu khí hậu.', en: 'A climate data project.' },
  outputLinks: [{ label: { vi: 'Bản thử', en: 'Prototype' }, url: 'https://example.com/prototype' }],
  skills: ['data-literacy'],
  courseIds: ['ai-foundations'],
  coverAssetId: null,
  members: [],
});

const studioInput = (overrides: Record<string, unknown> = {}) => ({
  ...proposal(),
  status: 'idea',
  approved: true,
  expectedUpdatedAt: '2026-09-03T00:00:00.000Z',
  branchScope: { scope: 'global' },
  members: [{ userId: OWNER_ID, role: 'owner' }],
  ...overrides,
});

const project = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: 'climate-lab',
  title: { vi: 'Phòng thí nghiệm khí hậu', en: 'Climate lab' },
  summary: { vi: 'Một dự án dữ liệu khí hậu.', en: 'A climate data project.' },
  status: 'idea',
  outputLinks: [],
  skills: ['data-literacy'],
  courseIds: ['ai-foundations'],
  ownerId: OWNER_ID,
  coverAssetId: null,
  approved: true,
  branchScope: { scope: 'global' },
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  ...overrides,
});

class MemoryProjectStore implements ProjectStore {
  projects: ProjectRecord[];
  members = new Map<string, ProjectMember[]>();
  interests = new Map<string, Set<string>>();
  courses: ProjectCourse[] = [{ id: 'ai-foundations', title: { vi: 'AI nền tảng', en: 'AI Foundations' } }];
  viewed: Array<{ projectId: string; userId: string }> = [];
  viewerBranches = new Map<string, string | null>();
  courseScopes = new Map<string, ProjectRecord['branchScope']>();
  assets = new Map<string, ProjectMediaAsset>();
  proposalLimit: { since: string; limit: number } | null = null;
  reviewDrafts = new Map<string, ProjectRecord>();

  constructor(projects: ProjectRecord[] = []) {
    this.projects = structuredClone(projects);
    for (const item of projects) {
      this.members.set(item.id, [{ userId: item.ownerId, role: 'owner', displayName: 'Owner', handle: 'owner' }]);
    }
  }

  async listProjects() { return structuredClone(this.projects); }
  async findProjectsByCover(assetId: string) { return structuredClone(this.projects.filter((item) => item.coverAssetId === assetId)); }
  async findProject(id: string) { return structuredClone(this.projects.find((item) => item.id === id) ?? null); }
  async findReviewDraft(_actorId: string, id: string) { return structuredClone(this.reviewDrafts.get(id) ?? null); }
  async findMediaAsset(id: string) { return structuredClone(this.assets.get(id) ?? null); }
  async createProject(value: ProjectRecord, members: ProjectMember[]) {
    this.projects.push(structuredClone(value));
    this.members.set(value.id, structuredClone(members));
    return structuredClone(value);
  }
  async createProposal(value: ProjectRecord, members: ProjectMember[], since: string, limit: number) {
    this.proposalLimit = { since, limit };
    if (this.projects.filter((item) => item.ownerId === value.ownerId && item.createdAt >= since).length >= limit) {
      throw new ApiError(429, 'PROJECT_PROPOSAL_LIMIT', 'You can propose up to five projects per day');
    }
    return this.createProject(value, members);
  }
  async updateProject(_actorId: string, value: ProjectRecord, members: ProjectMember[], _expectedRevision: string) {
    const index = this.projects.findIndex((item) => item.id === value.id);
    if (index < 0) return null;
    this.projects[index] = structuredClone(value);
    this.members.set(value.id, structuredClone(members));
    return structuredClone(value);
  }
  async saveReviewDraft(_actorId: string, value: ProjectRecord, members: ProjectMember[], _expectedRevision: string) {
    const draft = { ...structuredClone(value), approved: false };
    this.reviewDrafts.set(value.id, draft);
    this.members.set(value.id, structuredClone(members));
    return draft;
  }
  async deleteProject(_actorId: string, id: string, _expectedRevision: string) {
    const before = this.projects.length;
    this.projects = this.projects.filter((item) => item.id !== id);
    this.members.delete(id);
    this.interests.delete(id);
    return this.projects.length !== before;
  }
  async findViewerBranch(userId: string) { return this.viewerBranches.get(userId) ?? null; }
  async listViewerMemberships(userId: string) {
    return [...this.members].flatMap(([projectId, memberships]) => memberships
      .filter((member) => member.userId === userId)
      .map((member) => ({ projectId, role: member.role })));
  }
  async listMembers(projectId: string) { return structuredClone(this.members.get(projectId) ?? []); }
  async listCourses(courseIds: string[], viewerBranchId?: string | null) {
    return structuredClone(this.courses.filter((course) => {
      if (!courseIds.includes(course.id) || viewerBranchId === undefined) return courseIds.includes(course.id);
      const scope = this.courseScopes.get(course.id) ?? { scope: 'global' };
      return scope.scope === 'global' || (viewerBranchId !== null && scope.branchIds.includes(viewerBranchId));
    }));
  }
  async hasInterest(projectId: string, userId: string) { return this.interests.get(projectId)?.has(userId) ?? false; }
  async setInterest(projectId: string, userId: string, interested: boolean) {
    const people = this.interests.get(projectId) ?? new Set<string>();
    if (interested) people.add(userId);
    else people.delete(userId);
    this.interests.set(projectId, people);
  }
  async listInterests(projectId: string) {
    return [...(this.interests.get(projectId) ?? [])].map((userId) => ({
      userId,
      displayName: userId === OTHER_ID ? 'Other learner' : 'Owner',
      handle: userId === OTHER_ID ? 'other' : 'owner',
    }));
  }
  async trackView(projectId: string, userId: string) { this.viewed.push({ projectId, userId }); }
}

const editor: Actor = { userId: EDITOR_ID, roles: [{ role: 'editor', branchId: null }] };
const allowed = async () => editor;

function liveActor(scope: Scope, permissions: readonly Permission[]): Actor {
  return {
    userId: EDITOR_ID,
    roles: [],
    authorization: {
      source: 'database',
      accountStatus: 'active',
      memberships: scope.kind === 'branch' ? [{ branchId: scope.branchId, status: 'active' }] : [],
      assignments: [{ roleDefinitionId: 'test_role', scope, permissions: [...permissions] }],
    },
  };
}

describe('project showcase service', () => {
  beforeEach(() => {
    mocks.audit.mockReset();
    mocks.audit.mockResolvedValue(undefined);
  });

  it('creates learner proposals as ideas that are unapproved, owner-led, and hidden from everyone else', async () => {
    const store = new MemoryProjectStore();
    const service = createProjectService({ store, authorize: allowed, now: () => new Date('2026-09-03T08:00:00.000Z') });

    const created = await service.propose(OWNER_ID, proposal());

    expect(created).toMatchObject({ status: 'idea', approved: false, ownerId: OWNER_ID });
    await expect(service.list(OTHER_ID, {})).resolves.toEqual([]);
    await expect(service.list(OWNER_ID, {})).resolves.toEqual([expect.objectContaining({ id: 'climate-lab', approved: false })]);
    expect(await store.listMembers('climate-lab')).toEqual([
      { userId: OWNER_ID, role: 'owner', displayName: null, handle: null },
    ]);
  });

  it('separates personal proposals, participation, and showcases while keeping pending work private', async () => {
    const owned = project({ id: 'owned-proposal', approved: false });
    const participating = project({ id: 'team-proposal', approved: false, ownerId: OTHER_ID });
    const showcase = project({ id: 'public-showcase', approved: true, ownerId: OTHER_ID });
    const hidden = project({ id: 'hidden-proposal', approved: false, ownerId: EDITOR_ID });
    const store = new MemoryProjectStore([owned, participating, showcase, hidden]);
    store.members.set(participating.id, [
      { userId: OTHER_ID, role: 'owner', displayName: 'Other', handle: 'other' },
      { userId: OWNER_ID, role: 'member', displayName: 'Owner', handle: 'owner' },
    ]);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.list(OWNER_ID, {})).resolves.toEqual([
      expect.objectContaining({ id: 'owned-proposal', viewerRole: 'owner', relationship: 'proposal' }),
      expect.objectContaining({ id: 'team-proposal', viewerRole: 'member', relationship: 'participation' }),
      expect.objectContaining({ id: 'public-showcase', viewerRole: null, relationship: 'showcase' }),
    ]);
  });

  describe('internal fixture guard', () => {
    afterEach(() => vi.unstubAllEnvs());
    const fixtureStore = () => new MemoryProjectStore([
      project({ id: 'recovery-project-showcase', approved: true, ownerId: OTHER_ID }),
      project({ id: 'recovery-project-owned', approved: true, ownerId: OWNER_ID }),
      project({ id: 'public-showcase', approved: true, ownerId: OTHER_ID }),
    ]);

    it('lists fixtures while HIDE_INTERNAL_CONTENT is unset', async () => {
      const service = createProjectService({ store: fixtureStore(), authorize: allowed });
      expect((await service.list(OWNER_ID, {})).map(({ id }) => id)).toEqual([
        'recovery-project-showcase', 'recovery-project-owned', 'public-showcase',
      ]);
    });

    it('hides fixture showcases but keeps the ones the viewer belongs to', async () => {
      vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
      const service = createProjectService({ store: fixtureStore(), authorize: allowed });
      expect((await service.list(OWNER_ID, {})).map(({ id }) => id)).toEqual(['recovery-project-owned', 'public-showcase']);
    });
  });

  it('keeps a pending participant constrained by the project branch scope', async () => {
    const pending = project({
      id: 'branch-team', approved: false, ownerId: OTHER_ID,
      branchScope: { scope: 'branches', branchIds: ['branch-b'] },
    });
    const store = new MemoryProjectStore([pending]);
    store.members.set(pending.id, [
      { userId: OTHER_ID, role: 'owner', displayName: null, handle: null },
      { userId: OWNER_ID, role: 'member', displayName: null, handle: null },
    ]);
    store.viewerBranches.set(OWNER_ID, 'branch-a');
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.list(OWNER_ID, {})).resolves.toEqual([]);
    await expect(service.get(OWNER_ID, pending.id)).rejects.toMatchObject({ status: 404 });
  });

  it('scopes proposals to the owner branch and denies cross-branch list, detail, and interest access', async () => {
    const store = new MemoryProjectStore([project({
      branchScope: { scope: 'branches', branchIds: ['branch-b'] },
      coverAssetId: 'asset_cover',
    })]);
    store.viewerBranches.set(OWNER_ID, 'branch-b');
    store.viewerBranches.set(OTHER_ID, 'branch-a');
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.list(OTHER_ID, {})).resolves.toEqual([]);
    await expect(service.get(OTHER_ID, 'climate-lab')).rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
    await expect(service.setInterest(OTHER_ID, 'climate-lab', true)).rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
    await expect(service.canViewCover(OTHER_ID, 'asset_cover')).resolves.toBe(false);
    await expect(service.canViewCover(OWNER_ID, 'asset_cover')).resolves.toBe(true);

    const proposed = await service.propose(OWNER_ID, proposal('branch-project'));
    expect(proposed.branchScope).toEqual({ scope: 'branches', branchIds: ['branch-b'] });
  });

  it('omits a related course that is outside the learner branch scope', async () => {
    const store = new MemoryProjectStore([project()]);
    store.viewerBranches.set(OTHER_ID, 'branch-a');
    store.courseScopes.set('ai-foundations', { scope: 'branches', branchIds: ['branch-b'] });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.get(OTHER_ID, 'climate-lab')).resolves.toMatchObject({ relatedCourses: [] });
  });

  it('authorizes a pending project cover only for an allowed owner or participant', async () => {
    const store = new MemoryProjectStore([project({ approved: false, coverAssetId: 'asset_private' })]);
    store.members.set('climate-lab', [
      { userId: OWNER_ID, role: 'owner', displayName: 'Owner', handle: 'owner' },
      { userId: OTHER_ID, role: 'member', displayName: 'Other learner', handle: 'other' },
    ]);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.canViewCover(OWNER_ID, 'asset_private')).resolves.toBe(true);
    await expect(service.canViewCover(OTHER_ID, 'asset_private')).resolves.toBe(true);
    await expect(service.canViewCover(EDITOR_ID, 'asset_private')).resolves.toBe(false);
  });

  it('lets reviewers and project editors read covers only for projects in their scope', async () => {
    const store = new MemoryProjectStore([
      project({ id: 'branch-proposal', approved: false, coverAssetId: 'asset_branch', ownershipKind: 'branch', ownerBranchId: 'branch-b' }),
      project({ id: 'central-proposal', approved: false, coverAssetId: 'asset_central', ownershipKind: 'central', ownerBranchId: null }),
    ]);
    const service = createProjectService({ store, authorize: allowed });
    const centralReviewer = liveActor({ kind: 'central' }, BUILT_IN_ROLE_PERMISSIONS.central_reviewer);
    const branchEditor = liveActor({ kind: 'branch', branchId: 'branch-b' }, ['project.edit']);
    const otherBranchReviewer = liveActor({ kind: 'branch', branchId: 'branch-c' }, ['content.review', 'project.edit']);

    await expect(service.canReviewCover(centralReviewer, 'asset_central')).resolves.toBe(true);
    await expect(service.canReviewCover(branchEditor, 'asset_branch')).resolves.toBe(true);
    await expect(service.canReviewCover(branchEditor, 'asset_central')).resolves.toBe(false);
    await expect(service.canReviewCover(otherBranchReviewer, 'asset_branch')).resolves.toBe(false);
    await expect(service.canReviewCover(liveActor({ kind: 'central' }, ['media.upload']), 'asset_central')).resolves.toBe(false);
    await expect(service.canReviewCover(centralReviewer, 'asset_unused')).resolves.toBe(false);
  });

  it('skips the cover lookup for actors who cannot review or edit projects anywhere', async () => {
    const store = new MemoryProjectStore([
      project({ id: 'central-proposal', approved: false, coverAssetId: 'asset_central', ownershipKind: 'central', ownerBranchId: null }),
    ]);
    const lookup = vi.spyOn(store, 'findProjectsByCover');
    const service = createProjectService({ store, authorize: allowed });
    const learner: Actor = {
      userId: OTHER_ID,
      roles: [],
      authorization: { source: 'database', accountStatus: 'active', memberships: [], assignments: [] },
    };

    await expect(service.canReviewCover(learner, 'asset_central')).resolves.toBe(false);
    await expect(service.canReviewCover(liveActor({ kind: 'central' }, ['media.upload']), 'asset_central')).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    await expect(service.canReviewCover(liveActor({ kind: 'central' }, ['content.review']), 'asset_central')).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('reserves route segment ids on the learner and Studio create paths', async () => {
    const store = new MemoryProjectStore();
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.propose(OWNER_ID, proposal('new')))
      .rejects.toMatchObject({ status: 400, code: 'PROJECT_ID_RESERVED' });
    await expect(service.createStudio(studioInput({ id: 'new' })))
      .rejects.toMatchObject({ status: 400, code: 'PROJECT_ID_RESERVED' });
    expect(store.projects).toEqual([]);
  });

  it('accepts a learner-owned uploaded cover on a proposal', async () => {
    const store = new MemoryProjectStore();
    store.assets.set('asset_cover', { id: 'asset_cover', ownerId: OWNER_ID, mime: 'image/webp', purpose: 'project_cover' });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.propose(OWNER_ID, { ...proposal(), coverAssetId: 'asset_cover' }))
      .resolves.toMatchObject({ id: 'climate-lab', coverAssetId: 'asset_cover' });
  });

  it('lets a reviewer without media.upload save a proposal that keeps its learner cover', async () => {
    const reviewer: Actor = { userId: EDITOR_ID, roles: [] };
    const store = new MemoryProjectStore([project({ approved: false, coverAssetId: 'asset_learner' })]);
    store.assets.set('asset_learner', { id: 'asset_learner', ownerId: OWNER_ID, mime: 'image/png', purpose: 'project_cover' });
    store.assets.set('asset_other', { id: 'asset_other', ownerId: OTHER_ID, mime: 'image/png' });
    const service = createProjectService({ store, authorize: async () => reviewer });

    await expect(service.updateStudio('climate-lab', studioInput({
      approved: false, status: 'forming', coverAssetId: 'asset_learner',
    }))).resolves.toMatchObject({ status: 'forming', coverAssetId: 'asset_learner' });

    await expect(service.updateStudio('climate-lab', studioInput({
      approved: false, coverAssetId: 'asset_other', expectedUpdatedAt: store.projects[0].updatedAt,
    }))).rejects.toMatchObject({ status: 403, code: 'PROJECT_COVER_FORBIDDEN' });
  });

  it('requires project.edit before approving a learner proposal', async () => {
    const store = new MemoryProjectStore([project({ approved: false })]);
    const denied = createProjectService({
      store,
      authorize: async () => { throw new ApiError(403, 'FORBIDDEN', 'Permission denied'); },
      now: () => new Date('2026-09-03T08:00:00.000Z'),
    });

    await expect(denied.updateStudio('climate-lab', {
      ...proposal(),
      status: 'active',
      approved: true,
      members: [{ userId: OWNER_ID, role: 'owner' }],
    })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(store.projects[0]).toMatchObject({ status: 'idea', approved: false });
  });

  it('rejects learner proposals that name another user as a member', async () => {
    const store = new MemoryProjectStore();
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.propose(OWNER_ID, {
      ...proposal(),
      members: [{ userId: OTHER_ID, role: 'member' }],
    })).rejects.toMatchObject({ status: 403, code: 'PROJECT_MEMBERSHIP_FORBIDDEN' });
    expect(store.projects).toEqual([]);
  });

  it('rejects a foreign learner cover asset before persisting the proposal', async () => {
    const store = new MemoryProjectStore();
    store.assets.set('asset_foreign', { id: 'asset_foreign', ownerId: OTHER_ID, mime: 'image/png' });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.propose(OWNER_ID, {
      ...proposal(),
      coverAssetId: 'asset_foreign',
    })).rejects.toMatchObject({ status: 403, code: 'PROJECT_COVER_FORBIDDEN' });
    expect(store.projects).toEqual([]);
  });

  it('rejects a non-image cover asset even when the learner owns it', async () => {
    const store = new MemoryProjectStore();
    store.assets.set('asset_document', { id: 'asset_document', ownerId: OWNER_ID, mime: 'application/pdf' });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.propose(OWNER_ID, {
      ...proposal(),
      coverAssetId: 'asset_document',
    })).rejects.toMatchObject({ status: 403, code: 'PROJECT_COVER_FORBIDDEN' });
    expect(store.projects).toEqual([]);
  });

  it('allows Studio editors with media.upload to use another owner image', async () => {
    const store = new MemoryProjectStore();
    store.assets.set('asset_foreign', { id: 'asset_foreign', ownerId: OTHER_ID, mime: 'image/jpeg' });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.createStudio(studioInput({ coverAssetId: 'asset_foreign' })))
      .resolves.toMatchObject({ id: 'climate-lab', coverAssetId: 'asset_foreign' });
  });

  it('keeps another learner uploaded cover off Studio projects even with media.upload', async () => {
    const store = new MemoryProjectStore([project({ approved: false, coverAssetId: null })]);
    store.assets.set('asset_learner', { id: 'asset_learner', ownerId: OTHER_ID, mime: 'image/png', purpose: 'project_cover' });
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.createStudio(studioInput({ id: 'other-lab', coverAssetId: 'asset_learner' })))
      .rejects.toMatchObject({ status: 403, code: 'PROJECT_COVER_FORBIDDEN' });
    await expect(service.updateStudio('climate-lab', studioInput({ approved: false, coverAssetId: 'asset_learner' })))
      .rejects.toMatchObject({ status: 403, code: 'PROJECT_COVER_FORBIDDEN' });
    expect(store.projects.map(({ id, coverAssetId }) => ({ id, coverAssetId })))
      .toEqual([{ id: 'climate-lab', coverAssetId: null }]);
  });

  it('rejects approval through the legacy project edit path', async () => {
    const store = new MemoryProjectStore([project({ approved: false })]);
    const service = createProjectService({
      store,
      authorize: allowed,
      now: () => new Date('2026-09-03T08:00:00.000Z'),
    });

    await expect(service.updateStudio('climate-lab', studioInput({ status: 'active', approved: true })))
      .rejects.toMatchObject({ status: 409, code: 'PROJECT_REVIEW_REQUIRED' });
    expect(store.projects[0]).toMatchObject({ status: 'idea', approved: false });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('stores edits to an approved project as a review draft without changing the live project', async () => {
    const store = new MemoryProjectStore([project()]);
    const service = createProjectService({ store, authorize: allowed });

    await service.updateStudio('climate-lab', studioInput({ status: 'forming' }));

    expect(store.projects[0]).toMatchObject({ status: 'idea', approved: true });
    expect(store.reviewDrafts.get('climate-lab')).toMatchObject({ status: 'forming', approved: false });
    await expect(service.getStudio('climate-lab')).resolves.toMatchObject({ status: 'forming', approved: false });
    expect(mocks.audit).toHaveBeenCalledWith(
      editor,
      'project.draft.update',
      { type: 'project', id: 'climate-lab' },
      expect.objectContaining({ status: 'idea', approved: true }),
      expect.objectContaining({ status: 'forming', approved: false }),
    );
  });

  it('checks project updates against the acknowledged editor draft revision', async () => {
    const store = new MemoryProjectStore([project()]);
    store.reviewDrafts.set('climate-lab', project({ approved: false, status: 'forming', updatedAt: '2026-09-03T01:00:00.000Z' }));
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.updateStudio('climate-lab', studioInput({
      status: 'active',
      expectedUpdatedAt: '2026-09-03T00:00:00.000Z',
    }))).rejects.toMatchObject({ status: 409, code: 'PROJECT_DRAFT_CONFLICT' });

    await expect(service.updateStudio('climate-lab', studioInput({
      status: 'active',
      expectedUpdatedAt: '2026-09-03T01:00:00.000Z',
    }))).resolves.toMatchObject({ status: 'active', approved: false });
  });

  it('audits a Studio deletion with the authorized Actor and deleted project state', async () => {
    const store = new MemoryProjectStore([project({ approved: false })]);
    const service = createProjectService({ store, authorize: allowed });

    await service.deleteStudio('climate-lab', '2026-09-03T00:00:00.000Z');

    expect(mocks.audit).toHaveBeenCalledWith(
      editor,
      'project.delete',
      { type: 'project', id: 'climate-lab' },
      { status: 'idea', approved: false, ownerId: OWNER_ID, coverAssetId: null },
      null,
    );
  });

  it('forbids deleting a published project through the authoring workflow', async () => {
    const store = new MemoryProjectStore([project({ approved: true })]);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.deleteStudio('climate-lab', '2026-09-03T00:00:00.000Z'))
      .rejects.toMatchObject({ status: 409, code: 'PROJECT_PUBLISHED_DELETE_FORBIDDEN' });
    expect(store.projects).toHaveLength(1);
  });

  it('rejects project deletion from a stale editor revision', async () => {
    const store = new MemoryProjectStore([project({ approved: false })]);
    store.reviewDrafts.set('climate-lab', project({ approved: false, updatedAt: '2026-09-03T01:00:00.000Z' }));
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.deleteStudio('climate-lab', '2026-09-03T00:00:00.000Z'))
      .rejects.toMatchObject({ status: 409, code: 'PROJECT_DRAFT_CONFLICT' });
    expect(store.projects).toHaveLength(1);
  });

  it('sets interest to the requested state idempotently', async () => {
    const store = new MemoryProjectStore([project()]);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.setInterest(OTHER_ID, 'climate-lab', true)).resolves.toEqual({ interested: true });
    await expect(service.setInterest(OTHER_ID, 'climate-lab', true)).resolves.toEqual({ interested: true });
    expect([...store.interests.get('climate-lab') ?? []]).toEqual([OTHER_ID]);

    await expect(service.setInterest(OTHER_ID, 'climate-lab', false)).resolves.toEqual({ interested: false });
    await expect(service.setInterest(OTHER_ID, 'climate-lab', false)).resolves.toEqual({ interested: false });
    expect([...store.interests.get('climate-lab') ?? []]).toEqual([]);
  });

  it('filters the visible board by status, skills, and related courses', async () => {
    const store = new MemoryProjectStore([
      project(),
      project({ id: 'robotics-club', status: 'forming', skills: ['robotics'], courseIds: ['robotics-101'] }),
      project({ id: 'food-map', status: 'active', skills: ['data-literacy'], courseIds: ['community-research'] }),
      project({ id: 'private-data-lab', approved: false, skills: ['data-literacy'], courseIds: ['ai-foundations'] }),
    ]);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.list(OTHER_ID, {
      statuses: ['idea', 'active'],
      skills: ['data-literacy'],
      courseIds: ['ai-foundations'],
    })).resolves.toEqual([expect.objectContaining({ id: 'climate-lab' })]);
  });

  it('includes the interest list for the owner but never for another viewer', async () => {
    const store = new MemoryProjectStore([project()]);
    await store.setInterest('climate-lab', OTHER_ID, true);
    const service = createProjectService({ store, authorize: allowed });

    const ownerDetail = await service.get(OWNER_ID, 'climate-lab');
    const otherDetail = await service.get(OTHER_ID, 'climate-lab');

    expect(ownerDetail.interestList).toEqual([{ userId: OTHER_ID, displayName: 'Other learner', handle: 'other' }]);
    expect(otherDetail).not.toHaveProperty('interestList');
    expect(store.viewed).toEqual([
      { projectId: 'climate-lab', userId: OWNER_ID },
      { projectId: 'climate-lab', userId: OTHER_ID },
    ]);
  });

  it('blocks new interest on pending projects while allowing a safe withdrawal', async () => {
    const pending = project({ approved: false, status: 'idea' });
    const store = new MemoryProjectStore([pending]);
    store.members.set(pending.id, [
      { userId: OWNER_ID, role: 'owner', displayName: 'Owner', handle: 'owner' },
      { userId: OTHER_ID, role: 'member', displayName: 'Member', handle: 'member' },
    ]);
    const service = createProjectService({ store, authorize: allowed });
    await expect(service.setInterest(OTHER_ID, pending.id, true)).rejects.toMatchObject({ status: 404, code: 'PROJECT_NOT_FOUND' });
    await store.setInterest(pending.id, OTHER_ID, true);
    await expect(service.setInterest(OTHER_ID, pending.id, false)).resolves.toEqual({ interested: false });
    expect([...store.interests.get(pending.id) ?? []]).toEqual([]);
  });

  it('includes interest identities for an authorized Studio reviewer', async () => {
    const store = new MemoryProjectStore([project({ ownerId: OWNER_ID })]);
    await store.setInterest('climate-lab', OTHER_ID, true);
    const service = createProjectService({ store, authorize: allowed });

    await expect(service.getStudio('climate-lab')).resolves.toMatchObject({
      interestList: [{ userId: OTHER_ID, displayName: 'Other learner' }],
    });
  });

  it('limits each learner to five proposals per UTC day', async () => {
    const store = new MemoryProjectStore(Array.from({ length: 5 }, (_, index) => project({
      id: `proposal-${index}`,
      approved: false,
      createdAt: `2026-09-03T0${index}:00:00.000Z`,
    })));
    const service = createProjectService({ store, authorize: allowed, now: () => new Date('2026-09-03T12:00:00.000Z') });

    await expect(service.propose(OWNER_ID, proposal('sixth-proposal'))).rejects.toMatchObject({
      status: 429,
      code: 'PROJECT_PROPOSAL_LIMIT',
    });
  });

  it('uses one clock sample for the proposal timestamp and UTC quota window', async () => {
    const store = new MemoryProjectStore();
    const samples = [
      new Date('2026-09-03T23:59:59.999Z'),
      new Date('2026-09-04T00:00:00.000Z'),
    ];
    const service = createProjectService({
      store,
      authorize: allowed,
      now: () => samples.shift() ?? new Date('2026-09-04T00:00:00.001Z'),
    });

    const created = await service.propose(OWNER_ID, proposal());

    expect(created.createdAt).toBe('2026-09-03T23:59:59.999Z');
    expect(store.proposalLimit).toEqual({ since: '2026-09-03T00:00:00.000Z', limit: 5 });
  });
});
