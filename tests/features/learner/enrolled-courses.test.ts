import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { listEnrolledCourses } from '@/features/learning/enrolled-courses';
import type { LearnerDatabase } from '@/features/learning/shared';

function database() {
  const calls: Array<[string, string, unknown]> = [];
  const data: Record<string, unknown> = {
    enrollments: [
      { course_id: 'archived', course_version_id: 'old', status: 'active', branch_scope_known: true, branch_id: 'school-a' },
      { course_id: 'changed', course_version_id: 'pinned', status: 'completed', branch_scope_known: false },
      { course_id: 'suspended', course_version_id: 'blocked', status: 'active', branch_scope_known: true, branch_id: 'school-b' },
    ],
    course_version_outline: [
      { version_id: 'old', course_id: 'archived', meta: { title: { en: 'Archived pinned title', vi: 'Cũ' } }, default_language: 'vi' },
      { version_id: 'pinned', course_id: 'changed', meta: { title: { en: 'Original title', vi: 'Gốc' } }, default_language: 'vi' },
      { version_id: 'new', course_id: 'changed', meta: { title: { en: 'Unpublished new title' } }, default_language: 'en' },
    ],
  };
  const from = (table: string) => {
    let branch = '';
    const query = {
      select: (value: string) => { calls.push([table, 'select', value]); return query; },
      eq: (key: string, value: unknown) => { calls.push([table, key, value]); if (key === 'branch_id') branch = String(value); return query; },
      in: (key: string, value: unknown) => { calls.push([table, key, value]); return query; },
      order: () => query,
      maybeSingle: async () => ({ data: { status: branch === 'school-b' ? 'suspended' : 'active' }, error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: data[table], error: null }).then(resolve),
    };
    return query;
  };
  return { db: { from } as unknown as LearnerDatabase, calls };
}

describe('enrolled course tray list', () => {
  it('uses pinned titles even for archived or changed courses and excludes suspended historical school access', async () => {
    const { db, calls } = database();
    const result = await listEnrolledCourses({ userId: 'learner', roles: [] }, 'en', db);
    expect(result.courses).toEqual([{ id: 'archived', title: 'Archived pinned title' }, { id: 'changed', title: 'Original title' }]);
    expect(calls).toContainEqual(['enrollments', 'user_id', 'learner']);
    expect(calls).toContainEqual(['course_version_outline', 'version_id', ['old', 'pinned']]);
    expect(calls.some(([table]) => table === 'courses')).toBe(false);
  });
});
