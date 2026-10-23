import 'server-only';
import { validateNotebookWorkspaceDependencies } from '@/features/notebooks/publish-dependencies';

import {
  getStudioContext,
  studioPageContext,
  assertWorkspacePermission,
  assertWorkspaceRequestScope,
  assertWorkspaceSameOrigin,
} from '@/features/workspace/context';
import { supabaseService } from '@/lib/supabase/server';
import { createContentReviewService, type ContentReviewDatabase } from './content-review';
import { assertContentAccess, type ContentType } from './content-review';
import { can, type Actor, type Permission, type Scope } from '@/lib/permissions';
import { ApiError } from '@/lib/api';
import { forbidden } from 'next/navigation';

const LEGACY_CONTENT_READ_PERMISSIONS = [
  'course.read', 'bank.edit', 'resource.edit', 'opportunity.edit', 'project.edit', 'media.upload',
] as const satisfies readonly Permission[];

export function canUseTypedContentPermission(
  actor: Actor,
  scope: Scope,
  workflowPermission: 'content.read' | 'content.create' | 'content.edit',
  legacyPermission: Permission,
) {
  return can(actor, workflowPermission, scope) || can(actor, legacyPermission, scope);
}

async function requestContext(request: Request, mutation: boolean) {
  const context = await getStudioContext();
  assertWorkspaceRequestScope(context, request);
  if (mutation) assertWorkspaceSameOrigin(request);
  return context;
}

function serviceFor(context: Awaited<ReturnType<typeof getStudioContext>>) {
  return createContentReviewService({
    database: supabaseService() as unknown as ContentReviewDatabase,
    actor: context.actor,
    scope: context.scope,
    notebookDependencies: validateNotebookWorkspaceDependencies,
  });
}

export async function contentReviewContext(request: Request, permission: 'content.read' | 'content.create' | 'content.edit' | 'content.review.request' | 'content.review' | 'content.publish', mutation = false) {
  const context = await requestContext(request, mutation);
  const legacyRead = permission === 'content.read'
    && LEGACY_CONTENT_READ_PERMISSIONS.some(candidate => can(context.actor, candidate, context.scope));
  const reviewRead = permission === 'content.read'
    && (can(context.actor, 'content.review', context.scope)
      || can(context.actor, 'content.publish', context.scope));
  if (!can(context.actor, permission, context.scope) && !legacyRead && !reviewRead) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  return {
    context,
    service: serviceFor(context),
  };
}

export async function typedContentContext(
  request: Request,
  workflowPermission: 'content.read' | 'content.create' | 'content.edit' | 'content.publish',
  legacyPermission: Permission,
  mutation = false,
) {
  const context = await requestContext(request, mutation);
  if (workflowPermission === 'content.publish') {
    assertWorkspacePermission(context, 'content.publish');
    assertWorkspacePermission(context, legacyPermission);
  } else if (!canUseTypedContentPermission(context.actor, context.scope, workflowPermission, legacyPermission)) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  return { context, service: serviceFor(context) };
}

export async function typedContentPageContext(
  workflowPermission: 'content.read' | 'content.create' | 'content.edit',
  legacyPermission: Permission,
) {
  const context = await studioPageContext();
  if (!canUseTypedContentPermission(context.actor, context.scope, workflowPermission, legacyPermission)) {
    forbidden();
  }
  return context;
}

export async function scopedContentContext(
  request: Request,
  contentType: ContentType,
  contentId: string,
  workflowPermission: 'content.read' | 'content.edit' | 'content.publish',
  legacyPermission: Permission,
  mutation = false,
) {
  const result = await typedContentContext(request, workflowPermission, legacyPermission, mutation);
  await assertContentAccess(
    supabaseService() as unknown as ContentReviewDatabase,
    result.context.actor,
    contentType,
    contentId,
    workflowPermission === 'content.edit' ? 'content.edit' : 'content.read',
  );
  return result;
}
