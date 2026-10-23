import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({ownership:vi.fn()}));
vi.mock('@/features/progress/service',()=>({getItemPayload:vi.fn()}));
vi.mock('@/features/studio/drafts',()=>({getDraft:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:mocks.ownership})})})})}));
import {authorizeStudioNotebook} from '@/features/notebooks/access';
import type {Actor} from '@/lib/permissions';
const actor=(permissions:string[],branchId='school-a'):Actor=>({userId:'editor',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId,status:'active'}],assignments:[{roleDefinitionId:'custom-role',scope:{kind:'branch',branchId},permissions:permissions as never[]}]}});
beforeEach(()=>mocks.ownership.mockResolvedValue({data:{ownership_kind:'branch',owner_branch_id:'school-a'},error:null}));
describe('notebook Studio ownership integration',()=>{
 it('allows a custom editor only in the course owner school',async()=>{
  await expect(authorizeStudioNotebook(actor(['course.edit']),'course')).resolves.toBeUndefined();
  await expect(authorizeStudioNotebook(actor(['course.edit'],'school-b'),'course')).rejects.toMatchObject({status:403});
 });
 it('does not turn grading into authoring or branch editing into Central access',async()=>{
  await expect(authorizeStudioNotebook(actor(['submission.grade']),'course')).rejects.toMatchObject({status:403});
  mocks.ownership.mockResolvedValue({data:{ownership_kind:'central',owner_branch_id:null},error:null});
  await expect(authorizeStudioNotebook(actor(['course.edit']),'course')).rejects.toMatchObject({status:403});
 });
 it('rejects suspended accounts and unavailable ownership',async()=>{
  const suspended=actor(['course.edit']);suspended.authorization!.accountStatus='suspended';
  await expect(authorizeStudioNotebook(suspended,'course')).rejects.toMatchObject({status:403});
  mocks.ownership.mockResolvedValue({data:null,error:null});
  await expect(authorizeStudioNotebook(actor(['course.edit']),'missing')).rejects.toMatchObject({status:404});
 });
});
