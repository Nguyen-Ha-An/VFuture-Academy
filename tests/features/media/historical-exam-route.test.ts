import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),actor:vi.fn(),database:vi.fn(),review:vi.fn(),sign:vi.fn(),check:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/lib/permissions',async original=>({...await original<typeof import('@/lib/permissions')>(),getActor:mocks.actor}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/exams/server',()=>({createServerExamService:()=>({historicalReview:mocks.review})}));
vi.mock('@/features/media/assessment-owner',()=>({checkBoundAssessmentOwnerAccess:mocks.check}));
vi.mock('@/features/storage-transfer/grants',()=>({grantStorageTransferUrl:(url:string)=>url}));
import { GET } from '@/app/api/v1/media/[assetId]/route';

const attemptId='00000000-0000-4000-8000-000000000003';
const query=`historicalExamAttemptId=${attemptId}&courseId=course-one&itemId=exam-one`;
beforeEach(()=>{
  vi.clearAllMocks();mocks.user.mockResolvedValue({id:'learner-one'});mocks.actor.mockResolvedValue({userId:'learner-one',roles:[]});
  mocks.sign.mockResolvedValue({data:{signedUrl:'https://storage.example/signed'},error:null});
  mocks.check.mockResolvedValue(true);
  const row={owner_id:'publisher',bucket:'media',path:'media/old-image',mime:'image/png',size_bytes:20};
  mocks.database.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})}),storage:{from:()=>({createSignedUrl:mocks.sign})}});
  mocks.review.mockResolvedValue({learner:{id:'exam-one',kind:'exam',title:'Exam',sections:[{content:{assetId:'asset-image'}}]},review:{answers:{}}});
});
describe('historical exam media endpoint',()=>{
  it('authorizes an exact snapshot reference through the owner review gate',async()=>{
    const response=await GET(new Request(`http://localhost/api/v1/media/asset-image?${query}`),{params:Promise.resolve({assetId:'asset-image'})});
    expect(response.status).toBe(302);expect(mocks.review).toHaveBeenCalledWith({id:'learner-one',locale:'vi'},attemptId,'course-one','exam-one');
  });
  it.each(['historicalExamAttemptId=bad&courseId=course-one&itemId=exam-one','historicalExamAttemptId=bad','courseId=course-one','historicalExamAttemptId=00000000-0000-4000-8000-000000000003&historicalExamAttemptId=00000000-0000-4000-8000-000000000003&courseId=course-one&itemId=exam-one'])('rejects malformed or incomplete explicit context without falling back',async params=>{
    const response=await GET(new Request(`http://localhost/api/v1/media/asset-image?${params}`),{params:Promise.resolve({assetId:'asset-image'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();expect(mocks.review).not.toHaveBeenCalled();
  });
  it('never falls back to generic access for an unrelated snapshot asset',async()=>{
    const response=await GET(new Request(`http://localhost/api/v1/media/other?${query}`),{params:Promise.resolve({assetId:'other'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it.each(['FORBIDDEN','ATTEMPT_NOT_ACTIVE'] as const)('never falls back on %s attempt access',async code=>{
    const {ExamError}=await import('@/features/exams/types');
    mocks.review.mockRejectedValue(new ExamError(code,'not available'));
    const response=await GET(new Request(`http://localhost/api/v1/media/asset-image?${query}`),{params:Promise.resolve({assetId:'asset-image'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('never falls back when the original school is suspended',async()=>{
    const {ApiError}=await import('@/lib/api');
    mocks.review.mockRejectedValue(new ApiError(403,'MEMBERSHIP_SUSPENDED','suspended'));
    const response=await GET(new Request(`http://localhost/api/v1/media/asset-image?${query}`),{params:Promise.resolve({assetId:'asset-image'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('does not use the ordinary asset-owner grant when explicit history authorization fails',async()=>{
    const {ExamError}=await import('@/features/exams/types');
    mocks.review.mockRejectedValue(new ExamError('FORBIDDEN','not available'));
    const row={owner_id:'learner-one',bucket:'media',path:'media/owned-image',mime:'image/png',size_bytes:20};
    mocks.database.mockReturnValue({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})}),storage:{from:()=>({createSignedUrl:mocks.sign})}});
    const response=await GET(new Request(`http://localhost/api/v1/media/asset-image?${query}`),{params:Promise.resolve({assetId:'asset-image'})});
    expect(response.status).toBe(404);expect(mocks.sign).not.toHaveBeenCalled();
  });
});
