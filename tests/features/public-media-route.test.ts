import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  decision: { allowed: false, headers: new Headers() },
  checkPublicRateLimit: vi.fn(),
  applyPublicResponseHeaders: vi.fn((response: Response) => response),
  isPublicProjectionAsset: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('@/features/marketing/public-http', () => ({
  checkPublicRateLimit: mocks.checkPublicRateLimit,
  applyPublicResponseHeaders: mocks.applyPublicResponseHeaders,
}));
vi.mock('@/features/media/public-access', () => ({ isPublicProjectionAsset: mocks.isPublicProjectionAsset }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { GET } from '@/app/api/v1/public/media/[assetId]/route';

describe('public media route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkPublicRateLimit.mockReturnValue(mocks.decision);
  });

  it('returns 429 before any service-role projection or media lookup', async () => {
    const response = await GET(
      new Request('https://example.test/api/v1/public/media/asset_unknown'),
      { params: Promise.resolve({ assetId: 'asset_unknown' }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.isPublicProjectionAsset).not.toHaveBeenCalled();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });
  it.each(['notebooks','certificates','submissions'])('never signs %s assets through a public projection', async (bucket) => {
    mocks.checkPublicRateLimit.mockReturnValue({allowed:true,headers:new Headers()});
    mocks.isPublicProjectionAsset.mockResolvedValue(true);
    const sign=vi.fn(async()=>({data:{signedUrl:'https://storage.example.test/private'},error:null}));
    mocks.supabaseService.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{bucket,path:'private-file'},error:null})})})}),storage:{from:()=>({createSignedUrl:sign})}});
    const response=await GET(new Request('https://example.test/api/v1/public/media/asset_private'),{params:Promise.resolve({assetId:'asset_private'})});
    expect(response.status).toBe(404);expect(sign).not.toHaveBeenCalled();
  });

});

it.each(['notebooks','submissions','unknown'])('never signs private bucket %s even when a public projection references the asset',async(bucket)=>{
 mocks.checkPublicRateLimit.mockReturnValue({allowed:true,headers:new Headers()});
 mocks.isPublicProjectionAsset.mockResolvedValue(true);
 const sign=vi.fn().mockResolvedValue({data:{signedUrl:'https://storage.example/private'},error:null});
 mocks.supabaseService.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{bucket,path:'private.ipynb'},error:null})})})}),storage:{from:()=>({createSignedUrl:sign})}});
 const response=await GET(new Request('https://example.test/api/v1/public/media/notebook-asset'),{params:Promise.resolve({assetId:'notebook-asset'})});
 expect(response.status).toBe(404);expect(sign).not.toHaveBeenCalled();
});
