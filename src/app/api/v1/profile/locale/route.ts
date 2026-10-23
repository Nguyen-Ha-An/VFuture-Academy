import { z } from 'zod';
import { ApiError, parseBody, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';

const localeBodySchema = z.object({ locale: z.enum(['vi', 'en']) }).strict();

export const PATCH = withHandler(async (request) => {
  const user = await requireApiUser();
  const { locale } = await parseBody(localeBodySchema, request);
  const client = await supabaseUser();
  const { data, error } = await client.from('profiles').update({ locale }).eq('id', user.id).select('id').single();
  if (error?.code === '42501') throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (error?.code === 'PGRST116') {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }
  if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to update profile locale');
  if (!data || data.id !== user.id) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  return { locale };
});
