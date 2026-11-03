import { afterEach,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({sweep:vi.fn(async()=>({swept:0})),cleanup:vi.fn(async()=>({inspected:1,reconciled:1})),database:{name:'service'}}));
vi.mock('server-only',()=>({}));
vi.mock('@/features/exams/server',()=>({createServerExamService:()=>({sweepExpired:state.sweep})}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>state.database}));
vi.mock('@/lib/storage/retained-storage',()=>({reconcileExpiredStorageHolds:state.cleanup}));
vi.mock('@/lib/api',()=>({ApiError:class extends Error{},withHandler:(handler:unknown)=>handler}));
import { POST } from '@/app/api/v1/internal/exams/sweep/route';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('runs inventory reconciliation only after an authenticated Azure scheduled sweep',async()=>{
  vi.stubEnv('ACADEMY_BACKEND','azure');vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');vi.stubEnv('CRON_SECRET','secret');
  await expect(POST(new Request('https://academy.example.test/api/v1/internal/exams/sweep',{method:'POST'}))).rejects.toThrow();
  expect(state.cleanup).not.toHaveBeenCalled();
  await POST(new Request('https://academy.example.test/api/v1/internal/exams/sweep',{method:'POST',headers:{authorization:'Bearer secret'}}));
  expect(state.sweep).toHaveBeenCalledOnce();expect(state.cleanup).toHaveBeenCalledWith(state.database);
  expect(state.sweep.mock.invocationCallOrder[0]).toBeLessThan(state.cleanup.mock.invocationCallOrder[0]);
});
