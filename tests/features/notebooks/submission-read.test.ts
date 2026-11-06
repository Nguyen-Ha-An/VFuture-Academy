import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.database }));
import { ApiError } from '@/lib/api';
import type { Actor, Permission } from '@/lib/permissions';
import { readSubmissionNotebook } from '@/features/notebooks/submission-read';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STAFF = '55555555-5555-4555-8555-555555555555';
const VERSION = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const course = 'historical-course';
const branch = 'historical-school';
const assigned = { all: false, branchIds: [], assignments: [{ courseId: course, branchId: branch }] };
const unassigned = { all: false, branchIds: [], assignments: [] };
const actor = (permissions: Permission[] = ['submission.grade'], central = false, school = branch): Actor => ({
  userId: STAFF, roles: [], authorization: { source: 'database', accountStatus: 'active',
    memberships: central ? [] : [{ branchId: school, status: 'active' }],
    assignments: [{ roleDefinitionId: 'fixture', permissions, scope: central ? { kind: 'central' } : { kind: 'branch', branchId: school } }],
  },
});
const owner: Actor = { userId: OWNER, roles: [], authorization: { source: 'database', accountStatus: 'active', memberships: [], assignments: [] } };
function fixture({ submission = {}, artifact = {}, version = { course_id: course } as unknown, versionError = null as unknown } = {}) {
  const submissionRow = { id: 'submission', user_id: OWNER, course_version_id: VERSION, item_id: 'assignment', block_id: null,
    branch_id: branch, branch_scope_known: true, payload: { notebook: { assetId: ASSET, checksum: 'a'.repeat(64) } }, ...submission };
  const artifactRow = { id: ASSET, owner_id: OWNER, course_id: course, course_version_id: VERSION, item_id: 'assignment', block_id: null,
    purpose: 'submission', checksum: 'a'.repeat(64), status: 'ready', storage_path: 'private/learner.ipynb', filename: 'work.ipynb',
    mime: 'application/x-ipynb+json', size_bytes: 20, ...artifact };
  const queries: Array<{ table: string; operations: unknown[][] }> = [];
  const signing = vi.fn(async () => ({ data: { signedUrl: 'https://storage.example/read' }, error: null }));
  const rpc = vi.fn(async () => ({ data: assigned, error: null }));
  const db = { from(table: string) {
    const operations: unknown[][] = []; queries.push({ table, operations });
    const query = { select(value: string) { operations.push(['select', value]); return query; },
      eq(key: string, value: unknown) { operations.push(['eq', key, value]); return query; },
      maybeSingle: async () => ({ data: table === 'assignment_submissions' ? submissionRow
        : table === 'course_versions' ? version : table === 'notebook_artifacts' ? artifactRow : null,
      error: table === 'course_versions' ? versionError : null }),
    }; return query;
  }, rpc, storage: { from: () => ({ createSignedUrl: signing }) } };
  mocks.database.mockReturnValue(db);
  return { db, queries, signing, rpc };
}
const notFound = { status: 404, code: 'NOTEBOOK_SUBMISSION_NOT_FOUND', message: 'Notebook submission is unavailable' };
function noArtifactAccess(f: ReturnType<typeof fixture>) {
  expect(f.queries.some(query => query.table === 'notebook_artifacts')).toBe(false);
  expect(f.signing).not.toHaveBeenCalled();
}
beforeEach(() => vi.clearAllMocks());

