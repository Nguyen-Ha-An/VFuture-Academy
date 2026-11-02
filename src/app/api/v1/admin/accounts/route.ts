import { withHandler,ok,parseBody,ApiError } from '@/lib/api';
import { getAdminContext,assertRequestScope,assertSameOrigin } from '@/features/admin/context';
import { AccountMutationSchema,mutateAccount } from '@/lib/identity/admin-accounts';
export const POST=withHandler(async request=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  const input=await parseBody(AccountMutationSchema,request);
  if(!['create','retry'].includes(input.action))throw new ApiError(400,'INVALID_OPERATION','Invalid account action');
  return ok(await mutateAccount(context,null,input),{headers:{'Cache-Control':'private, no-store'}});
});
