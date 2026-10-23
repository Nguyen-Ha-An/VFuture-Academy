import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import { changeHandle, getOwnerProfileEvidence, getPublicProfile, setProfilePublic } from '@/features/profile/service';
import { readPublicCertificates } from '@/features/profile/certificates';

type Result = { data: unknown; error: Record<string, unknown> | null };

class Query implements PromiseLike<Result> {
  private filters: Array<(row: Record<string, unknown>) => boolean> = [];
  private updateValue: Record<string, unknown> | null = null;

  constructor(
    private readonly rows: Record<string, unknown>[],
    private readonly queried: string[],
    table: string,
  ) {
    queried.push(table);
  }

  select(_columns: string) { return this; }
  update(value: unknown) { this.updateValue = value as Record<string, unknown>; return this; }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
  order(_column: string, _options?: unknown) { return this; }
  limit(_value: number) { return this; }
  async maybeSingle(): Promise<Result> {
    const row = this.filtered()[0];
    return { data: row ? { ...row } : null, error: null };
  }
  async single(): Promise<Result> {
    const row = this.filtered()[0];
    return { data: row ? { ...row } : null, error: null };
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.filtered().map((row) => ({ ...row })), error: null }).then(onfulfilled, onrejected);
  }
  private filtered() {
    const filtered = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.updateValue) filtered.forEach((row) => Object.assign(row, this.updateValue));
    return filtered;
  }
}

class ProfileDatabase {
  readonly queried: string[] = [];
  constructor(
    readonly tables: Record<string, Record<string, unknown>[]> = {},
    readonly rpcResult: Result = { data: null, error: null },
  ) {}
  from(table: string) { return new Query(this.tables[table] ?? [], this.queried, table); }
  async rpc(_name: string, _args: Record<string, unknown>) { return this.rpcResult; }
}

const actor = {
  userId: 'learner-1',
  roles: [{ role: 'contributor' as const, branchId: null }],
};

beforeEach(() => {
  auditMock.mockReset().mockResolvedValue(undefined);
});

