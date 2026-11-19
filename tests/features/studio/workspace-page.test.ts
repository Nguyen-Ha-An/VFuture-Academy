import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from '@/lib/api';

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
      manifest: { modules: [{ items: [{ type: 'exam', sections: [{ questions: [{ correctAnswer: 'inline-key', content: 'Read this question' }] }] }] }] },
      items: { lesson: { blocks: [{ questions: [{ explanation: 'private-explanation', sampleSolution: 'private-solution' }] }] } },
      baseVersionId: null,
      checklist: { answerKeysVerified: true, extra: 'private-checklist' },
      updatedAt: null,
      revision: 'raw-fingerprint',
    });
    mocks.validateDraft.mockResolvedValue({ ok: true, errors: [], warnings: [], summary: {} });
  });

  it("passes read-only mode when a course reader lacks course.edit", async () => {
    const page = await StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: "course-1" }) });

    expect(mocks.hasPermission).toHaveBeenCalledWith(actor, "course.edit", { kind: 'central' });
    expect(page.props.readOnly).toBe(true);
    expect(page.key).toBe('reader-1/central/course-1/reader');
    expect(page.props.initialDraft.checklist).toEqual({ answerKeysVerified: true });
    expect(JSON.stringify(page.props.initialDraft)).toContain('Read this question');
    expect(JSON.stringify(page.props.initialDraft)).not.toMatch(/inline-key|private-|raw-fingerprint/);
    expect(Object.getPrototypeOf(page.props.initialDraft.manifest.modules[0].items[0])).toBe(Object.prototype);
    expect(mocks.getDraft).toHaveBeenCalledTimes(1);
    expect(mocks.validateDraft).not.toHaveBeenCalled();
  });

  it('uses a reader view when the active scope can edit but the course owner denies editing', async () => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.assertContentAccess.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const page = await StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: 'course-1' }) });
    expect(page.props.readOnly).toBe(true);
    expect(JSON.stringify(page.props.initialDraft)).not.toContain('inline-key');
  });

  it('provides the complete source to an authorized course editor', async () => {
    mocks.hasPermission.mockReturnValue(true);
    const page = await StudioCourseWorkspacePage({ params: Promise.resolve({ courseId: 'course-1' }) });
    expect(mocks.assertContentAccess).toHaveBeenCalledWith({}, actor, 'course', 'course-1', 'content.edit');
    expect(page.props.readOnly).toBe(false);
    expect(page.key).toBe('reader-1/central/course-1/editor');
    expect(JSON.stringify(page.props.initialDraft)).toContain('inline-key');
    expect(page.props.initialDraft.revision).toBe('raw-fingerprint');
  });
});
