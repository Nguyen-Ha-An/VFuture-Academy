import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_ROLE_PERMISSIONS, type Actor } from '@/lib/authorization';
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({ rpc: fixture.rpc }) }));
import { assertCourseTeaching, getCourseTeachers, replaceCourseTeachers, teachingCourseScope, teacherOptions } from '@/features/teaching/assignments';
import { ReplaceCourseTeachersSchema } from '@/features/teaching/assignment-contracts';
const userId = '98000000-0000-4000-8000-000000000002';
function actor(permissions: Array<'learning.read'|'submission.grade'|'teaching.scope.all'>, central = false): Actor {
  return { userId, roles: [], authorization: { source: 'database', accountStatus: 'active', memberships: [{ branchId: 'a', status: 'active' }], assignments: [{ roleDefinitionId: 'custom', scope: central ? { kind: 'central' } : { kind: 'branch', branchId: 'a' }, permissions }] } };
}
beforeEach(() => { fixture.rpc.mockReset(); });
describe('teacher scope contract', () => {
  it('requires base operation even when the database returns scope-all', async () => {
    fixture.rpc.mockResolvedValue({ data: { all: true, branchIds: [], assignments: [] }, error: null });
    await expect(assertCourseTeaching(actor(['learning.read']), 'submission.grade', 'course', 'a')).rejects.toMatchObject({ status: 403 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('does not treat a global teaching capability as assignment bypass', async () => {
    fixture.rpc.mockResolvedValue({ data: { all: false, branchIds: [], assignments: [] }, error: null });
    await expect(assertCourseTeaching(actor(['submission.grade'], true), 'submission.grade', 'course', 'a')).rejects.toMatchObject({ status: 403 });
  });
  it('accepts only exact course and branch assignments', async () => {
    fixture.rpc.mockResolvedValue({ data: { all: false, branchIds: [], assignments: [{ courseId: 'course', branchId: 'a' }] }, error: null });
    await expect(assertCourseTeaching(actor(['submission.grade']), 'submission.grade', 'course', 'a')).resolves.toBeUndefined();
    await expect(assertCourseTeaching(actor(['submission.grade']), 'submission.grade', 'other', 'a')).rejects.toMatchObject({ status: 403 });
    await expect(assertCourseTeaching(actor(['submission.grade'], true), 'submission.grade', 'course', null)).rejects.toMatchObject({ status: 403 });
    expect(fixture.rpc).toHaveBeenCalledWith('teaching_course_scope', { p_actor_id: userId, p_permission: 'submission.grade' });
  });
  it('accepts unknown historical branch only for globally privileged scope-all', async () => {
    fixture.rpc.mockResolvedValue({ data: { all: true, branchIds: [], assignments: [] }, error: null });
    await expect(assertCourseTeaching(actor(['submission.grade', 'teaching.scope.all'], true), 'submission.grade', 'course', null)).resolves.toBeUndefined();
  });
  it('fails closed when scope transport is unavailable', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'private internal detail' } });
    await expect(teachingCourseScope(actor(['learning.read']), 'learning.read')).rejects.toMatchObject({ status: 503, code: 'TEACHING_UNAVAILABLE' });
  });
  it('gives school admins assignment management and bypass without grading', () => {
    expect(BUILT_IN_ROLE_PERMISSIONS.school_admin).toContain('teaching.assignment.manage');
    expect(BUILT_IN_ROLE_PERMISSIONS.school_admin).toContain('teaching.scope.all');
    expect(BUILT_IN_ROLE_PERMISSIONS.school_admin).not.toContain('submission.grade');
    expect(BUILT_IN_ROLE_PERMISSIONS.teacher).not.toContain('teaching.scope.all');
  });
});
describe('assignment replacement and reads', () => {
  it('rejects duplicate users or nonempty groups without exactly one primary', () => {
    for (const teachers of [[{userId, role:'assistant'}], [{userId,role:'primary'},{userId,role:'assistant'}]]) {
      expect(ReplaceCourseTeachersSchema.safeParse({ branchId: 'a', expectedRevision: 0, teachers }).success).toBe(false);
    }
    expect(ReplaceCourseTeachersSchema.safeParse({ branchId:'a',expectedRevision:0,teachers:[] }).success).toBe(true);
  });
  it('sends revision and complete replacement through one atomic RPC and maps stale error', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    await expect(replaceCourseTeachers(actor(['learning.read']), 'course', {branchId:'a',expectedRevision:2,teachers:[]})).rejects.toMatchObject({status:409,code:'STALE_TEACHER_ASSIGNMENTS'});
    expect(fixture.rpc).toHaveBeenCalledWith('replace_course_teachers', {p_actor_id:userId,p_course_id:'course',p_branch_id:'a',p_expected_revision:2,p_teachers:[]});
  });
  it('preserves learner-safe names without UUIDs and historical branch resolution', async () => {
    fixture.rpc.mockResolvedValue({data:{courseId:'course',branchId:'historic',branchScopeKnown:true,revision:2,teachers:[{displayName:'Teacher',role:'primary'}]},error:null});
    const result=await getCourseTeachers(actor(['learning.read']), 'course');
    expect(result.teachers).toEqual([{displayName:'Teacher',role:'primary'}]);
    expect(fixture.rpc).toHaveBeenCalledWith('teaching_course_teachers',{p_actor_id:userId,p_course_id:'course',p_branch_id:null});
  });
  it('represents unknown enrollment history independently of no assignment', async () => {
    fixture.rpc.mockResolvedValue({data:{courseId:'course',branchId:null,branchScopeKnown:false,revision:0,teachers:[]},error:null});
    expect(await getCourseTeachers(actor(['learning.read']), 'course')).toMatchObject({branchId:null,branchScopeKnown:false,teachers:[]});
  });
  it('keeps teacher option pagination metadata', async () => {
    fixture.rpc.mockResolvedValue({data:{teachers:[{userId,displayName:'Teacher',handle:null}],hasMore:true,page:2,pageSize:1},error:null});
    expect(await teacherOptions(actor(['learning.read']),'a',2,1)).toMatchObject({hasMore:true,page:2});
  });
});
