import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),dependencies:vi.fn()}));
vi.mock('@/features/workspace/context',()=>({getStudioContext:mocks.context,studioPageContext:mocks.context,assertWorkspacePermission:vi.fn(),assertWorkspaceRequestScope:vi.fn(),assertWorkspaceSameOrigin:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:()=>({rpc:mocks.rpc})}));
vi.mock('@/features/notebooks/publish-dependencies',()=>({validateNotebookWorkspaceDependencies:mocks.dependencies}));
import {contentReviewContext} from '@/features/admin/content-review-production';
const items={practice:{kind:'assignment',notebook:{runtimeMode:'jupyterlite'}}};
const pinned=[{itemId:'practice',blockId:null,runtimeMode:'jupyterlite',runtimeProfileId:'python-data-v1',runtimeProfileVersion:'1',colabReason:null,assets:[{id:'template',checksum:'a'.repeat(64),sizeBytes:100,purpose:'template'}]}];
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.context.mockResolvedValue({scope:{kind:'central'},actor:{userId:'editor',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[],assignments:[{roleDefinitionId:'reviewer',scope:{kind:'central'},permissions:['content.review.request']}]}}});
 mocks.rpc.mockImplementation(async(name:string)=>({data:name==='cms_review_candidate'?{source:{items}}:{id:'review'},error:null}));
 mocks.dependencies.mockResolvedValue(pinned);
});
describe('live Central review notebook integration',()=>{
 it('validates and pins server-side notebook dependencies before requesting review',async()=>{
  const {service}=await contentReviewContext(new Request('https://app.example/api/v1/admin/content/course/python/reviews'),'content.review.request',true);
  await service.requestReview('course','python','revision-1');
  expect(mocks.dependencies).toHaveBeenCalledWith('python',items);
  expect(mocks.rpc).toHaveBeenCalledWith('cms_request_review',expect.objectContaining({p_notebook_dependencies:pinned,p_expected_revision:'revision-1'}));
 });
 it('does not create a review when notebook assets fail validation',async()=>{
  mocks.dependencies.mockRejectedValue(new Error('Private template is unavailable'));
  const {service}=await contentReviewContext(new Request('https://app.example/api'),'content.review.request',true);
  await expect(service.requestReview('course','python','revision-1')).rejects.toThrow('Private template');
  expect(mocks.rpc.mock.calls.some(([name])=>name==='cms_request_review')).toBe(false);
 });
});
