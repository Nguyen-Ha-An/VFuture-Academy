import { passport } from '@/features/skills/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const GET = withHandler(async () => {
  const user = await requireApiUser();
  return passport(user.id);
});
