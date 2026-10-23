import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getDraft: vi.fn(),
  validateDraft: vi.fn(),
  assertContentAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/permissions", () => ({
  can: mocks.hasPermission,
}));
vi.mock('@/features/admin/context', () => ({ adminPageContext: async () => ({ actor, scope: { kind: 'central' } }) }));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: mocks.assertContentAccess }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: async () => ({ actor, scope: { kind: 'central' } }),
  canUseTypedContentPermission: (value: unknown, _scope: unknown, _workflow: unknown, legacy: string) => mocks.hasPermission(value, legacy, { kind: 'central' }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock("@/features/studio/drafts", () => ({
  getDraft: mocks.getDraft,
  validateDraft: mocks.validateDraft,
}));

import StudioCourseWorkspacePage from "@/app/studio/courses/[courseId]/page";

const actor = { userId: "reader-1", roles: [{ role: "instructor", branchId: null }] };

describe("studio course workspace page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockImplementation((_value: unknown, permission: string) => permission === 'course.read');
    mocks.getDraft.mockResolvedValue({
      id: "draft-1",
      courseId: "course-1",
      manifest: {},
      items: Object.create(null),
      baseVersionId: null,
      checklist: {},
      updatedAt: null,
    });
    mocks.validateDraft.mockResolvedValue({ ok: true, errors: [], warnings: [], summary: {} });
  });

  it("passes read-only mode when a course reader lacks course.edit", async () => {
    const page = await StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: "course-1" }) });

    expect(mocks.hasPermission).toHaveBeenCalledWith(actor, "course.edit", { kind: 'central' });
    expect(page.props.readOnly).toBe(true);
    expect(mocks.getDraft).toHaveBeenCalledTimes(1);
    expect(mocks.validateDraft).not.toHaveBeenCalled();
  });
});
