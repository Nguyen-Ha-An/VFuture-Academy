import { getDraft } from "@/features/studio/drafts";
import { emptySummary } from "@/content-engine/diagnostics";
import { Workspace } from "@/features/studio/ui/Workspace";
import { serializableWorkspaceDraft } from "@/features/studio/workspace-serialization";
import { scopeKey } from "@/lib/admin-scope";
import { canUseTypedContentPermission, typedContentPageContext } from '@/features/admin/content-review-production';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { supabaseService } from '@/lib/supabase/server';

export const dynamic = "force-dynamic";

export default async function StudioCourseWorkspacePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const context = await typedContentPageContext('content.read', 'course.read');
  const actor = context.actor;
  const { courseId } = await params;
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'course', courseId, 'content.read');
  const draft = await getDraft(courseId);
  // The live preview validates this same snapshot after the editor is visible.
  // Publishing still performs its independent server validation.
  const report = { ok: true, errors: [], warnings: [], summary: emptySummary() };
  // Local recovery records are keyed by account and permission scope, so one
  // author's unfinished text is never offered to another and a scope switch does
  // not mix drafts.
  return <Workspace
    key={courseId}
    initialDraft={serializableWorkspaceDraft(draft)}
    initialReport={report}
    readOnly={!canUseTypedContentPermission(actor, context.scope, 'content.edit', 'course.edit')}
    canCreate={canUseTypedContentPermission(actor, context.scope, 'content.create', 'course.create')}
    accountId={actor.userId}
    scopeKey={scopeKey(context.scope)}
  />;
}
