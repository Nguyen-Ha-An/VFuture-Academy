import { withHandler, ok, parseBody } from '@/lib/api';
import { getAdminContext, assertRequestScope, assertSameOrigin } from '@/features/admin/context';
import { managementWrite } from '@/features/admin/management';
import { RoleUpdateSchema, routeParam } from '@/features/admin/management-schemas';
export const PATCH=withHandler(async(request,route)=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  const input=await parseBody(RoleUpdateSchema,request);
  return ok(await managementWrite(context,'role.update',{...input,roleId:await routeParam(route,'roleId')}));
});
