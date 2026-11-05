import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),actor:vi.fn(),database:vi.fn(),check:vi.fn(),sign:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/lib/permissions',async original=>({...await original<typeof import('@/lib/permissions')>(),getActor:mocks.actor}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/media/assessment-owner',()=>({checkBoundAssessmentOwnerAccess:mocks.check}));
vi.mock('@/features/storage-transfer/grants',()=>({grantStorageTransferUrl:(url:string)=>url}));
import { GET } from '@/app/api/v1/media/[assetId]/route';
beforeEach(()=>{
  vi.clearAllMocks();mocks.user.mockResolvedValue({id:'owner'});mocks.actor.mockResolvedValue({userId:'owner',roles:[]});
  mocks.sign.mockResolvedValue({data:{signedUrl:'https://storage.example/signed'},error:null});
  const row={owner_id:'owner',bucket:'submissions',path:'owner/asset/file.pdf',mime:'application/pdf',size_bytes:20};
  mocks.database.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})}),storage:{from:()=>({createSignedUrl:mocks.sign})}});
});
describe('assessment attachment owner media access',()=>{
  it('denies a bound assessment asset when its enrollment or historical school is no longer eligible',async()=>{
    mocks.check.mockResolvedValue(false);
    const response=await GET(new Request('http://localhost/api/v1/media/asset-one'),{params:Promise.resolve({assetId:'asset-one'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each([true,null])('permits an authorized assessment owner or unbound assignment owner (%s)',async result=>{
    mocks.check.mockResolvedValue(result);
    const response=await GET(new Request('http://localhost/api/v1/media/asset-one'),{params:Promise.resolve({assetId:'asset-one'})});
    expect(response.status).toBe(302);expect(mocks.sign).toHaveBeenCalledOnce();
  });
  it('fails closed if assessment binding lookup is unavailable',async()=>{
    mocks.check.mockRejectedValue(new Error('unavailable'));
    const response=await GET(new Request('http://localhost/api/v1/media/asset-one'),{params:Promise.resolve({assetId:'asset-one'})});
    expect(response.status).toBe(500);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('hides a bound asset when the recorded school membership is suspended',async()=>{
    const {ApiError}=await import('@/lib/api');
    mocks.check.mockRejectedValue(new ApiError(403,'MEMBERSHIP_SUSPENDED','suspended'));
    const response=await GET(new Request('http://localhost/api/v1/media/asset-one'),{params:Promise.resolve({assetId:'asset-one'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
});
