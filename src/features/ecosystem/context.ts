import 'server-only';

import type { Locale } from '@/content-engine/schema/common';
import { eligibleAudienceBranch, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function requestLocale(request: Request): Promise<Locale> {
  const requested = new URL(request.url).searchParams.get('locale');
  const locale = requested ?? await import('next-intl/server').then(({ getLocale }) => getLocale());
  if (locale !== 'vi' && locale !== 'en') {
    throw new ApiError(400, 'INVALID_LOCALE', 'Locale must be vi or en');
  }
  return locale;
}

export async function learnerContext(userId: string, locale: Locale) {
  const database = supabaseService();
  const { data, error } = await database
    .from('profiles')
    .select('branch_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'PROFILE_DATABASE_ERROR', 'Learner profile could not be loaded');
  const profile = record(data);
  if (!profile) throw new ApiError(409, 'PROFILE_INCOMPLETE', 'Complete your profile before continuing');
  return {
    userId,
    branchId: await eligibleAudienceBranch({ userId }, profile.branch_id, database as unknown as MembershipAccessDatabase),
    locale,
  };
}
