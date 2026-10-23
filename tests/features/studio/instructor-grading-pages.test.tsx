import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: null as null | {
    userId: string;
    roles: { role: 'contributor' | 'branch_lead'; branchId: string | null }[];
  },
  database: null as unknown,
  forbidden: vi.fn(() => { throw new Error('NEXT_FORBIDDEN'); }),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT'); }),
  supabaseService: vi.fn(),
}));

vi.mock('@/features/workspace/context', () => ({ gradingPageContext: async () => ({ workspace: 'grading', actor: mocks.actor, scope: { kind: 'branch', branchId: 'branch-a' }, options: [], branches: [], permissions: [], entries: { studio: null, grading: '/grading', admin: null } }) }));
vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en') }));
vi.mock('next/navigation', () => ({
  forbidden: mocks.forbidden,
  redirect: mocks.redirect,
}));
vi.mock('@/lib/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/permissions')>();
  return { ...actual, getActor: vi.fn(async () => mocks.actor) };
});
vi.mock('@/lib/supabase/server', () => ({
  supabaseService: mocks.supabaseService,
}));

import AssessmentsPage from '@/app/grading/assessments/page';
import GradingQueuePage from '@/app/grading/queue/page';

type Filter = { method: 'eq' | 'in' | 'not'; column: string; value: unknown };
type QueryCall = {
  table: string;
  filters: Filter[];
  orders: string[];
  ranges: [number, number][];
};

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function createDatabase() {
  const tableData: Record<string, unknown[]> = {
    branches: [
      { id: 'branch-a', name: 'Branch A' },
      { id: 'branch-b', name: 'Branch B' },
    ],
    enrollments: [
      { id: 'enrollment-a', course_version_id: 'version-a', status: 'active', branch_id: 'branch-a', branch_scope_known: true },
      { id: 'enrollment-b', course_version_id: 'version-b', status: 'active', branch_id: 'branch-b', branch_scope_known: true },
    ],
    course_versions: [
      { id: 'version-a', course_id: 'course-a', version: 1 },
      { id: 'version-b', course_id: 'course-b', version: 1 },
    ],
    course_version_outline: [
      {
        version_id: 'version-a', course_id: 'course-a', meta: { title: { en: 'Course A' } },
        outline: { modules: [{ items: [{ id: 'lesson-a', title: { en: 'Lesson A' } }] }] },
      },
      {
        version_id: 'version-b', course_id: 'course-b', meta: { title: { en: 'Secret Course' } },
        outline: { modules: [{ items: [{ id: 'lesson-b', title: { en: 'Secret Lesson' } }] }] },
      },
    ],
    course_version_items: [
      {
        version_id: 'version-a', item_id: 'lesson-a', kind: 'lesson',
        grading: { rubrics: { 'assignment-a': { criteria: [{
          id: 'quality', name: 'Quality', maxPoints: 4,
          levels: [{ points: 4, label: 'Strong', description: 'Allowed description' }],
        }] } } },
      },
      {
        version_id: 'version-b', item_id: 'lesson-b', kind: 'lesson',
        grading: { rubrics: { 'assignment-b': { criteria: [{
          id: 'secret', name: 'Secret', maxPoints: 4,
          levels: [{ points: 4, label: 'Secret', description: 'OTHER BRANCH SECRET' }],
        }] } } },
      },
    ],
    course_version_item_renders: [],
  };
  const calls: QueryCall[] = [];

  function filteredRows(call: QueryCall) {
    return tableData[call.table].filter((value) => call.filters.every((filter) => {
      const row = record(value);
      const actual = row[filter.column];
      if (filter.method === 'eq') return actual === filter.value;
      if (filter.method === 'in') return (filter.value as unknown[]).includes(actual);
      return filter.value === null ? actual !== null : actual !== filter.value;
    }));
  }

  const database = {
    from: vi.fn((table: string) => {
      const call: QueryCall = { table, filters: [], orders: [], ranges: [] };
      calls.push(call);
      const query = {
        select: vi.fn(function (this: unknown) { return this; }),
        eq: vi.fn(function (this: unknown, column: string, value: unknown) {
          call.filters.push({ method: 'eq', column, value });
          return this;
        }),
        in: vi.fn(function (this: unknown, column: string, value: unknown) {
          call.filters.push({ method: 'in', column, value });
          return this;
        }),
        not: vi.fn(function (this: unknown, column: string, _operator: string, value: unknown) {
          call.filters.push({ method: 'not', column, value });
          return this;
        }),
        order: vi.fn(function (this: unknown, column: string) {
          call.orders.push(column);
          return this;
        }),
        range: vi.fn((from: number, to: number) => {
          call.ranges.push([from, to]);
          return Promise.resolve({ data: filteredRows(call).slice(from, to + 1), error: null });
        }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: filteredRows(call), error: null }).then(resolve);
        },
      };
      return query;
    }),
  };
  return { database, calls };
}

describe('instructor grading page authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fixture = createDatabase();
    mocks.database = fixture;
    mocks.supabaseService.mockImplementation(() => fixture.database);
  });

  it('returns the grading queue 403 page before creating a service client for a contributor', async () => {
    mocks.actor = { userId: 'contributor-1', roles: [{ role: 'contributor', branchId: null }] };

    await expect(GradingQueuePage()).rejects.toThrow('NEXT_FORBIDDEN');
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });

  it('returns the assessments 403 page before creating a service client for a contributor', async () => {
    mocks.actor = { userId: 'contributor-1', roles: [{ role: 'contributor', branchId: null }] };

    await expect(AssessmentsPage()).rejects.toThrow('NEXT_FORBIDDEN');
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });

  it('loads only the active school for a multi-school branch lead in bounded pages', async () => {
    mocks.actor = { userId: 'lead-1', roles: [{ role: 'branch_lead', branchId: 'branch-a' }, { role: 'branch_lead', branchId: 'branch-b' }] };

    const page = await GradingQueuePage() as ReactElement<{
      branches: unknown[];
      courses: unknown[];
      assignments: unknown[];
    }>;
    const fixture = mocks.database as ReturnType<typeof createDatabase>;

    expect(page.props.branches).toEqual([{ id: 'branch-a', name: 'Branch A' }]);
    expect(page.props.courses).toEqual([{ id: 'course-a', title: 'Course A' }]);
    expect(page.props.assignments).toHaveLength(1);
    expect(JSON.stringify(page.props)).toContain('Allowed description');
    expect(JSON.stringify(page.props)).not.toContain('OTHER BRANCH SECRET');
    expect(fixture.calls.find(({ table }) => table === 'enrollments')?.filters).toContainEqual({
      method: 'eq', column: 'branch_scope_known', value: true,
    });
    expect(fixture.calls.find(({ table }) => table === 'enrollments')?.filters).toContainEqual({
      method: 'in', column: 'branch_id', value: ['branch-a'],
    });
    expect(fixture.calls.find(({ table }) => table === 'course_versions')?.filters).toContainEqual({
      method: 'in', column: 'id', value: ['version-a'],
    });
    expect(fixture.calls.every(({ ranges }) => ranges.some(([from, to]) => from === 0 && to === 49))).toBe(true);
    expect(fixture.calls.find(({ table }) => table === 'enrollments')?.orders).toEqual(['course_version_id', 'id']);
    expect(fixture.calls.find(({ table }) => table === 'course_version_items')?.orders).toEqual(['version_id', 'item_id']);
    expect(fixture.calls.find(({ table }) => table === 'course_version_item_renders')?.orders).toEqual(['version_id', 'item_id', 'locale']);
  });
});
