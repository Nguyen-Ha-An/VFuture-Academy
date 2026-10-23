import { z } from 'zod';
import { setProfilePublic, type ProfileDatabase } from '@/features/profile/service';
import { parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';

const ProfilePublicBodySchema = z.object({
  profilePublic: z.boolean(),
}).strict();

export const PATCH = withHandler(async (request) => {
  const user = await requireApiUser();
  const actor = { userId: user.id, roles: [] };
  const { profilePublic } = await parseBody(ProfilePublicBodySchema, request, { maxBytes: 2_048 });
  const client = await supabaseUser();
  return setProfilePublic(actor, profilePublic, { client: client as unknown as ProfileDatabase });
});
