import { listCertificates } from '@/features/certificates/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

export const runtime = 'nodejs';

export const GET = withHandler(async () => {
  const user = await requireApiUser();
  return listCertificates(user.id);
});
