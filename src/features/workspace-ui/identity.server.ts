import 'server-only';
import { getSessionUser } from '@/lib/auth';
import { emailLocalPart, initials } from '@/lib/initials';
import { supabaseUser } from '@/lib/supabase/server';

export type LearnerIdentity = { name: string; initials: string; handle: string };

/** Name falls back from display name to handle to the email's local part, as the /app greeting does. */
export function buildLearnerIdentity(input: { displayName?: string | null; handle?: string | null; email?: string | null }): LearnerIdentity {
  const displayName = input.displayName?.trim() || '';
  const handle = input.handle?.trim() || '';
  const name = displayName || handle || emailLocalPart(input.email);
  // A display name splits on spaces; a handle or email local part on . _ + - ("an-nguyen" -> "AN").
  return { name, initials: displayName ? initials(displayName) : initials(null, handle || input.email), handle };
}

/** The signed-in learner for the bench bar's account trigger. Never throws: chrome must render even when a read fails. */
export async function learnerIdentity(): Promise<LearnerIdentity> {
  let email: string | null = null;
  try {
    const user = await getSessionUser();
    if (!user) return buildLearnerIdentity({});
    email = user.email ?? null;
    const supabase = await supabaseUser();
    const { data, error } = await supabase.from('profiles').select('display_name,handle').eq('id', user.id).maybeSingle();
    if (error || !data) return buildLearnerIdentity({ email });
    const profile = data as { display_name?: unknown; handle?: unknown };
    return buildLearnerIdentity({
      email,
      displayName: typeof profile.display_name === 'string' ? profile.display_name : null,
      handle: typeof profile.handle === 'string' ? profile.handle : null,
    });
  } catch {
    return buildLearnerIdentity({ email });
  }
}
