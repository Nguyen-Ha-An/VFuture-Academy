import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),actor:vi.fn(),database:vi.fn(),session:vi.fn(),start:vi.fn(),save:vi.fn(),review:vi.fn(),historicalReview:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/exams/server',()=>({learnerExamActor:mocks.actor,createServerExamService:()=>mocks}));
import {GET as session,POST as start} from '@/app/api/v1/exams/[itemId]/attempts/route';
import {PUT as save} from '@/app/api/v1/exams/attempts/[attemptId]/answers/route';
import {GET as review} from '@/app/api/v1/exams/attempts/[attemptId]/review/route';
import {GET as historical} from '@/app/api/v1/exams/attempts/[attemptId]/historical-review/route';
const attemptId='00000000-0000-4000-8000-000000000003';
const attemptContext={params:Promise.resolve({attemptId})};
const itemContext={params:Promise.resolve({itemId:'exam-one'})};
beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({id:'learner'});mocks.actor.mockResolvedValue({id:'learner',locale:'en'});mocks.database.mockReturnValue({rpc:async()=>({data:true,error:null})});});
describe('large exam route streaming',()=>{
  it('preserves the JSON envelope and streams each large successful read/write response',async()=>{
    const data={blob:'界'.repeat(1_600_000)};
    for(const method of [mocks.session,mocks.start,mocks.save,mocks.review,mocks.historicalReview])method.mockResolvedValue(data);
    const responses=await Promise.all([
      session(new Request('http://localhost/api/v1/exams/exam-one/attempts?courseId=course-one'),itemContext),
      start(new Request('http://localhost/api/v1/exams/exam-one/attempts',{method:'POST',body:JSON.stringify({courseId:'course-one'})}),itemContext),
      save(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/answers`,{method:'PUT',body:JSON.stringify({answers:{}})}),attemptContext),
      review(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/review`),attemptContext),
      historical(new Request(`http://localhost/api/v1/exams/attempts/${attemptId}/historical-review?courseId=course-one&itemId=exam-one`),attemptContext),
    ]);
    for(const response of responses){
      expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');
      const reader=response.body!.getReader();const chunks:Uint8Array[]=[];
      for(;;){const part=await reader.read();if(part.done)break;chunks.push(part.value);}
      expect(chunks.length).toBeGreaterThan(1);
      expect(JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))).toEqual({data});
    }
  });
});
