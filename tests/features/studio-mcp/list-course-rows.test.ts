import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { mcpListCourses } from '@/features/studio-mcp/data/list-course-rows';
import { wrapReadOnlyDatabase } from '@/features/studio-mcp/db/read-only-database';
import type { Actor } from '@/lib/permissions';

const branchEditor: Actor = {
  userId: '11111111-1111-4111-8111-111111111111', roles: [],
  authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'branch-b', status: 'active' }],
    assignments: [{ roleDefinitionId: 'school_editor', scope: { kind: 'branch', branchId: 'branch-b' }, permissions: ['content.read', 'content.edit'] }],
  },
};

const courses = [
  { id: 'central-course', status: 'draft', ownership_kind: 'central', owner_branch_id: null, updated_at: '2026-09-26T00:00:00Z' },
  { id: 'branch-course', status: 'published', ownership_kind: 'branch', owner_branch_id: 'branch-b', updated_at: '2026-09-25T00:00:00Z' },
];
const drafts = [
  { course_id: 'central-course', updated_at: '2026-09-26T00:00:00Z', manifest: { title: 'Central course', languages: ['en'], defaultLanguage: 'en' } },
  { course_id: 'branch-course', updated_at: '2026-09-25T00:00:00Z', manifest: { title: { vi: 'Khóa học B' }, languages: ['vi'], defaultLanguage: 'vi' } },
];

function database(courseFixtures: typeof courses = courses, draftFixtures: typeof drafts = drafts) {
  const raw = {
    from(table: string) {
      let values: Record<string, unknown>[] = table === 'courses' ? courseFixtures : table === 'course_drafts' ? draftFixtures : [];
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { values = values.filter((row) => row[column] === value); return query; },
        in(column: string, allowed: unknown[]) { values = values.filter((row) => allowed.includes(row[column])); return query; },
        order() { return query; },
        range(from: number, to: number) { values = values.slice(from, to + 1); return query; },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) { return Promise.resolve(resolve({ data: values, error: null })); },
      };
      return query;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { oauth: { getClient: async () => ({ data: null, error: null }) } } },
  };
  return wrapReadOnlyDatabase(raw);
}

describe('MCP course listing scope', () => {
  it('refuses a branch editor who asks for central and defaults to their readable branch', async () => {
    const db = database();
    await expect(mcpListCourses(db, branchEditor, 'https://academy.example', {
      scope: 'central', limit: 50, offset: 0,
    })).rejects.toMatchObject({ code: 'INVALID_SCOPE' });

    const listed = await mcpListCourses(db, branchEditor, 'https://academy.example', { limit: 50, offset: 0 });
    expect(listed.scope).toBe('branch:branch-b');
    expect(listed.total).toBe(1);
    expect(listed.courses).toEqual([expect.objectContaining({
      courseId: 'branch-course', title: 'Khóa học B', ownerScopeKey: 'branch:branch-b', canEdit: true,
      studioUrl: 'https://academy.example/studio/courses/branch-course',
    })]);
  });

  it('pages across the database row cap while keeping a correct total', async () => {
    const courseFixtures = Array.from({ length: 250 }, (_, index) => ({
      id: `course-${String(index).padStart(3, '0')}`, status: 'draft',
      ownership_kind: 'branch', owner_branch_id: 'branch-b', updated_at: '2026-09-26T00:00:00Z',
    }));
    const listed = await mcpListCourses(database(courseFixtures, []), branchEditor, 'https://academy.example', {
      scope: 'branch:branch-b', limit: 1, offset: 210,
    });
    expect(listed.total).toBe(250);
    expect(listed.courses[0].courseId).toBe('course-210');
    expect(listed.nextOffset).toBe(211);
  });
});
