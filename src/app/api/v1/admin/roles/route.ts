import { withHandler, ok, parseBody } from '@/lib/api';
import { getAdminContext, assertRequestScope, assertSameOrigin } from '@/features/admin/context';
import { managementRead, managementWrite } from '@/features/admin/management';
import { RoleDefinitionSchema } from '@/features/admin/management-schemas';
export const GET=withHandler(async request=>{
  const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await managementRead(context,'roles'),{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=withHandler(async request=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await managementWrite(context,'role.create',await parseBody(RoleDefinitionSchema,request)),{status:201});
});
