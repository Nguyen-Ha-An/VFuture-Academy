import { describe, expect, it } from 'vitest';

import {
  createContentReviewService,
  type ContentReviewDatabase,
} from '@/features/admin/content-review';
import type { Actor } from '@/lib/permissions';

const centralActor: Actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  roles: [],
  authorization: {
    source: 'database',
    accountStatus: 'active',
    memberships: [],
    assignments: [{
      roleDefinitionId: 'reviewer',
      scope: { kind: 'central' },
      permissions: ['admin.access', 'content.read', 'content.review.request', 'content.review', 'content.publish'],
    }],
  },
};

const schoolActor: Actor = {
  userId: '00000000-0000-4000-8000-000000000002',
  roles: [],
  authorization: {
    source: 'database',
    accountStatus: 'active',
    memberships: [{ branchId: 'ans', status: 'active' }],
    assignments: [{
      roleDefinitionId: 'school-editor',
      scope: { kind: 'branch', branchId: 'ans' },
      permissions: ['admin.access', 'content.read', 'content.review.request'],
    }],
  },
};

const legacyResourceContributor: Actor = {
  userId: '00000000-0000-4000-8000-000000000003',
  roles: [],
  authorization: {
    source: 'database',
    accountStatus: 'active',
    memberships: [],
    assignments: [{
      roleDefinitionId: 'legacy_contributor_central',
      scope: { kind: 'central' },
      permissions: ['admin.access', 'resource.edit'],
    }],
  },
};

function database(result: unknown = []): ContentReviewDatabase & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    async rpc(name, args = {}) {
      calls.push([name, args]);
      return { data: result, error: null };
    },
  };
}

