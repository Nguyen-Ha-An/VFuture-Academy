import { getMe } from '@/features/me/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async () => {
  const user = await requireApiUser();
  return getMe(user.id);
});