describe('public profiles', () => {
  it('returns the same absence for a private profile as an unknown handle and only probes the public view', async () => {
    const privateDatabase = new ProfileDatabase({
      profiles: [{ id: 'learner-1', handle: 'private-user', profile_public: false }],
      public_profiles: [],
    });
    const unknownDatabase = new ProfileDatabase({ public_profiles: [] });

    await expect(getPublicProfile('private-user', { client: privateDatabase })).resolves.toBeNull();
    await expect(getPublicProfile('missing-user', { client: unknownDatabase })).resolves.toBeNull();
    expect(privateDatabase.queried).toEqual(['public_profiles']);
    expect(unknownDatabase.queried).toEqual(['public_profiles']);
  });

  it('assembles branch, completions, skill levels, certificates, and showcased projects', async () => {
    const database = new ProfileDatabase({
      public_profiles: [{ id: 'learner-1', handle: 'future_builder', display_name: 'Future Builder', avatar_url: null, branch_name: 'VinSMC' }],
      branches: [{ id: 'vinsmc', name: 'VinSMC' }],
      course_completions: [{ user_id: 'learner-1', course_id: 'course-1', course_version_id: 'version-1', completed_at: '2026-09-01T00:00:00Z' }],
      courses: [{ id: 'course-1', status: 'published', current_version_id: 'version-1' }],
      course_version_outline: [{ version_id: 'version-1', access: { scope: 'global' } }],
      course_versions: [{ id: 'version-1', manifest: { title: { vi: 'Khóa học', en: 'Course one' } } }],
      skill_evidence: [{ id: 'e1', user_id: 'learner-1', skill_id: 'ai-literacy', level: 'applied', evidence_type: 'exam_passed', ref_type: 'exam_attempt', ref_id: 'attempt-1', created_at: '2026-09-02T00:00:00Z' }],
      skills: [{ id: 'ai-literacy', name: 'AI literacy', category: 'ai' }],
      projects: [{ id: 'project-1', owner_id: 'learner-1', status: 'showcased', approved: true, branch_scope: { scope: 'global' }, 'branch_scope->>scope': 'global', title: 'Project one', summary: 'Summary', output_links: [{ url: 'https://example.com/demo', label: 'Demo' }, { url: 'javascript:alert(1)' }] }],
      project_members: [],
    });
    const certificates = async () => [{
      courseId: 'course-1', title: 'Course one', issuedAt: '2026-09-02T00:00:00Z', verificationCode: 'verify-1', href: '/verify/verify-1',
    }];

    await expect(getPublicProfile('future_builder', { client: database, certificates })).resolves.toMatchObject({
      handle: 'future_builder',
      displayName: 'Future Builder',
      branch: { name: 'VinSMC' },
      completedCourses: [{ id: 'course-1', title: { vi: 'Khóa học', en: 'Course one' } }],
      skills: [{ id: 'ai-literacy', level: 'applied', evidenceCount: 1 }],
      certificates: [{ verificationCode: 'verify-1', href: '/verify/verify-1' }],
      projects: [{ id: 'project-1', outputLinks: [{ url: 'https://example.com/demo', label: 'Demo' }] }],
    });
    expect(database.queried).not.toContain('branches');
  });

  it('excludes unapproved and branch-restricted project details from a public profile', async () => {
    const database = new ProfileDatabase({
      public_profiles: [{ id: 'learner-1', handle: 'future_builder', display_name: 'Future Builder', avatar_url: null, branch_name: null }],
      course_completions: [], skill_evidence: [], skills: [], project_members: [],
      projects: [
        { id: 'pending', owner_id: 'learner-1', status: 'showcased', approved: false, branch_scope: { scope: 'global' }, 'branch_scope->>scope': 'global', title: 'Pending secret', summary: 'Hidden', output_links: [] },
        { id: 'branch', owner_id: 'learner-1', status: 'showcased', approved: true, branch_scope: { scope: 'branches', branchIds: ['vinsmc'] }, 'branch_scope->>scope': 'branches', title: 'Branch secret', summary: 'Hidden', output_links: [] },
      ],
    });
    const profile = await getPublicProfile('future_builder', { client: database, certificates: async () => [] });
    expect(profile?.projects).toEqual([]);
  });

  it('shows completions only while their current course is published and globally public', async () => {
    const database = new ProfileDatabase({
      public_profiles: [{ id: 'learner-1', handle: 'future_builder', display_name: 'Future Builder', avatar_url: null, branch_name: null }],
      course_completions: [
        { user_id: 'learner-1', course_id: 'public-course', course_version_id: 'old-public-version', completed_at: '2026-09-03T00:00:00Z' },
        { user_id: 'learner-1', course_id: 'branch-course', course_version_id: 'old-branch-version', completed_at: '2026-09-02T00:00:00Z' },
        { user_id: 'learner-1', course_id: 'archived-course', course_version_id: 'old-archived-version', completed_at: '2026-09-01T00:00:00Z' },
      ],
      courses: [
        { id: 'public-course', status: 'published', current_version_id: 'current-public-version' },
        { id: 'branch-course', status: 'published', current_version_id: 'current-branch-version' },
        { id: 'archived-course', status: 'archived', current_version_id: 'current-archived-version' },
      ],
      course_versions: [
        { id: 'current-public-version', course_id: 'public-course', manifest: { title: 'Public course' } },
        { id: 'current-branch-version', course_id: 'branch-course', manifest: { title: 'Branch course' } },
      ],
      course_version_outline: [
        { version_id: 'current-public-version', access: { scope: 'global' } },
        { version_id: 'current-branch-version', access: { scope: 'branches', branchIds: ['vinsmc'] } },
      ],
      skill_evidence: [],
      projects: [],
      project_members: [],
    });

    const profile = await getPublicProfile('future_builder', {
      client: database,
      certificates: async () => [],
    });

    expect(profile?.completedCourses).toEqual([
      { id: 'public-course', title: 'Public course', completedAt: '2026-09-03T00:00:00Z' },
    ]);
  });

  it('keeps owner evidence available without consulting public profile visibility', async () => {
    const database = new ProfileDatabase({ profiles: [{ id: 'learner-1', profile_public: false }], course_completions: [], skill_evidence: [], skills: [], projects: [], project_members: [] });
    await expect(getOwnerProfileEvidence('learner-1', { client: database })).resolves.toEqual({ completedCourses: [], skills: [], projects: [] });
    expect(database.queried).not.toContain('public_profiles');
  });

  it('uses pinned owner course titles, omits archived dead links, and includes current-branch project evidence', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', profile_public: false, branch_id: 'vinsmc' }],
      course_completions: [
        { user_id: 'learner-1', course_id: 'branch-course', course_version_id: 'pinned-v1', completed_at: '2026-09-03T00:00:00Z' },
        { user_id: 'learner-1', course_id: 'archived-course', course_version_id: 'archived-v1', completed_at: '2026-09-02T00:00:00Z' },
      ],
      courses: [{ id: 'branch-course', status: 'published', current_version_id: 'pinned-v1' }, { id: 'archived-course', status: 'archived', current_version_id: 'archived-v1' }],
      course_versions: [
        { id: 'pinned-v1', course_id: 'branch-course', manifest: { title: { en: 'Pinned branch title' } } },
        { id: 'archived-v1', course_id: 'archived-course', manifest: { title: { en: 'Archived title' } } },
      ],
      course_version_outline: [
        { version_id: 'pinned-v1', access: { scope: 'branches', branchIds: ['vinsmc'] } },
        { version_id: 'archived-v1', access: { scope: 'global' } },
      ],
      skill_evidence: [], skills: [],
      project_members: [{ user_id: 'learner-1', project_id: 'member-project' }, { user_id: 'learner-1', project_id: 'wrong-branch' }],
      projects: [
        { id: 'member-project', owner_id: 'other', status: 'showcased', approved: true, branch_scope: { scope: 'branches', branchIds: ['vinsmc'] }, title: 'Member evidence', summary: 'Visible', output_links: [] },
        { id: 'wrong-branch', owner_id: 'other', status: 'showcased', approved: true, branch_scope: { scope: 'branches', branchIds: ['other'] }, title: 'Private elsewhere', summary: 'Hidden', output_links: [] },
      ],
    });
    await expect(getOwnerProfileEvidence('learner-1', { client: database })).resolves.toMatchObject({
      completedCourses: [{ id: 'branch-course', title: { en: 'Pinned branch title' }, currentDestinationAvailable: true }],
      projects: [{ id: 'member-project', title: 'Member evidence' }],
    });
  });

  it('preserves a pinned owner achievement without linking to a newly inaccessible current version', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', profile_public: false, branch_id: 'vinsmc' }],
      course_completions: [{
        user_id: 'learner-1', course_id: 'changed-course', course_version_id: 'pinned-v1', completed_at: '2026-09-03T00:00:00Z',
      }],
      courses: [{ id: 'changed-course', status: 'published', current_version_id: 'current-v2' }],
      course_versions: [{ id: 'pinned-v1', course_id: 'changed-course', manifest: { title: { en: 'Pinned achievement title' } } }],
      course_version_outline: [{ version_id: 'current-v2', access: { scope: 'branches', branchIds: ['other'] } }],
      skill_evidence: [], skills: [], projects: [], project_members: [],
    });

    await expect(getOwnerProfileEvidence('learner-1', { client: database })).resolves.toMatchObject({
      completedCourses: [{
        id: 'changed-course',
        title: { en: 'Pinned achievement title' },
        currentDestinationAvailable: false,
      }],
    });
  });

  it('lists public certificates only while their course remains published and global', async () => {
    const database = new ProfileDatabase({
      certificates: [
        { id: 'c1', user_id: 'learner-1', course_id: 'public', course_version_id: 'old-public', serial: 'ONE', verification_code: 'v1', issued_at: '2026-09-01T00:00:00Z', pdf_asset_id: null },
        { id: 'c2', user_id: 'learner-1', course_id: 'branch', course_version_id: 'old-branch', serial: 'TWO', verification_code: 'v2', issued_at: '2026-09-01T00:00:00Z', pdf_asset_id: null },
      ],
      course_versions: [{ id: 'old-public', manifest: { title: 'Public course' } }, { id: 'old-branch', manifest: { title: 'Branch course' } }],
      courses: [{ id: 'public', current_version_id: 'current-public', status: 'published' }, { id: 'branch', current_version_id: 'current-branch', status: 'published' }],
      course_version_outline: [{ version_id: 'current-public', access: { scope: 'global' } }, { version_id: 'current-branch', access: { scope: 'branches', branchIds: ['vinsmc'] } }],
    });
    await expect(readPublicCertificates('learner-1', database)).resolves.toEqual([expect.objectContaining({ courseId: 'public', verificationCode: 'v1' })]);
  });
});

