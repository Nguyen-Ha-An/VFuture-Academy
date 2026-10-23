import { downloadCertificate } from '@/features/certificates/service';
import { ApiError, withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';

export const GET = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { id } = await (context as RouteContext).params;
  const signedUrl = await downloadCertificate(user.id, id);
  if (!signedUrl) throw new ApiError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found');
  return new Response(null, {
    status: 302,
    headers: {
      Location: signedUrl,
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  });
});
