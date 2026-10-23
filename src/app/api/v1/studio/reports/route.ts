import { assertWorkspaceRequestScope, getGradingContext } from '@/features/workspace/context';
import { loadStudioLearningReport, studioReportQueryFromUrl } from '@/features/reporting/service';
import { ok, withHandler } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = withHandler(async (request) => {
  // Reports live in the grading workspace, so the active scope must come from the
  // grading context. Resolving the Studio context here can select a different
  // active scope when the two candidate lists differ and no scope cookie is set,
  // which surfaces as a spurious 409 SCOPE_CHANGED.
  const context = await getGradingContext();
  assertWorkspaceRequestScope(context, request);
  const report = await loadStudioLearningReport(
    context.actor,
    context.scope,
    studioReportQueryFromUrl(request.url),
  );
  return ok(report, { headers: { 'Cache-Control': 'private, no-store' } });
});
