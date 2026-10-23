import 'server-only';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';

type MembershipResult={data:unknown;error:unknown|null};
export interface MembershipAccessQuery {
  select(columns:string):this;
  eq(column:string,value:unknown):this;
  maybeSingle():PromiseLike<MembershipResult>;
}
export interface MembershipAccessDatabase {from(table:'branch_memberships'):MembershipAccessQuery}
export type TrustedEnrollmentBranch={branch_scope_known?:unknown;branch_id?:unknown};

function suspended():never {
  throw new ApiError(403,'MEMBERSHIP_SUSPENDED','Your membership for this school is suspended');
}

/** Gates live learning at the immutable enrollment branch while preserving unknown historical records. */
export async function assertEnrollmentMembershipAccess(
  actor:Actor,
  enrollment:TrustedEnrollmentBranch,
  database:MembershipAccessDatabase,
):Promise<void>{
  if(enrollment.branch_scope_known!==true||typeof enrollment.branch_id!=='string'||!enrollment.branch_id)return;
  if(actor.authorization?.source==='database'){
    if(actor.authorization.memberships.some(({branchId,status})=>branchId===enrollment.branch_id&&status==='suspended'))suspended();
    return;
  }
  const result=await database.from('branch_memberships').select('status')
    .eq('user_id',actor.userId).eq('branch_id',enrollment.branch_id).maybeSingle();
  if(result.error)throw new ApiError(503,'MEMBERSHIP_ACCESS_UNAVAILABLE','School membership could not be verified');
  const row=typeof result.data==='object'&&result.data!==null?result.data as Record<string,unknown>:null;
  if(row?.status==='suspended')suspended();
}
