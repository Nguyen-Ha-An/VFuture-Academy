import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),actor:vi.fn(),historicalReview:vi.fn(),start:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/features/exams/server',()=>({learnerExamActor:mocks.actor,createServerExamService:()=>({historicalReview:mocks.historicalReview,start:mocks.start})}));
import { GET } from '@/app/api/v1/exams/attempts/[attemptId]/historical-review/route';
const attemptId='00000000-0000-4000-8000-000000000003';
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:'learner'});mocks.actor.mockResolvedValue({id:'learner',locale:'en'});});
describe('historical exam review endpoint',()=>{
  it('passes explicit course, item and attempt to owner-only review without starting',async()=>{
    const value={learner:{kind:'exam',id:'exam-one',title:'Pinned',sections:[]},review:{attemptId,status:'graded'}};
    mocks.historicalReview.mockResolvedValue(value);
    const response=await GET(new Request('http://localhost/api/v1/exams/attempts/example/historical-review?courseId=course-one&itemId=exam-one'),{params:Promise.resolve({attemptId})});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({data:value});
    expect(mocks.historicalReview).toHaveBeenCalledWith({id:'learner',locale:'en'},attemptId,'course-one','exam-one');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects invalid attempt identifiers before reading an attempt',async()=>{
    const response=await GET(new Request('http://localhost/api/v1/exams/attempts/bad/historical-review?courseId=course-one&itemId=exam-one'),{params:Promise.resolve({attemptId:'bad'})});
    expect(response.status).toBe(400);
    expect(mocks.historicalReview).not.toHaveBeenCalled();
  });
});
