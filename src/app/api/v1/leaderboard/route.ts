import { z } from 'zod';

import { branchIdForUser } from '@/features/me/service';
import { weeklyLeaderboard } from '@/features/xp/service';
import { ApiError, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const scopeSchema = z.enum(['global', 'branch']);

export const GET = withHandler(async (request) => {
  const user = await requireApiUser();
  const scope = scopeSchema.parse(new URL(request.url).searchParams.get('scope') ?? 'global');
  const branchId = scope === 'branch' ? await branchIdForUser(user.id) : undefined;
  if (scope === 'branch' && !branchId) {
    throw new ApiError(409, 'BRANCH_NOT_ASSIGNED', 'A branch assignment is required for this leaderboard');
  }
  return weeklyLeaderboard(scope, branchId ?? undefined);
});
