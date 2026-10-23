import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspaceContext: vi.fn(),
  getStudioContext: vi.fn(),
  assertRequestScope: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/workspace/context', () => ({
  getWorkspaceContext: mocks.getWorkspaceContext,
  workspacePageContext: mocks.getWorkspaceContext,
  getStudioContext: mocks.getStudioContext,
  studioPageContext: mocks.getStudioContext,
  assertWorkspacePermission: vi.fn(),
  assertWorkspaceRequestScope: mocks.assertRequestScope,
  assertWorkspaceSameOrigin: mocks.assertSameOrigin,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('next/navigation', () => ({ forbidden: vi.fn() }));

import { canUseTypedContentPermission, typedContentContext } from '@/features/admin/content-review-production';
import type { Actor } from '@/lib/authorization';

const narrowResourceActor: Actor = {
  userId: '00000000-0000-4000-8000-000000000003',
  roles: [],
  authorization: {
    source: 'database', accountStatus: 'active', memberships: [],
    assignments: [{
      roleDefinitionId: 'legacy_contributor_central', scope: { kind: 'central' },
      permissions: ['admin.access', 'resource.edit'],
    }],
  },
};

const genericEditor: Actor = {
  userId: '00000000-0000-4000-8000-000000000004',
  roles: [],
  authorization: {
    source: 'database', accountStatus: 'active', memberships: [],
    assignments: [{ roleDefinitionId: 'generic', scope: { kind: 'central' }, permissions: ['content.read', 'content.edit'] }],
  },
};

const reviewer: Actor = {
  userId: '00000000-0000-4000-8000-000000000005', roles: [], authorization: {
    source: 'database', accountStatus: 'active', memberships: [],
    assignments: [{ roleDefinitionId: 'reviewer', scope: { kind: 'central' }, permissions: ['content.review'] }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStudioContext.mockImplementation(() => mocks.getWorkspaceContext());
});

describe('typed CMS context authorization', () => {
  it('resolves the Studio scope for content requests instead of a different grading workspace scope', async () => {
    const studio = { workspace: 'studio', actor: narrowResourceActor, scope: { kind: 'central' as const }, options: [], permissions: ['resource.edit'], branches: [] };
    const grading = { ...studio, workspace: 'grading', scope: { kind: 'branch' as const, branchId: 'ans' }, permissions: ['submission.grade'] };
    mocks.getWorkspaceContext.mockResolvedValue(grading);
    mocks.getStudioContext.mockResolvedValue(studio);
    const request = new Request('https://example.test/api/v1/studio/resources/guide?scope=central');
    await expect(typedContentContext(request, 'content.read', 'resource.edit')).resolves.toMatchObject({ context: studio });
    expect(mocks.getStudioContext).toHaveBeenCalledOnce();
    expect(mocks.getWorkspaceContext).not.toHaveBeenCalled();
  });

  it('allows a narrow resource capability only for resource reads and edits', () => {
    expect(canUseTypedContentPermission(narrowResourceActor, { kind: 'central' }, 'content.read', 'resource.edit')).toBe(true);
    expect(canUseTypedContentPermission(narrowResourceActor, { kind: 'central' }, 'content.edit', 'resource.edit')).toBe(true);
    expect(canUseTypedContentPermission(narrowResourceActor, { kind: 'central' }, 'content.read', 'course.read')).toBe(false);
    expect(canUseTypedContentPermission(narrowResourceActor, { kind: 'central' }, 'content.edit', 'bank.edit')).toBe(false);
  });

  it('lets a generic editor operate on every type without a duplicate fine permission', () => {
    expect(canUseTypedContentPermission(genericEditor, { kind: 'central' }, 'content.read', 'bank.edit')).toBe(true);
    expect(canUseTypedContentPermission(genericEditor, { kind: 'central' }, 'content.edit', 'project.edit')).toBe(true);
  });

  it('uses the production request context to admit resource-only legacy access and deny bank access', async () => {
    const context = {
      actor: narrowResourceActor,
      scope: { kind: 'central' as const },
      options: [], permissions: ['admin.access', 'resource.edit'], branches: [],
    };
    mocks.getWorkspaceContext.mockResolvedValue(context);
    const request = new Request('https://example.test/api/v1/studio/resources/guide', { method: 'PUT' });

    await expect(typedContentContext(request, 'content.edit', 'resource.edit', true)).resolves.toMatchObject({ context });
    await expect(typedContentContext(request, 'content.edit', 'bank.edit', true)).rejects.toMatchObject({ status: 403 });
    expect(mocks.assertRequestScope).toHaveBeenCalledWith(context, request);
    expect(mocks.assertSameOrigin).toHaveBeenCalledWith(request);
  });

  it('lets a review-only role read the queue without granting any write capability', async () => {
    const context = { actor: reviewer, scope: { kind: 'central' as const }, options: [], permissions: ['content.review'], branches: [] };
    mocks.getWorkspaceContext.mockResolvedValue(context);
    await expect(typedContentContext(new Request('https://example.test/api/v1/studio/content'), 'content.read', 'course.read'))
      .rejects.toMatchObject({ status: 403 });
    const { contentReviewContext } = await import('@/features/admin/content-review-production');
    await expect(contentReviewContext(new Request('https://example.test/api/v1/studio/reviews'), 'content.read'))
      .resolves.toMatchObject({ context });
  });
});
