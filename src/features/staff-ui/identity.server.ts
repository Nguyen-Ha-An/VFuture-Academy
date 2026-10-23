import 'server-only';
import { getSessionUser } from '@/lib/auth';
import { supabaseUser } from '@/lib/supabase/server';
import { emailLocalPart, initials as staffInitials } from '@/lib/initials';
import type { StaffIdentity } from './types';

/** Shared with the learner shell; kept under the staff name for existing callers. */
export { initialsOf, initials as staffInitials } from '@/lib/initials';

/** Builds the identity from whatever is known; the name falls back to the email's local part, then to empty (the UI localizes that case). */
export function buildStaffIdentity(input: { displayName?: string | null; email?: string | null; avatarUrl?: string | null }): StaffIdentity {
  const email = input.email?.trim() || null;
  const displayName = input.displayName?.trim() || '';
  return {
    name: displayName || emailLocalPart(email),
    email,
    avatarUrl: input.avatarUrl?.trim() || null,
    initials: staffInitials(displayName, email),
  };
}

/** The signed-in staff member for the user menu. Never throws: chrome must render even when a read fails. */
export async function staffIdentity(): Promise<StaffIdentity> {
  let email: string | null = null;
  try {
    const user = await getSessionUser();
    if (!user) return buildStaffIdentity({});
    email = user.email ?? null;
    const supabase = await supabaseUser();
    const { data, error } = await supabase.from('profiles').select('display_name,avatar_url').eq('id', user.id).maybeSingle();
    if (error || !data) return buildStaffIdentity({ email });
    const profile = data as { display_name?: unknown; avatar_url?: unknown };
    return buildStaffIdentity({
      email,
      displayName: typeof profile.display_name === 'string' ? profile.display_name : null,
      avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
    });
  } catch {
    return buildStaffIdentity({ email });
  }
}
