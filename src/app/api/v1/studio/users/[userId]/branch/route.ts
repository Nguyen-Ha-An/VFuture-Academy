import { legacyUser } from '@/features/admin/legacy-users';
import type { MemberSummary } from '@/features/admin/management-contracts';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { BranchAssignmentSchema } from '@/features/admin/users';
import { getAdminContext, assertSameOrigin, assertAdminPermission } from '@/features/admin/context';
import { managementWrite } from '@/features/admin/management';
import { routeParam } from '@/features/admin/management-schemas';
export const PUT=withHandler(async(request,route)=>{
  assertSameOrigin(request);const input=await parseBody(BranchAssignmentSchema,request);
  const context=await getAdminContext();
  if(context.scope.kind!=='central')throw new ApiError(403,'FORBIDDEN','Central scope is required');
  assertAdminPermission(context,'member.manage');
  assertAdminPermission(context,'member.read');
  const userId=await routeParam(route,'userId');
  return ok(legacyUser(await managementWrite<MemberSummary>(context,'user.transfer',{userId,branchId:input.branchId})));
});