describe('profile handles', () => {
  it('maps handle uniqueness violations to a public conflict', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', handle: 'old_handle', profile_public: false }],
    }, { data: null, error: { code: '23505' } });

    await expect(changeHandle(actor, 'already_used', { client: database, now: () => new Date('2026-09-03T00:00:00Z') }))
      .rejects.toMatchObject({ status: 409, code: 'HANDLE_TAKEN' });
  });

  it('maps the durable three-per-day limiter to HTTP 429', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', handle: 'old_handle', profile_public: false }],
    }, {
      data: [{ id: 'learner-1', handle: 'old_handle', profile_public: false, outcome: 'HANDLE_RATE_LIMITED' }],
      error: null,
    });

    await expect(changeHandle(actor, 'fourth_change', { client: database, now: () => new Date('2026-09-03T00:00:00Z') }))
      .rejects.toMatchObject({ status: 429, code: 'HANDLE_RATE_LIMITED' });
  });

  it('audits a handle change with the full actor and a narrow before/after snapshot', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', handle: 'old_handle', profile_public: false }],
    }, {
      data: [{ id: 'learner-1', handle: 'new_handle', profile_public: false, outcome: 'CHANGED' }],
      error: null,
    });

    await changeHandle(actor, 'new_handle', { client: database, now: () => new Date('2026-09-03T00:00:00Z') });

    expect(auditMock).toHaveBeenCalledWith(
      actor,
      'profile.handle.updated',
      { type: 'profile', id: 'learner-1' },
      { handle: 'old_handle' },
      { handle: 'new_handle' },
    );
  });

  it('audits a visibility toggle with the full actor and a narrow before/after snapshot', async () => {
    const database = new ProfileDatabase({
      profiles: [{ id: 'learner-1', handle: 'future_builder', profile_public: false }],
    });

    await setProfilePublic(actor, true, { client: database, now: () => new Date('2026-09-03T00:00:00Z') });

    expect(auditMock).toHaveBeenCalledWith(
      actor,
      'profile.visibility.updated',
      { type: 'profile', id: 'learner-1' },
      { profilePublic: false },
      { profilePublic: true },
    );
  });
});