describe('content review service', () => {
  const reviewId = '00000000-0000-4000-8000-000000000010';
  it('derives the branch inventory scope from the trusted admin context', async () => {
    const db = database([{ content_type: 'resource', content_id: 'guide', owner_branch_id: 'ans' }]);
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await expect(service.listContent()).resolves.toHaveLength(1);
    expect(db.calls[0]).toEqual(['cms_list_content', {
      p_actor_user_id: schoolActor.userId,
      p_scope_kind: 'branch',
      p_branch_id: 'ans',
    }]);
  });

  it('requests a server-derived snapshot without accepting source from the caller', async () => {
    const db = database({ id: 'review-1', status: 'pending' });
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await service.requestReview('course', 'course-one', 'revision-7');

    expect(db.calls[1]).toEqual(['cms_request_review', {
      p_actor_user_id: schoolActor.userId,
      p_content_type: 'course',
      p_content_id: 'course-one',
      p_expected_revision: 'revision-7',
      p_notebook_dependencies: null,
    }]);
  });

  it('allows an explicitly recorded self-review decision for a central reviewer', async () => {
    const db = database({ id: 'review-1', status: 'approved', self_review: true });
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await service.decideReview(reviewId, 'approve', 'Reviewed against the rubric');

    expect(db.calls[0]).toEqual(['cms_decide_review', {
      p_actor_user_id: centralActor.userId,
      p_review_id: reviewId,
      p_decision: 'approve',
      p_note: 'Reviewed against the rubric',
    }]);
  });

  it('rejects review decisions from branch scope before calling PostgreSQL', async () => {
    const db = database();
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await expect(service.decideReview(reviewId, 'approve', 'Looks good')).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toHaveLength(0);
  });

  it('publishes only through the atomic reviewed-publication RPC', async () => {
    const db = database({ content_type: 'resource', content_id: 'guide', status: 'published' });
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await service.publishReview(reviewId);

    expect(db.calls[0]).toEqual(['cms_publish_review', {
      p_actor_user_id: centralActor.userId,
      p_review_id: reviewId,
    }]);
  });

  it('reports stale review publication as a conflict even when the RPC completed successfully', async () => {
    const service = createContentReviewService({ database: database({ status: 'stale' }), actor: centralActor, scope: { kind: 'central' } });
    await expect(service.publishReview(reviewId)).rejects.toMatchObject({ status: 409, code: 'CMS_STALE_REVIEW' });
  });

  it('fails closed when a course contains notebooks and no dependency adapter is registered', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const db: ContentReviewDatabase = { async rpc(name, args = {}) {
      calls.push([name, args]);
      return { data: { source: { items: { lesson: { blocks: [{ id: 'lab', type: 'notebook' }] } } } }, error: null };
    } };
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await expect(service.requestReview('course', 'course-one', 'revision-7')).rejects.toMatchObject({
      status: 503,
      code: 'CMS_NOTEBOOK_ADAPTER_REQUIRED',
    });
    expect(calls.map(([name]) => name)).toEqual(['cms_review_candidate']);
  });

  it('freezes validated notebook runtime and asset dependencies into the review request', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const frozen = [{ itemId: 'lesson', blockId: 'lab', runtimeMode: 'sql', runtimeProfileId: 'safe', runtimeProfileVersion: '3', colabReason: null, assets: [{ id: 'dataset', checksum: 'sha', sizeBytes: 10, purpose: 'dataset' }] }];
    const db: ContentReviewDatabase = { async rpc(name, args = {}) {
      calls.push([name, args]);
      if (name === 'cms_review_candidate') return { data: { source: { items: { lesson: { blocks: [{ id: 'lab', type: 'notebook' }] } } } }, error: null };
      return { data: { id: 'review-1', status: 'pending' }, error: null };
    } };
    const service = createContentReviewService({
      database: db,
      actor: centralActor,
      scope: { kind: 'central' },
      notebookDependencies: async (courseId, items) => {
        expect(courseId).toBe('course-one');
        expect(items).toHaveProperty('lesson');
        return frozen;
      },
    });

    await service.requestReview('course', 'course-one', 'revision-7');

    expect(calls[1]).toEqual(['cms_request_review', expect.objectContaining({ p_notebook_dependencies: frozen })]);
  });

  it('lets a narrow legacy contributor assign resource ownership without granting course creation', async () => {
    const db = database({ content_type: 'resource', content_id: 'guide' });
    const service = createContentReviewService({ database: db, actor: legacyResourceContributor, scope: { kind: 'central' } });

    await expect(service.assignOwnership('resource', 'guide')).resolves.toBeTruthy();
    await expect(service.assignOwnership('course', 'course-one')).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toHaveLength(1);
  });

  it('loads exact reviewed and published snapshots only for a Central reviewer', async () => {
    const reviewId = '00000000-0000-4000-8000-000000000010';
    const db = database({ review: { id: reviewId }, reviewed: { title: 'Draft' }, published: { title: 'Live' } });
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await expect(service.reviewPreview(reviewId)).resolves.toMatchObject({ reviewed: { title: 'Draft' }, published: { title: 'Live' } });
    expect(db.calls[0]).toEqual(['cms_get_review_preview', { p_actor_user_id: centralActor.userId, p_review_id: reviewId }]);

    const branchService = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });
    await expect(branchService.reviewPreview(reviewId)).rejects.toMatchObject({ status: 403 });
  });

  it('loads one content workflow through the server-owned workflow projection', async () => {
    const workflow = {
      content: { contentType: 'course', contentId: 'course-one', revisionKey: 'revision-7', status: 'pending', publishedRevisionKey: null },
      activeReview: { id: reviewId, status: 'pending', revisionKey: 'revision-7', note: null },
      publication: null,
      actions: { requestReview: false, withdrawReview: true, approveAndPublish: false, mutate: false },
    };
    const db = database(workflow);
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await expect(service.workflow('course', 'course-one')).resolves.toEqual(workflow);
    expect(db.calls[0]).toEqual(['cms_get_workflow', {
      p_actor_user_id: schoolActor.userId,
      p_content_type: 'course',
      p_content_id: 'course-one',
    }]);
  });

  it('withdraws a pending review through the guarded database operation', async () => {
    const db = database({ id: reviewId, status: 'withdrawn' });
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await service.withdrawReview(reviewId);

    expect(db.calls[0]).toEqual(['cms_withdraw_review', {
      p_actor_user_id: schoolActor.userId,
      p_review_id: reviewId,
    }]);
  });

  it('approves and publishes with one RPC carrying the exact reviewed revision', async () => {
    const db = database({ id: reviewId, status: 'published' });
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await service.approveAndPublish(reviewId, 'revision-7', 'Reviewed and ready', null);

    expect(db.calls[0]).toEqual(['cms_approve_and_publish', {
      p_actor_user_id: centralActor.userId,
      p_review_id: reviewId,
      p_expected_revision: 'revision-7',
      p_note: 'Reviewed and ready',
      p_course_publication: null,
    }]);
  });

  it('maps a pending-review mutation gate to a stable conflict', async () => {
    const db: ContentReviewDatabase = { async rpc() {
      return { data: null, error: { code: '55000', message: 'CMS_REVIEW_PENDING' } };
    } };
    const service = createContentReviewService({ database: db, actor: schoolActor, scope: { kind: 'branch', branchId: 'ans' } });

    await expect(service.withdrawReview(reviewId)).rejects.toMatchObject({ status: 409, code: 'CMS_REVIEW_PENDING' });
  });

  it('reads and saves media alt text through the isolated CMS draft', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const candidate = { revision_key: 'asset-revision', source: { asset: { id: 'asset_IMAGE', path: 'image.png', alt: { vi: '', en: '' } } } };
    const db: ContentReviewDatabase = { async rpc(name, args = {}) {
      calls.push([name, args]);
      return name === 'cms_get_editor_content'
        ? { data: candidate, error: null }
        : { data: { id: 'asset_IMAGE', revision_key: 'draft-revision' }, error: null };
    } };
    const service = createContentReviewService({ database: db, actor: centralActor, scope: { kind: 'central' } });

    await expect(service.mediaEditorState('asset_IMAGE')).resolves.toEqual({ id: 'asset_IMAGE', alt: { vi: '', en: '' }, revisionKey: 'asset-revision' });
    await expect(service.saveMediaAlt('asset_IMAGE', 'asset-revision', { vi: 'Sơ đồ', en: 'Diagram' }))
      .resolves.toEqual({ id: 'asset_IMAGE', alt: { vi: 'Sơ đồ', en: 'Diagram' }, revisionKey: 'draft-revision' });
    expect(calls.at(-1)).toEqual(['cms_save_content_draft', expect.objectContaining({
      p_content_type: 'media_asset',
      p_expected_revision: 'asset-revision',
      p_source: { asset: { id: 'asset_IMAGE', path: 'image.png', alt: { vi: 'Sơ đồ', en: 'Diagram' } } },
    })]);
  });
});
