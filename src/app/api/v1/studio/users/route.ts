import { legacyUser } from '@/features/admin/legacy-users';
import { ok, withHandler } from '@/lib/api';
import { legacyAdminContext } from '@/features/admin/legacy-context';
import { managementRead } from '@/features/admin/management';
import { MemberQuerySchema } from '@/features/admin/management-schemas';
import type { MemberPage } from '@/features/admin/management-contracts';
export const GET=withHandler(async request=>{
  const params=new URL(request.url).searchParams;
  const context=await legacyAdminContext(params.get('branchId'));
  const input=MemberQuerySchema.parse({query:params.get('query')??'',page:params.get('page')??1,pageSize:params.get('pageSize')??20});
  const data=await managementRead<MemberPage>(context,'users',input);
  return ok({...data,items:data.items.map(legacyUser)},{headers:{'Cache-Control':'private, no-store'}});
});
