import { ok, withHandler, parseBody } from '@/lib/api';
import { assertSameOrigin, assertRequestScope, getAdminContext } from '@/features/admin/context';
import { managementWrite } from '@/features/admin/management';
import { BranchIdSchema, BranchUpdateSchema } from '@/features/admin/branches';
export const PUT=withHandler(async(request,route)=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  const {branchId:raw}=await (route as {params:Promise<{branchId:string}>}).params;const branchId=BranchIdSchema.parse(raw);
  const input=await parseBody(BranchUpdateSchema,request);
  return ok(await managementWrite(context,'branch.update',{...input,branchId}));
});
