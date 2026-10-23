import { actorPermissionCheck, createBankService, type BankDatabase } from '@/features/bank/service';
import { fail, ok, withHandler } from '@/lib/api';
import { type Actor, type Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { assertContentAccess, type ContentReviewDatabase } from '@/features/admin/content-review';
import { typedContentContext } from '@/features/admin/content-review-production';

type RouteContext = { params: Promise<{ questionId: string }> };

function serviceFor(actor: Actor, scope?: Scope) {
  return createBankService({
    database: supabaseService() as unknown as BankDatabase,
    requirePermission: actorPermissionCheck(actor, scope),
    scope,
  });
}

export const POST = withHandler(async (_request, context) => {
  const { context: admin } = await typedContentContext(_request, 'content.publish', 'bank.publish', true);
  const actor = admin.actor;
  const { questionId } = await (context as RouteContext).params;
  if (!questionId) return fail(400, 'QUESTION_ID_REQUIRED', 'Question id is required');
  await assertContentAccess(supabaseService() as unknown as ContentReviewDatabase, actor, 'bank_question', questionId, 'content.read');
  return ok(await serviceFor(actor, admin.scope).publish(questionId));
});
