import { withHandler,ok,parseBody,ApiError } from '@/lib/api';
import { getAdminContext,assertRequestScope,assertSameOrigin } from '@/features/admin/context';
import { routeParam } from '@/features/admin/management-schemas';
import { AccountMutationSchema,mutateAccount,readAccountState } from '@/lib/identity/admin-accounts';
export const GET=withHandler(async(request,route)=>{
  const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await readAccountState(context,await routeParam(route,'userId')),{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=withHandler(async(request,route)=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  const input=await parseBody(AccountMutationSchema,request);
  if(input.action==='create')throw new ApiError(400,'INVALID_OPERATION','Invalid account action');
  return ok(await mutateAccount(context,await routeParam(route,'userId'),input),{headers:{'Cache-Control':'private, no-store'}});
});
