import { randomBytes, createHash } from 'node:crypto';
import { withHandler, ok, parseBody } from '@/lib/api';
import { env } from '@/lib/env';
import { getAdminContext, assertRequestScope, assertSameOrigin } from '@/features/admin/context';
import { managementRead, managementWrite } from '@/features/admin/management';
import { InvitationSchema } from '@/features/admin/management-schemas';
import type { ManagedInvitation } from '@/features/admin/management-contracts';
export const GET=withHandler(async request=>{
  const context=await getAdminContext();assertRequestScope(context,request);
  return ok(await managementRead(context,'invitations'),{headers:{'Cache-Control':'private, no-store'}});
});
export const POST=withHandler(async request=>{
  assertSameOrigin(request);const context=await getAdminContext();assertRequestScope(context,request);
  const input=await parseBody(InvitationSchema,request);
  const token=randomBytes(32).toString('base64url');
  const invitation=await managementWrite<ManagedInvitation>(context,'invitation.create',{...input,tokenHash:createHash('sha256').update(token).digest('hex')});
  const inviteUrl=new URL(`/invite/${token}`,env.NEXT_PUBLIC_APP_URL).toString();
  return ok({...invitation,inviteUrl},{status:201,headers:{'Cache-Control':'private, no-store'}});
});
