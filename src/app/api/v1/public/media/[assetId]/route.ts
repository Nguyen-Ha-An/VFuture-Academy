import { grantStorageTransferUrl } from '@/features/storage-transfer/grants';
import { getPublicProjectionAsset } from '@/features/media/public-access';
import { applyPublicResponseHeaders, checkPublicRateLimit } from '@/features/marketing/public-http';
import { ApiError, withHandler } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const GET = withHandler(async (request, context) => {
  const rateLimit = await checkPublicRateLimit(request);
  if (!rateLimit.allowed) {
    return applyPublicResponseHeaders(NextResponse.json(
      { error: rateLimit.status === 503 ? 'rate_limit_unavailable' : 'rate_limited' },
      { status: rateLimit.status ?? 429, headers: { 'Retry-After': '60' } },
    ), rateLimit);
  }
  const { assetId } = await (context as { params: Promise<{ assetId: string }> }).params;
  const database = supabaseService();
  const asset = await getPublicProjectionAsset(database, assetId);
  if (!asset) throw new ApiError(404, 'NOT_FOUND', 'Media not found');
  const signed = await database.storage.from(asset.bucket).createSignedUrl(asset.path, 10 * 60);
  if (signed.error || !signed.data?.signedUrl) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
  return applyPublicResponseHeaders(new Response(null, {
    status: 302,
    headers: {
      Location: grantStorageTransferUrl(signed.data.signedUrl, {
        subject: 'public', method: 'GET', bucket: asset.bucket, path: asset.path,
        maxBytes: asset.sizeBytes, expiresIn: 600,
      }),
      'Cache-Control': 'no-store',
    },
  }), rateLimit);
});
