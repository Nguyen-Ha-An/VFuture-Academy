import {
  createAdminAnalyticsService,
  createSupabaseAnalyticsRepository,
} from '@/features/admin/analytics';
import { BranchIdSchema } from '@/features/admin/branches';
import { ok, withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ branchId: string }> };

export const GET = withHandler(async (_request, context) => {
  const { branchId: rawBranchId } = await (context as RouteContext).params;
  const branchId = BranchIdSchema.parse(rawBranchId);
  const actor = await requirePermission('report.branch.read', { kind: 'branch', branchId });
  const service = createAdminAnalyticsService({
    repository: createSupabaseAnalyticsRepository(supabaseService()),
  });
  return ok(await service.branch(actor, branchId));
});
