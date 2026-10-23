import { z } from 'zod';

import { ApiError, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';

const ProfilePatchSchema = z.object({ profilePublic: z.boolean() }).strict();

export const PATCH = withHandler(async (request) => {
  const user = await requireApiUser();
  const { profilePublic } = await parseBody(ProfilePatchSchema, request);
  const client = await supabaseUser();
  const { data, error } = await client.from('profiles')
    .update({ profile_public: profilePublic })
    .eq('id', user.id)
    .select('id,profile_public')
    .single();
  if (error?.code === '42501') throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (error?.code === 'PGRST116') {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }
  if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to update profile');
  if (!data || data.id !== user.id) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  return { profilePublic: data.profile_public === true };
});
