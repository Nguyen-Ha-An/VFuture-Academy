import { ok, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { profileState } from '@/lib/profile-state';
import { supabaseUser } from '@/lib/supabase/server';

const CACHE_CONTROL = 'private, no-store';

/**
 * Reports only whether the signed-in caller's profile still needs onboarding.
 * The user comes from a verified, active account (never from the request), the read
 * goes through the caller's own JWT so RLS still applies, and nothing about the
 * handle or any other account is returned.
 */
const readProfileState = withHandler(async () => {
  const user = await requireApiUser();

  const supabase = await supabaseUser();
  const profile = await supabase.from('profiles').select('handle').eq('id', user.id).maybeSingle();
  return ok({ state: profileState(profile) });
});

/** Every outcome (success, 401, 403, 500) is private and uncacheable, including error envelopes. */
export async function GET(request: Request): Promise<Response> {
  const response = await readProfileState(request);
  response.headers.set('Cache-Control', CACHE_CONTROL);
  return response;
}
