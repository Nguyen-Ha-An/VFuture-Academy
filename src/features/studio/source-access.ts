import 'server-only';

import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { canUseTypedContentPermission } from '@/features/admin/content-review-production';
import { ApiError } from '@/lib/api';
import type { Actor, Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { getDraft } from './drafts';
import { readerDraft } from './reader-source';

type StudioScope = { actor: Actor; scope: Scope };

/** After the read gate, use the same active-scope and owner permissions required to save this course. */
export async function canEditStudioCourse(context: StudioScope, courseId: string): Promise<boolean> {
  if (!canUseTypedContentPermission(context.actor, context.scope, 'content.edit', 'course.edit')) return false;
  try {
    await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, context.actor, 'course', courseId, 'content.edit');
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}

/** The workspace, draft API and prompts all consume the same owner-authorized source. */
export async function visibleStudioDraft(context: StudioScope, courseId: string) {
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, context.actor, 'course', courseId, 'content.read');
  const canEdit = await canEditStudioCourse(context, courseId);
  const draft = await getDraft(courseId);
  return { canEdit, draft: canEdit ? draft : readerDraft(draft) };
}
