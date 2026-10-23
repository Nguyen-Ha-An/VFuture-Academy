import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, withHandler, ok, parseBody } from '@/lib/api';
import { getActor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { assertSameOrigin } from '@/features/admin/context';
import { managementDatabaseError } from '@/features/admin/management';
export const POST=withHandler(async request=>{
  assertSameOrigin(request);
  const actor=await getActor();if(!actor)throw new ApiError(401,'UNAUTHENTICATED','Authentication required');
  const {token}=await parseBody(z.object({token:z.string().regex(/^[a-zA-Z0-9_-]{43}$/)}).strict(),request);
  const {data,error}=await supabaseService().rpc('admin_accept_invitation',{p_user_id:actor.userId,p_token_hash:createHash('sha256').update(token).digest('hex')});
  managementDatabaseError(error);
  return ok(data,{headers:{'Cache-Control':'private, no-store'}});
});
