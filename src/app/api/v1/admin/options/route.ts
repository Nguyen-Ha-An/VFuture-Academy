import { withHandler, ok } from '@/lib/api';
import { getAdminContext, assertRequestScope } from '@/features/admin/context';
import { academyBackend } from '@/lib/identity/provider';
import { adminAccountsConfigured } from '@/lib/identity/admin-graph';
import type { ManagementOptions } from '@/features/admin/management-contracts';
import { managementRead } from '@/features/admin/management';
export const GET = withHandler(async request => {
  const context=await getAdminContext(); assertRequestScope(context,request);
  const options=await managementRead<ManagementOptions>(context,'options');
  return ok({...options,azureAccountAdmin:academyBackend()==='azure'&&adminAccountsConfigured()&&context.scope.kind==='central'&&context.permissions.includes('member.manage')},{headers:{'Cache-Control':'private, no-store'}});
});
