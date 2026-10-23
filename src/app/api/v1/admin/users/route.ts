import { withHandler, ok } from '@/lib/api';
import { getAdminContext, assertAdminPermission, assertRequestScope } from '@/features/admin/context';
import { managementRead } from '@/features/admin/management';
import { MemberQuerySchema } from '@/features/admin/management-schemas';
import type { MemberPage } from '@/features/admin/management-contracts';
export const GET = withHandler(async request => {
  const context = await getAdminContext(); assertRequestScope(context, request); assertAdminPermission(context, 'member.read');
  const params = new URL(request.url).searchParams;
  const values = Object.fromEntries(['query','page','pageSize','status','roleId','kind'].filter(key => params.get(key)).map(key => [key,params.get(key)]));
  return ok(await managementRead<MemberPage>(context,'users',MemberQuerySchema.parse(values)), {headers:{'Cache-Control':'private, no-store'}});
});
