import { ok, withHandler } from '@/lib/api';
import { getAdminContext, assertRequestScope } from '@/features/admin/context';
import { adminDashboardSummary } from '@/features/admin/dashboard';
export const GET=withHandler(async request=>{
  const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await adminDashboardSummary(context),{headers:{'Cache-Control':'private, no-store'}});
});
