import 'server-only';
import { randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { isMissingProfileName } from '@/lib/identity/display-name';
import { PROFILE_HANDLE_PATTERN } from '@/lib/profile-handle';

type PlaceholderDatabase = Pick<ReturnType<typeof supabaseService>, 'from'>;

function placeholderHandle(handle: string): boolean {
  return /^(STU|VFU)-unknown(?:-[a-f0-9]{6})?$/.test(handle);
}

/** Replace only the CIAM default; rename a generated URL only if never edited. */
export async function repairPlaceholderProfile(
  userId: string,
  before: { handle: string; display_name: string },
  displayName: string,
  client?: PlaceholderDatabase,
): Promise<boolean> {
  if (before.display_name.trim().toLowerCase() !== 'unknown') return false;
  if (isMissingProfileName(displayName)) throw new ApiError(400, 'INVALID_NAME', 'A profile name is required');
  const database = client ?? supabaseService();
  let handle: string | undefined;
  if (placeholderHandle(before.handle)) {
    const changes = await database.from('profile_handle_changes').select('id').eq('user_id', userId).limit(1);
    if (changes.error || !Array.isArray(changes.data)) throw new ApiError(503, 'PROFILE_UNAVAILABLE', 'Unable to check profile history');
    if (!changes.data.length) {
      const slug = displayName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25).replace(/-+$/g, '');
      const suffix = `${slug ? `${slug}-` : ''}${randomUUID().replace(/-/g, '').slice(0, 6)}`;
      handle = `${before.handle.slice(0, 4)}${suffix}`;
    }
  }
  // One conditional mutation preserves concurrent edits. The existing database
  // handle guard reserves the old URL as an alias in this same transaction.
  // This setup repair does not consume a user's manual handle-change allowance.
  let query = database.from('profiles').update({ ...(handle ? { handle } : {}), display_name: displayName }).eq('id', userId);
  if (handle) query = query.eq('handle', before.handle);
  const result = await query.eq('display_name', before.display_name).select('id,handle,display_name').maybeSingle();
  if (result.error) throw new ApiError(503, 'PROFILE_UNAVAILABLE', 'Unable to repair profile');
  if (!result.data) return false;
  const saved = result.data as Record<string, unknown>;
  if (saved.id !== userId || typeof saved.handle !== 'string' || !PROFILE_HANDLE_PATTERN.test(saved.handle)
    || (handle && saved.handle !== handle) || saved.display_name !== displayName) throw new ApiError(503, 'PROFILE_UNAVAILABLE', 'Unable to confirm profile repair');
  return true;
}
