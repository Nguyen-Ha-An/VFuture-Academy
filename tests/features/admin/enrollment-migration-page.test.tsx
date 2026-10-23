import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: { userId: 'admin-1', roles: [{ role: 'admin', branchId: null }] },
  getActor: vi.fn(),
  hasPermission: vi.fn(),
  loginDestination: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
  listCourses: vi.fn(),
  in: vi.fn(),
  database: { from: vi.fn() },
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'en') }));
vi.mock('@/lib/permissions', () => ({ getActor: mocks.getActor, hasPermission: mocks.hasPermission }));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));
vi.mock('@/features/studio/drafts', () => ({ listCourses: mocks.listCourses }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => mocks.database) }));
vi.mock('@/features/enrollment/EnrollmentMigrationPanel', () => ({
  EnrollmentMigrationPanel: ({ courses }: { courses: unknown }) => ({ type: 'panel', props: { courses } }),
}));

import EnrollmentMigrationPage from '@/app/admin/enrollment-migration/page';

describe('Administration enrollment migration page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads draft manifests so course options use localized titles', async () => {
    mocks.getActor.mockResolvedValue(mocks.actor);
    mocks.hasPermission.mockReturnValue(true);
    mocks.listCourses.mockResolvedValue([{ id: 'course-one' }, { id: 'course-two' }]);
    mocks.in.mockReturnValue({ data: [
      { course_id: 'course-one', manifest: { title: { en: 'Course One' } } },
      { course_id: 'course-two', manifest: { title: { vi: 'Khóa học Hai' } } },
    ], error: null });
    mocks.database.from.mockReturnValue({
      select: vi.fn().mockReturnValue({ in: mocks.in }),
    });

    const page = await EnrollmentMigrationPage();

    expect(mocks.database.from).toHaveBeenCalledWith('course_drafts');
    expect(mocks.in).toHaveBeenCalledWith('course_id', ['course-one', 'course-two']);
    expect(page.props.courses).toEqual([
      { id: 'course-one', title: 'Course One' },
      { id: 'course-two', title: 'Khóa học Hai' },
    ]);
  });

  it('redirects before querying courses when unauthenticated', async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.loginDestination.mockResolvedValue('/login?next=%2Fadmin%2Fenrollment-migration');

    await expect(EnrollmentMigrationPage()).rejects.toThrow('redirect:/login?next=%2Fadmin%2Fenrollment-migration');
    expect(mocks.listCourses).not.toHaveBeenCalled();
  });

  it('keeps the publish permission check after authentication', async () => {
    mocks.getActor.mockResolvedValue(mocks.actor);
    mocks.hasPermission.mockReturnValue(false);

    await expect(EnrollmentMigrationPage()).rejects.toThrow('forbidden:403');
    expect(mocks.listCourses).not.toHaveBeenCalled();
  });

  it('keeps the existing unscoped course.publish gate after the move to Administration', async () => {
    mocks.getActor.mockResolvedValue(mocks.actor);
    mocks.hasPermission.mockReturnValue(true);
    mocks.listCourses.mockResolvedValue([]);

    await EnrollmentMigrationPage();

    expect(mocks.hasPermission).toHaveBeenCalledWith(mocks.actor, 'course.publish');
    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
  });
});
