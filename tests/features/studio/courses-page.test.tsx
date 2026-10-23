import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const courses = [
    { id: 'course-one', status: 'draft', owner_id: 'owner-1', current_version_id: 'version-1', updated_at: '2026-09-03T00:00:00Z' },
    { id: 'course-two', status: 'published', owner_id: 'owner-2', current_version_id: 'version-2', updated_at: '2026-09-02T00:00:00Z' },
  ];
  const tableData: Record<string, unknown[]> = {
    course_drafts: [
      { course_id: 'course-one', manifest: { title: { en: 'Course one' } } },
      { course_id: 'course-two', manifest: { title: { en: 'Course two' } } },
    ],
    profiles: [{ id: 'owner-1', display_name: 'Owner one' }, { id: 'owner-2', display_name: 'Owner two' }],
    course_versions: [{ id: 'version-1', version: 1 }, { id: 'version-2', version: 2 }],
    cms_review_requests: [
      { content_id: 'course-one', status: 'changes_requested', submitted_at: '2026-09-01T00:00:00Z' },
      { content_id: 'course-one', status: 'pending', submitted_at: '2026-09-04T00:00:00Z' },
      { content_id: 'course-two', status: 'published', submitted_at: '2026-09-01T00:00:00Z' },
    ],
  };
  const tableErrors: Record<string, unknown> = {};
  const queries: Array<{ table: string; in: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }> = [];
  const database = {
    from: vi.fn((table: string) => {
      const inCall = vi.fn(function (this: unknown) { return this; });
      const eqCall = vi.fn(function (this: unknown) { return this; });
      const query = {
        select: vi.fn(function (this: unknown) { return this; }),
        order: vi.fn(function (this: unknown) { return this; }),
        limit: vi.fn(function (this: unknown) { return this; }),
        eq: eqCall,
        in: inCall,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          const error = tableErrors[table] ?? null;
          return Promise.resolve({ data: error ? null : tableData[table], error }).then(resolve);
        },
      };
      queries.push({ table, in: inCall, eq: eqCall });
      return query;
    }),
  };
  return {
    courses, database, queries, tableErrors, tableData, listCourses: vi.fn().mockResolvedValue(courses),
    typedContentPageContext: vi.fn().mockResolvedValue({ actor: {}, scope: { kind: 'central' } }),
    canUseTypedContentPermission: vi.fn(() => false),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn().mockResolvedValue('en'),
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/features/studio/drafts', () => ({ listCourses: mocks.listCourses }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: mocks.typedContentPageContext,
  canUseTypedContentPermission: mocks.canUseTypedContentPermission,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => mocks.database) }));

import StudioCoursesPage from '@/app/studio/courses/page';
import type { CoursesViewProps } from '@/features/studio/ui/CoursesView';

async function viewProps(): Promise<CoursesViewProps> {
  const element = await StudioCoursesPage();
  return (element as unknown as { props: CoursesViewProps }).props;
}

describe('Studio courses page queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queries.length = 0;
    for (const key of Object.keys(mocks.tableErrors)) delete mocks.tableErrors[key];
  });

  it('hydrates metadata for many courses with one query per related table', async () => {
    await StudioCoursesPage();

    expect(mocks.database.from).toHaveBeenCalledTimes(4);
    const reviews = mocks.queries.find((query) => query.table === 'cms_review_requests');
    expect(reviews?.eq).toHaveBeenCalledWith('content_type', 'course');
    expect(reviews?.in).toHaveBeenCalledWith('content_id', ['course-one', 'course-two']);
    expect(mocks.queries.find((query) => query.table === 'course_drafts')?.in).toHaveBeenCalledWith('course_id', ['course-one', 'course-two']);
    expect(mocks.queries.find((query) => query.table === 'profiles')?.in).toHaveBeenCalledWith('id', ['owner-1', 'owner-2']);
    expect(mocks.queries.find((query) => query.table === 'course_versions')?.in).toHaveBeenCalledWith('id', ['version-1', 'version-2']);
  });

  it("derives each course's stage from its latest review request", async () => {
    const props = await viewProps();

    expect(props.reviews).toBe('ready');
    expect(props.rows.map(({ id, reviewStatus, stage, title, version, owner }) => ({ id, reviewStatus, stage, title, version, owner }))).toEqual([
      { id: 'course-one', reviewStatus: 'pending', stage: 'in_review', title: 'Course one', version: 1, owner: 'Owner one' },
      { id: 'course-two', reviewStatus: 'published', stage: 'published', title: 'Course two', version: 2, owner: 'Owner two' },
    ]);
  });

  it('reports review states unavailable when the bounded history read comes back full', async () => {
    const saved = mocks.tableData.cms_review_requests;
    mocks.tableData.cms_review_requests = Array.from({ length: 1000 }, (_, index) => ({ content_id: 'course-one', status: 'pending', submitted_at: `2026-09-01T00:00:${String(index % 60).padStart(2, '0')}Z` }));
    try {
      const props = await viewProps();
      expect(props.reviews).toBe('unavailable');
    } finally {
      mocks.tableData.cms_review_requests = saved;
    }
  });

  it('keeps the list when review requests cannot be read and says review states are unavailable', async () => {
    mocks.tableErrors.cms_review_requests = { message: 'denied' };

    const props = await viewProps();

    expect(props.reviews).toBe('unavailable');
    expect(props.rows.map(({ id, reviewStatus, stage }) => ({ id, reviewStatus, stage }))).toEqual([
      { id: 'course-one', reviewStatus: null, stage: 'draft' },
      { id: 'course-two', reviewStatus: null, stage: 'published' },
    ]);
  });

  it('still fails loudly when course metadata cannot be read', async () => {
    mocks.tableErrors.course_drafts = { message: 'boom' };

    await expect(StudioCoursesPage()).rejects.toThrow('Course metadata could not be loaded');
  });

  it('does not load courses when the page context redirects an unauthenticated visitor', async () => {
    mocks.typedContentPageContext.mockRejectedValueOnce(new Error('redirect:/login?next=%2Fstudio%2Fcourses'));

    await expect(StudioCoursesPage()).rejects.toThrow('redirect:/login?next=%2Fstudio%2Fcourses');
    expect(mocks.listCourses).not.toHaveBeenCalled();
  });

  it('does not load courses when the page context rejects course access', async () => {
    mocks.typedContentPageContext.mockRejectedValueOnce(new Error('forbidden:403'));

    await expect(StudioCoursesPage()).rejects.toThrow('forbidden:403');
    expect(mocks.listCourses).not.toHaveBeenCalled();
  });
});
