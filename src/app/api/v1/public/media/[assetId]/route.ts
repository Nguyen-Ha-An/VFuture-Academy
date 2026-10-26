import { grantStorageTransferUrl } from '@/features/storage-transfer/grants';
import { isPublicProjectionAsset, type PublicMediaDatabase } from '@/features/media/public-access';
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
  if (!await isPublicProjectionAsset(database as unknown as PublicMediaDatabase, assetId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Media not found');
  }
  const result = await database.from('media_assets').select('bucket,path,size_bytes').eq('id', assetId).maybeSingle();
  const asset = typeof result.data === 'object' && result.data !== null ? result.data as { bucket?: unknown; path?: unknown; size_bytes?: unknown } : null;
  if (result.error) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
  if (asset?.bucket !== 'media' || typeof asset.path !== 'string') {
    throw new ApiError(404, 'NOT_FOUND', 'Media not found');
  }
  const signed = await database.storage.from(asset.bucket).createSignedUrl(asset.path, 10 * 60);
  if (signed.error || !signed.data?.signedUrl) throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
  return applyPublicResponseHeaders(new Response(null, {
    status: 302,
    headers: {
      Location: grantStorageTransferUrl(signed.data.signedUrl, {
        subject: 'public', method: 'GET', bucket: asset.bucket, path: asset.path,
        maxBytes: asset.size_bytes, expiresIn: 600,
      }),
      'Cache-Control': 'no-store',
    },
  }), rateLimit);
});
