import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  typedContentPageContext: vi.fn(),
}));

vi.mock('@/features/studio/drafts', () => ({ getDraft: vi.fn() }));
vi.mock('@/features/studio/ui/Workspace', () => ({ Workspace: vi.fn(() => null) }));
vi.mock('@/features/studio/workspace-serialization', () => ({ serializableWorkspaceDraft: vi.fn((draft) => draft) }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: mocks.typedContentPageContext,
  canUseTypedContentPermission: vi.fn(),
}));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ can: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import StudioCourseWorkspacePage from '@/app/studio/courses/[courseId]/page';

describe('Studio course workspace auth gate', () => {
  it('redirects before loading a draft when unauthenticated', async () => {
    mocks.typedContentPageContext.mockRejectedValueOnce(new Error('redirect:/login?next=%2Fstudio%2Fcourses%2Fcourse-one'));

    await expect(StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: 'course-one' }) }))
      .rejects.toThrow('redirect:/login?next=%2Fstudio%2Fcourses%2Fcourse-one');
  });

  it('keeps the course read permission check after authentication', async () => {
    mocks.typedContentPageContext.mockRejectedValueOnce(new Error('forbidden:403'));

    await expect(StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: 'course-one' }) }))
      .rejects.toThrow('forbidden:403');
  });
});
