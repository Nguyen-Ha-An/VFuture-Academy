import { ok, withHandler, parseBody } from '@/lib/api';
import { assertSameOrigin, assertRequestScope, getAdminContext } from '@/features/admin/context';
import { managementRead, managementWrite } from '@/features/admin/management';
import { BranchInputSchema } from '@/features/admin/branches';
export const GET=withHandler(async request=>{const context=await getAdminContext();assertRequestScope(context,request);return ok(await managementRead(context,'branches'),{headers:{'Cache-Control':'private, no-store'}});});
export const POST=withHandler(async request=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);const {id,...input}=await parseBody(BranchInputSchema,request);
  return ok(await managementWrite(context,'branch.create',{...input,branchId:id}),{status:201});
});
