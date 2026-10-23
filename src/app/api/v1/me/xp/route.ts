import { xpSummary } from '@/features/xp/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async () => {
  const user = await requireApiUser();
  return xpSummary(user.id);
});
