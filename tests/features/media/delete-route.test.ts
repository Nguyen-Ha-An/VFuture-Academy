import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ backend:vi.fn(), context:vi.fn(), remove:vi.fn(), database:vi.fn() }));
vi.mock('@/lib/identity/provider',()=>({academyBackend:mocks.backend}));
vi.mock('@/features/admin/content-review-production',()=>({typedContentContext:mocks.context}));
vi.mock('@/features/media/delete',()=>({deleteMediaAsset:mocks.remove}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
import { DELETE } from '@/app/api/v1/studio/media/[assetId]/route';
beforeEach(()=>{ vi.resetAllMocks(); mocks.backend.mockReturnValue('azure'); mocks.context.mockResolvedValue({context:{actor:{userId:'user'},scope:{kind:'branch',branchId:'school-a'}}}); mocks.remove.mockResolvedValue({id:'asset_ONE',deleted:true}); });
const routeContext={params:Promise.resolve({assetId:'asset_ONE'})};
describe('studio media delete route',()=>{
  it('uses mutation context and the selected school to delete',async()=>{
    const response=await DELETE(new Request('https://academy.example/api/v1/studio/media/asset_ONE',{method:'DELETE'}),routeContext);
    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith(expect.any(Request),'content.edit','media.upload',true);
    expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({assetId:'asset_ONE',scope:{kind:'branch',branchId:'school-a'},actor:{userId:'user'}}));
  });
  it('does not expose the new Azure operation on the legacy backend',async()=>{
    mocks.backend.mockReturnValue('supabase');
    const response=await DELETE(new Request('https://academy.example/api/v1/studio/media/asset_ONE',{method:'DELETE'}),routeContext);
    expect(response.status).toBe(404);expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('rejects cross-origin deletion without reaching storage',async()=>{
    const response=await DELETE(new Request('https://academy.example/api/v1/studio/media/asset_ONE',{method:'DELETE',headers:{origin:'https://attacker.example'}}),routeContext);
    expect(response.status).toBe(403);expect(mocks.remove).not.toHaveBeenCalled();
  });
});
