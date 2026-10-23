import { withHandler, ok } from '@/lib/api';
import { getAdminContext, assertRequestScope } from '@/features/admin/context';
import { managementRead } from '@/features/admin/management';
export const GET = withHandler(async request => {
  const context=await getAdminContext(); assertRequestScope(context,request);
  return ok(await managementRead(context,'options'),{headers:{'Cache-Control':'private, no-store'}});
});
