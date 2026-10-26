import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({user:vi.fn(),reserve:vi.fn(),finalize:vi.fn(),cancel:vi.fn(),cleanup:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({})}));
vi.mock('@/lib/rate-limit',()=>({RATE_LIMITS:{upload:{}},enforceRateLimit:mocks.limit,userRateLimitKey:(_scope:string,id:string)=>id}));
vi.mock('@/features/media/direct-upload',()=>({reserveDirectUpload:mocks.reserve,finalizeDirectUpload:mocks.finalize,cancelDirectUpload:mocks.cancel,cleanupDirectUploads:mocks.cleanup}));
import { POST as reserve } from '@/app/api/v1/uploads/reserve/route';
import { POST as finalize } from '@/app/api/v1/uploads/[uploadId]/finalize/route';
import { DELETE as cancel } from '@/app/api/v1/uploads/[uploadId]/route';
import { POST as legacy } from '@/app/api/v1/uploads/route';
import { ApiError } from '@/lib/api';
const request=(path:string,body:unknown={})=>new Request(`http://localhost/api/v1/uploads${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:'owner'});mocks.reserve.mockResolvedValue({uploadId:'one'});mocks.finalize.mockResolvedValue({assetId:'asset_one'});mocks.cancel.mockResolvedValue({cancelled:true});});
describe('small direct upload routes',()=>{
  it('reserves as authenticated owner and enforces the existing upload rate limit',async()=>{
    const res=await reserve(request('/reserve',{name:'work.txt'}));expect(res.status).toBe(200);
    expect(mocks.reserve).toHaveBeenCalledWith('owner',{name:'work.txt'},{});expect(mocks.cleanup).toHaveBeenCalledWith({},2);expect(mocks.limit).toHaveBeenCalledOnce();
  });
  it('rejects oversized JSON before invoking upload service',async()=>{
    expect((await reserve(request('/reserve',{name:'x'.repeat(4096)}))).status).toBe(413);expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it('propagates active-account rejection before upload work',async()=>{
    mocks.user.mockRejectedValue(new ApiError(403,'ACCOUNT_SUSPENDED','Account suspended'));
    expect((await reserve(request('/reserve'))).status).toBe(403);expect(mocks.reserve).not.toHaveBeenCalled();
    expect((await finalize(request('/one/finalize'),{params:Promise.resolve({uploadId:'one'})})).status).toBe(403);
  });
  it('binds finalize and cancel to route id and authenticated owner',async()=>{
    expect((await finalize(request('/one/finalize'),{params:Promise.resolve({uploadId:'one'})})).status).toBe(200);
    expect(mocks.finalize).toHaveBeenCalledWith('owner','one',{});
    await cancel(new Request('http://localhost/api/v1/uploads/one',{method:'DELETE'}),{params:Promise.resolve({uploadId:'one'})});
    expect(mocks.cancel).toHaveBeenCalledWith('owner','one',{});
  });
  it('retired multipart endpoint cannot bypass reservation, even with chunked bytes',async()=>{
    const req=new Request('http://localhost/api/v1/uploads',{method:'POST',body:new FormData()});const parser=vi.spyOn(req,'formData');
    expect((await legacy(req)).status).toBe(410);expect(parser).not.toHaveBeenCalled();
    const big=new Request('http://localhost/api/v1/uploads',{method:'POST',headers:{'content-length':String(4*1024*1024+1)}});
    expect((await legacy(big)).status).toBe(413);expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