describe('submitted notebook course authorization', () => {
  it('authorizes the assigned teacher against the exact historical version before reading or signing bytes', async () => {
    const f = fixture(); const teacher = actor();
    await expect(readSubmissionNotebook(teacher, 'submission', f.db as never)).resolves.toMatchObject({ assetId: ASSET });
    expect(f.queries.map(query => query.table)).toEqual(['assignment_submissions', 'course_versions', 'notebook_artifacts']);
    expect(f.queries[1].operations).toEqual([['select', 'course_id'], ['eq', 'id', VERSION]]);
    expect(f.rpc).toHaveBeenCalledWith('teaching_course_scope', { p_actor_id: STAFF, p_permission: 'submission.grade' });
    expect(f.signing).toHaveBeenCalledOnce();
  });

  it('denies an unassigned course in the same school before any artifact read or URL signing', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: { ...assigned, assignments: [{ courseId: 'other-course', branchId: branch }] }, error: null });
    await expect(readSubmissionNotebook(actor(), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    noArtifactAccess(f);
  });

  it('denies a teacher assigned to the course in another historical school', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: { ...assigned, assignments: [{ courseId: course, branchId: 'other-school' }] }, error: null });
    await expect(readSubmissionNotebook(actor(), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    noArtifactAccess(f);
  });

  it('does not let a branch operation grant cover a different submission school', async () => {
    const f = fixture();
    await expect(readSubmissionNotebook(actor(['submission.grade'], false, 'other-school'), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    expect(f.rpc).not.toHaveBeenCalled(); noArtifactAccess(f);
  });

  it('denies an ordinary global teacher whose base grading permission has no course assignment', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: unassigned, error: null });
    await expect(readSubmissionNotebook(actor(['submission.grade'], true), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    noArtifactAccess(f);
  });

  it('admits a true scope-all administrator with grading permission', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: { ...unassigned, all: true }, error: null });
    await expect(readSubmissionNotebook(actor(['submission.grade', 'teaching.scope.all'], true), 'submission', f.db as never)).resolves.toMatchObject({ assetId: ASSET });
    expect(f.signing).toHaveBeenCalledOnce();
  });

  it('preserves the base operation requirement even for an administrator with scope-all', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: { ...unassigned, all: true }, error: null });
    await expect(readSubmissionNotebook(actor(['teaching.scope.all'], true), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    expect(f.rpc).not.toHaveBeenCalled(); noArtifactAccess(f);
  });

  it.each([false, true])('keeps unknown historical school unknown (known=%s), even when a raw branch is present', async known => {
    const f = fixture({ submission: { branch_scope_known: known, branch_id: known ? null : branch } });
    await expect(readSubmissionNotebook(actor(), 'submission', f.db as never)).rejects.toMatchObject(notFound);
    noArtifactAccess(f);
  });

  it('allows unknown history only with global scope-all and the grading operation', async () => {
    const f = fixture({ submission: { branch_scope_known: false, branch_id: branch } });
    f.rpc.mockResolvedValue({ data: { ...unassigned, all: true }, error: null });
    await expect(readSubmissionNotebook(actor(['submission.grade', 'teaching.scope.all'], true), 'submission', f.db as never)).resolves.toMatchObject({ assetId: ASSET });
    expect(f.signing).toHaveBeenCalledOnce();
  });

  it('rechecks a revoked assignment on the next request with the same actor and database', async () => {
    const f = fixture(); const teacher = actor();
    f.rpc.mockResolvedValueOnce({ data: assigned, error: null }).mockResolvedValueOnce({ data: unassigned, error: null });
    await readSubmissionNotebook(teacher, 'submission', f.db as never);
    f.queries.length = 0; f.signing.mockClear();
    await expect(readSubmissionNotebook(teacher, 'submission', f.db as never)).rejects.toMatchObject(notFound);
    expect(f.rpc).toHaveBeenCalledTimes(2); noArtifactAccess(f);
  });

  it.each(['staff', 'owner'])('rejects an artifact whose stable course disagrees with the submission version (%s)', async viewer => {
    const f = fixture({ artifact: { course_id: 'other-course' } });
    await expect(readSubmissionNotebook(viewer === 'staff' ? actor() : owner, 'submission', f.db as never)).rejects.toMatchObject(notFound);
    expect(f.signing).not.toHaveBeenCalled();
  });

  it('preserves the learner owner flow without requiring teaching rights or assignments', async () => {
    const f = fixture();
    await expect(readSubmissionNotebook(owner, 'submission', f.db as never)).resolves.toMatchObject({ assetId: ASSET });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.signing).toHaveBeenCalledOnce();
  });

  it('returns the same unavailable response for an unauthorized and a nonexistent submission', async () => {
    const f = fixture(); f.rpc.mockResolvedValue({ data: unassigned, error: null });
    const denied = await readSubmissionNotebook(actor(), 'submission', f.db as never).catch(error => error);
    const missing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    const absent = await readSubmissionNotebook(actor(), 'missing', missing as never).catch(error => error);
    expect(denied).toBeInstanceOf(ApiError); expect(absent).toBeInstanceOf(ApiError);
    expect({ status: denied.status, code: denied.code, message: denied.message }).toEqual({ status: absent.status, code: absent.code, message: absent.message });
    noArtifactAccess(f);
  });

  it('fails closed before artifacts when the stable course is missing or cannot be resolved', async () => {
    const missing = fixture({ version: null });
    await expect(readSubmissionNotebook(actor(), 'submission', missing.db as never)).rejects.toMatchObject(notFound);
    noArtifactAccess(missing);
    const unavailable = fixture({ versionError: new Error('offline') });
    await expect(readSubmissionNotebook(actor(), 'submission', unavailable.db as never)).rejects.toMatchObject({ status: 503 });
    noArtifactAccess(unavailable);
  });
});
