import { ok, withHandler } from '@/lib/api';
import { getAdminContext, assertRequestScope, assertAdminPermission } from '@/features/admin/context';
import { managementRead } from '@/features/admin/management';
import { AuditLogQuerySchema } from '@/features/admin/audit-log';
import type { AdminAuditEntry } from '@/features/admin/management-contracts';
export const GET=withHandler(async request=>{
  const context=await getAdminContext();assertRequestScope(context,request);assertAdminPermission(context,'audit.read');
  const params=new URL(request.url).searchParams;
  const input=AuditLogQuerySchema.parse(Object.fromEntries(['actor','action','target','page'].filter(key=>params.has(key)).map(key=>[key,params.get(key)])));
  const items=await managementRead<AdminAuditEntry[]>(context,'audit',input);
  return ok({items,page:input.page,pageSize:50,hasMore:items.length===50},{headers:{'Cache-Control':'private, no-store'}});
});
