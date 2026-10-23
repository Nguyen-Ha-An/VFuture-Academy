import {beforeEach,describe,it,expect,vi} from 'vitest';
import {ApiError} from '@/lib/api';
const mocks=vi.hoisted(()=>({getAdminContext:vi.fn(),assertAdminPermission:vi.fn(),read:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/features/admin/context',()=>({getAdminContext:mocks.getAdminContext,assertAdminPermission:mocks.assertAdminPermission,assertRequestScope:vi.fn()}));
vi.mock('@/features/admin/management',()=>({managementRead:mocks.read}));
import {GET} from '@/app/api/v1/studio/audit/route';
const context={actor:{userId:'actor'},scope:{kind:'branch',branchId:'ans'}};
beforeEach(()=>{vi.clearAllMocks();mocks.assertAdminPermission.mockReset();mocks.getAdminContext.mockResolvedValue(context);mocks.read.mockResolvedValue([{id:'1',action:'user.role',actorId:'actor',targetType:'user',targetId:'user',at:'2026-09-06'}]);});
describe('scoped audit compatibility route',()=>{
 it('uses explicit audit permission and database scope before data access',async()=>{const response=await GET(new Request('http://localhost/api/v1/studio/audit'));expect(response.status).toBe(200);expect(mocks.assertAdminPermission).toHaveBeenCalledWith(context,'audit.read');expect(mocks.read).toHaveBeenCalledWith(context,'audit',{page:1});});
 it('forwards bounded filters instead of dropping the actor selection',async()=>{await GET(new Request('http://localhost/api/v1/studio/audit?actor=00000000-0000-4000-8000-000000000001&action=user&target=member&page=2'));expect(mocks.read).toHaveBeenCalledWith(context,'audit',{actor:'00000000-0000-4000-8000-000000000001',action:'user',target:'member',page:2});});
 it('returns permission failure before malformed filter validity',async()=>{mocks.assertAdminPermission.mockImplementation(()=>{throw new ApiError(403,'FORBIDDEN','Permission denied');});const response=await GET(new Request('http://localhost/api/v1/studio/audit?actor=invalid'));expect(response.status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();});
 it('preserves unauthenticated failures and does not fall back to another permission',async()=>{mocks.getAdminContext.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Authentication required'));expect((await GET(new Request('http://localhost/api/v1/studio/audit'))).status).toBe(401);expect(mocks.read).not.toHaveBeenCalled();});
 it('rejects malformed filters after authorization',async()=>{expect((await GET(new Request('http://localhost/api/v1/studio/audit?actor=invalid'))).status).toBe(400);expect(mocks.read).not.toHaveBeenCalled();});
});
