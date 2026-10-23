import { legacyUser, legacyRoleName, legacyGrantDefinition } from '@/features/admin/legacy-users';
import { ok, parseBody, withHandler } from '@/lib/api';
import { RoleMutationSchema } from '@/features/admin/users';
import { legacyAdminContext } from '@/features/admin/legacy-context';
import { assertSameOrigin } from '@/features/admin/context';
import { managementRead, managementWrite } from '@/features/admin/management';
import { routeParam } from '@/features/admin/management-schemas';
import type { MemberDetail, MemberSummary } from '@/features/admin/management-contracts';
export const PUT=withHandler(async(request,route)=>{
  assertSameOrigin(request);const input=await parseBody(RoleMutationSchema,request);
  const context=await legacyAdminContext(input.branchId);const userId=await routeParam(route,'userId');
  const member=await managementRead<MemberDetail>(context,'user',{userId});
  const previous=member.assignments.find(assignment=>legacyRoleName(assignment.roleId)===input.role
    &&(assignment.scope.kind==='branch'?assignment.scope.branchId:null)===input.branchId);
  if(!input.enabled&&!previous)return ok(legacyUser(member));
  const roleId=!input.enabled&&previous?previous.roleId:legacyGrantDefinition(input.role,input.branchId);
  const updated=await managementWrite<MemberSummary>(context,'user.role',{userId,roleId,branchId:input.branchId,enabled:input.enabled});
  return ok(legacyUser(updated));
});
