'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { profileState } from '@/lib/profile-state';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { supabaseUser } from '@/lib/supabase/server';
import type { OnboardingState } from './onboarding-state';

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Returns form errors, or null once this user's completed profile is confirmed. */
async function saveProfile(userId: string, values: OnboardingState['values']): Promise<OnboardingState | null> {
  const state: OnboardingState = { values, fieldErrors: {}, error: null };
  let failure: OnboardingState['error'] = 'profileLoadError';

  try {
    const supabase = await supabaseUser();
    const readProfile = () => supabase.from('profiles')
      .select('id, handle, display_name').eq('id', userId).maybeSingle();
    const current = await readProfile();
    if (current.error || !current.data || current.data.id !== userId || profileState(current) === 'unavailable') {
      return { ...state, error: 'profileLoadError' };
    }
    if (profileState(current) === 'complete') return null;

    const parsed = profileSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'displayName') state.fieldErrors.displayName = 'invalidDisplayName';
      }
      return state;
    }

    failure = 'profileUpdateError';
    const { data, error } = await supabase.from('profiles').update({
      display_name: parsed.data.displayName,
    }).eq('id', userId).eq('display_name', current.data.display_name).select('id, handle, display_name').maybeSingle();

    if (error) return { ...state, error: 'profileUpdateError' };
    if (!data) {
      // Another submission may have completed the profile since our first read.
      const latest = await readProfile();
      if (!latest.error && latest.data?.id === userId && profileState(latest) === 'complete') return null;
      return { ...state, error: 'profileUpdateError' };
    }
    if (data.id !== userId || data.handle !== current.data.handle || data.display_name !== parsed.data.displayName) {
      return { ...state, error: 'profileUpdateError' };
    }
    return null;
  } catch (error) {
    unstable_rethrow(error);
    return { ...state, error: failure };
  }
}

export async function completeOnboarding(
  _previousState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const next = safeInternalPath(textField(formData, 'next'));
  const values = {
    displayName: textField(formData, 'displayName'),
  };
  let user;
  try {
    user = await requireUser(next);
  } catch (error) {
    unstable_rethrow(error);
    return { values, fieldErrors: {}, error: 'profileLoadError' };
  }
  const result = await saveProfile(user.id, values);
  if (result) return result;

  revalidatePath('/welcome');
  revalidatePath(new URL(next, 'https://academy.invalid').pathname);
  redirect(next);
}
