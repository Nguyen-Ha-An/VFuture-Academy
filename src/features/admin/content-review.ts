import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { can, type Actor, type Scope } from '@/lib/authorization';

export const ContentTypeSchema = z.enum([
  'course',
  'bank_question',
  'resource',
  'opportunity',
  'project',
  'media_asset',
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const ReviewDecisionSchema = z.enum(['approve', 'changes_requested']);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export interface ContentReviewDatabase {
  rpc(name: string, args?: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message?: string; code?: string; details?: string } | null;
  }>;
}

export type ContentReviewServiceDependencies = {
  database: ContentReviewDatabase;
  actor: Actor;
  scope: Scope;
  notebookDependencies?: NotebookReviewDependencyAdapter;
};

export type NotebookPublishDependency = {
  itemId: string;
  blockId: string | null;
  runtimeMode: string;
  runtimeProfileId: string;
  runtimeProfileVersion: string;
  colabReason: string | null;
  assets: Array<{ id: string; checksum: string; sizeBytes: number; purpose: string }>;
};
export type NotebookReviewDependencyAdapter = (
  courseId: string,
  items: Record<string, unknown>,
) => Promise<NotebookPublishDependency[]>;

function requireCapability(actor: Actor, permission: 'content.read' | 'content.create' | 'content.review.request' | 'content.review' | 'content.publish', scope: Scope) {
  const legacyRead = permission === 'content.read' && [
    'course.read', 'bank.edit', 'resource.edit', 'opportunity.edit', 'project.edit', 'media.upload',
  ].some(candidate => can(actor, candidate as Parameters<typeof can>[1], scope));
  const reviewRead = permission === 'content.read'
    && (can(actor, 'content.review', scope) || can(actor, 'content.publish', scope));
  if (!can(actor, permission, scope) && !legacyRead && !reviewRead) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
}

function databaseFailure(operation: string, error: { message?: string; code?: string; details?: string }): never {
  const message = error.message ?? operation;
  if (message.includes('CMS_REVIEW_PENDING')) {
    throw new ApiError(409, 'CMS_REVIEW_PENDING', 'This revision is locked while its review is pending');
  }
  if (message.includes('CMS_REVIEW_NOT_PENDING') || message.includes('CMS_REVIEW_NOT_PUBLISHABLE')) {
    throw new ApiError(409, 'CMS_REVIEW_NOT_PUBLISHABLE', 'The review can no longer be published');
  }
  if (message.includes('CMS_STALE_REVIEW') || message.includes('CMS_REVISION_CHANGED')) {
    throw new ApiError(409, 'CMS_STALE_REVIEW', 'The reviewed revision is no longer current');
  }
  if (message.includes('CMS_FOREIGN_ASSET')) {
    throw new ApiError(422, 'CMS_FOREIGN_ASSET', 'The draft references an asset owned by another school');
  }
  if (message.includes('CMS_DEPENDENCY_CHANGED')) {
    throw new ApiError(409, 'CMS_DEPENDENCY_CHANGED', 'A reviewed dependency has changed');
  }
  if (message.includes('FORBIDDEN') || error.code === '42501') {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
  if (message.includes('NOT_FOUND') || error.code === 'P0002') {
    throw new ApiError(404, 'NOT_FOUND', 'Content or review request was not found');
  }
  throw new ApiError(500, 'CMS_DATABASE_ERROR', operation);
}

async function rpc(database: ContentReviewDatabase, name: string, args: Record<string, unknown>) {
  const result = await database.rpc(name, args);
  if (result.error) databaseFailure(`CMS operation ${name} failed`, result.error);
  return result.data;
}

function scopeArgs(scope: Scope) {
  return scope.kind === 'central'
    ? { p_scope_kind: 'central', p_branch_id: null }
    : { p_scope_kind: 'branch', p_branch_id: scope.branchId };
}

function valueRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function containsNotebook(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNotebook);
  const object = valueRecord(value);
  if (!object) return false;
  if (object.type === 'notebook' || typeof object.runtimeMode === 'string' || typeof object.runtimeProfileId === 'string') return true;
  return Object.values(object).some(containsNotebook);
}

export function createContentReviewService({ database, actor, scope, notebookDependencies }: ContentReviewServiceDependencies) {
  return {
    async workflow(contentType: ContentType, contentId: string) {
      requireCapability(actor, 'content.read', scope);
      return rpc(database, 'cms_get_workflow', {
        p_actor_user_id: actor.userId,
        p_content_type: ContentTypeSchema.parse(contentType),
        p_content_id: z.string().min(1).parse(contentId),
      });
    },

    async mediaEditorState(contentId: string) {
      const id = z.string().min(1).parse(contentId);
      const candidate = valueRecord(await rpc(database, 'cms_get_editor_content', {
        p_actor_user_id: actor.userId,
        p_content_type: 'media_asset',
        p_content_id: id,
      }));
      const source = valueRecord(candidate?.source);
      const asset = valueRecord(source?.asset);
      const alt = valueRecord(asset?.alt);
      const revisionKey = candidate?.revision_key;
      if (!asset || asset.id !== id || typeof revisionKey !== 'string') {
        throw new ApiError(500, 'CMS_DATABASE_ERROR', 'Media editor state is invalid');
      }
      return {
        id,
        alt: { vi: typeof alt?.vi === 'string' ? alt.vi : '', en: typeof alt?.en === 'string' ? alt.en : '' },
        revisionKey,
      };
    },

    async saveMediaAlt(contentId: string, expectedRevision: string, alt: { vi: string; en: string }) {
      const id = z.string().min(1).parse(contentId);
      const candidate = valueRecord(await rpc(database, 'cms_get_editor_content', {
        p_actor_user_id: actor.userId,
        p_content_type: 'media_asset',
        p_content_id: id,
      }));
      const source = valueRecord(candidate?.source);
      const asset = valueRecord(source?.asset);
      if (!asset || asset.id !== id) throw new ApiError(500, 'CMS_DATABASE_ERROR', 'Media editor state is invalid');
      const saved = valueRecord(await rpc(database, 'cms_save_content_draft', {
        p_actor_user_id: actor.userId,
        p_content_type: 'media_asset',
        p_content_id: id,
        p_expected_revision: z.string().min(1).parse(expectedRevision),
        p_source: { asset: { ...asset, alt } },
        p_audience: {},
      }));
      if (typeof saved?.revision_key !== 'string') {
        throw new ApiError(500, 'CMS_DATABASE_ERROR', 'Media draft revision is invalid');
      }
      return { id, alt, revisionKey: saved.revision_key };
    },

    async listContent() {
      requireCapability(actor, 'content.read', scope);
      const data = await rpc(database, 'cms_list_content', {
        p_actor_user_id: actor.userId,
        ...scopeArgs(scope),
      });
      return Array.isArray(data) ? data : [];
    },

    async listReviews() {
      requireCapability(actor, 'content.read', scope);
      const data = await rpc(database, 'cms_list_reviews', {
        p_actor_user_id: actor.userId,
        ...scopeArgs(scope),
      });
      return Array.isArray(data) ? data : [];
    },

    async reviewPreview(reviewId: string) {
      requireCapability(actor, 'content.review', { kind: 'central' });
      if (scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central scope is required');
      return rpc(database, 'cms_get_review_preview', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
      });
    },

    async assignOwnership(contentType: ContentType, contentId: string) {
      const legacyPermission = {
        course: 'course.create', bank_question: 'bank.edit', resource: 'resource.edit',
        opportunity: 'opportunity.edit', project: 'project.edit', media_asset: 'media.upload',
      }[contentType] as Parameters<typeof can>[1];
      if (!can(actor, 'content.create', scope) && !can(actor, legacyPermission, scope)) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      return rpc(database, 'cms_assign_ownership', {
        p_actor_user_id: actor.userId,
        p_content_type: ContentTypeSchema.parse(contentType),
        p_content_id: z.string().min(1).parse(contentId),
        p_ownership_kind: scope.kind,
        p_owner_branch_id: scope.kind === 'branch' ? scope.branchId : null,
      });
    },

    async requestReview(contentType: ContentType, contentId: string, expectedRevision: string) {
      requireCapability(actor, 'content.review.request', scope);
      let frozenNotebookDependencies: NotebookPublishDependency[] | null = null;
      if (contentType === 'course') {
        const candidate = await rpc(database, 'cms_review_candidate', {
          p_actor_user_id: actor.userId,
          p_content_type: contentType,
          p_content_id: contentId,
          p_expected_revision: expectedRevision,
        });
        const source = valueRecord(valueRecord(candidate)?.source);
        const items = valueRecord(source?.items) ?? {};
        if (containsNotebook(items)) {
          if (!notebookDependencies) {
            throw new ApiError(503, 'CMS_NOTEBOOK_ADAPTER_REQUIRED', 'Notebook dependency validation is unavailable');
          }
          frozenNotebookDependencies = await notebookDependencies(contentId, items);
        }
      }
      return rpc(database, 'cms_request_review', {
        p_actor_user_id: actor.userId,
        p_content_type: ContentTypeSchema.parse(contentType),
        p_content_id: z.string().min(1).parse(contentId),
        p_expected_revision: z.string().min(1).parse(expectedRevision),
        p_notebook_dependencies: frozenNotebookDependencies,
      });
    },

    async decideReview(reviewId: string, decision: ReviewDecision, note: string) {
      requireCapability(actor, 'content.review', { kind: 'central' });
      if (scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central scope is required');
      return rpc(database, 'cms_decide_review', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
        p_decision: ReviewDecisionSchema.parse(decision),
        p_note: z.string().trim().min(1).max(4000).parse(note),
      });
    },

    async withdrawReview(reviewId: string) {
      return rpc(database, 'cms_withdraw_review', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
      });
    },

    async approvalCandidate(reviewId: string) {
      requireCapability(actor, 'content.review', { kind: 'central' });
      requireCapability(actor, 'content.publish', { kind: 'central' });
      if (scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central scope is required');
      return rpc(database, 'cms_get_approval_candidate', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
      });
    },

    async approveAndPublish(reviewId: string, expectedRevision: string, note: string, coursePublication: unknown | null) {
      requireCapability(actor, 'content.review', { kind: 'central' });
      requireCapability(actor, 'content.publish', { kind: 'central' });
      if (scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central scope is required');
      const result = await rpc(database, 'cms_approve_and_publish', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
        p_expected_revision: z.string().min(1).parse(expectedRevision),
        p_note: z.string().trim().min(1).max(4000).parse(note),
        p_course_publication: coursePublication,
      });
      if (valueRecord(result)?.status === 'stale') {
        throw new ApiError(409, 'CMS_STALE_REVIEW', 'The reviewed revision is no longer current');
      }
      return result;
    },

    async publishReview(reviewId: string) {
      requireCapability(actor, 'content.review', { kind: 'central' });
      requireCapability(actor, 'content.publish', { kind: 'central' });
      if (scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central scope is required');
      const result = await rpc(database, 'cms_publish_review', {
        p_actor_user_id: actor.userId,
        p_review_id: z.string().uuid().parse(reviewId),
      });
      if (typeof result === 'object' && result !== null && 'status' in result && result.status === 'stale') {
        throw new ApiError(409, 'CMS_STALE_REVIEW', 'The reviewed revision is no longer current');
      }
      return result;
    },
  };
}

export async function assertReviewedPublication(
  database: ContentReviewDatabase,
  actor: Actor,
  contentType: ContentType,
  contentId: string,
  revision: string,
) {
  requireCapability(actor, 'content.review', { kind: 'central' });
  requireCapability(actor, 'content.publish', { kind: 'central' });
  return rpc(database, 'cms_assert_publishable', {
    p_actor_user_id: actor.userId,
    p_content_type: ContentTypeSchema.parse(contentType),
    p_content_id: z.string().min(1).parse(contentId),
    p_revision_key: z.string().min(1).parse(revision),
  });
}

export async function assertContentAccess(
  database: ContentReviewDatabase,
  actor: Actor,
  contentType: ContentType,
  contentId: string,
  permission: 'content.read' | 'content.edit' | 'content.review.request',
) {
  return rpc(database, 'cms_assert_content_access', {
    p_actor_user_id: actor.userId,
    p_content_type: ContentTypeSchema.parse(contentType),
    p_content_id: z.string().min(1).parse(contentId),
    p_permission: permission,
  });
}
