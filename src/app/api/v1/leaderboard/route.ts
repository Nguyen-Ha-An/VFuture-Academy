import { z } from 'zod';

import { leaderboardSchoolForUser } from '@/features/me/service';
import { weeklyLeaderboard } from '@/features/xp/service';
import { ApiError, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const scopeSchema = z.enum(['global', 'branch']);

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const scope = scopeSchema.parse(new URL(request.url).searchParams.get('scope') ?? 'global');
  const school = scope === 'branch' ? await leaderboardSchoolForUser(user.id) : undefined;
  if (school?.status === 'suspended') {
    throw new ApiError(403, 'MEMBERSHIP_SUSPENDED', 'Your membership for this school is suspended');
  }
  if (school?.status === 'unassigned') {
    throw new ApiError(409, 'BRANCH_NOT_ASSIGNED', 'A branch assignment is required for this leaderboard');
  }
  return weeklyLeaderboard(scope, school?.branchId);
});
