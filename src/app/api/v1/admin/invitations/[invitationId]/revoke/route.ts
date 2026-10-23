import { withHandler, ok } from '@/lib/api';
import { getAdminContext, assertRequestScope, assertSameOrigin } from '@/features/admin/context';
import { managementWrite } from '@/features/admin/management';
import { routeParam } from '@/features/admin/management-schemas';
export const POST=withHandler(async(request,route)=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await managementWrite(context,'invitation.revoke',{invitationId:await routeParam(route,'invitationId')}));
});
