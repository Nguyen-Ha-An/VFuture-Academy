import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileCourse, type CompiledItem } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import { createApiRuntime } from '@/features/runtime/api-runtime';
import { ApiError } from '@/lib/api';

const mocks=vi.hoisted(()=>({database:vi.fn(),validate:vi.fn(),user:vi.fn(),actor:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.user}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/quizzes/server',()=>({learnerQuizActor:mocks.actor}));
vi.mock('@/features/quizzes/attachments',()=>({validateQuizAnswerAttachments:mocks.validate}));
vi.mock('@/features/progress/service',()=>({recompute:vi.fn(async()=>undefined)}));
vi.mock('@/features/xp/service',()=>({award:vi.fn(async()=>undefined)}));
import { POST as checkQuiz } from '@/app/api/v1/quizzes/check/route';
import { POST as submitQuiz } from '@/app/api/v1/quizzes/submit/route';

type Result={data:unknown;error:null;count?:number};
class Query implements PromiseLike<Result> {
  constructor(private readonly result:Result,private readonly writes:Record<string,unknown>[]) {}
  select(){return this;} eq(){return this;} in(){return this;}
  insert(value:Record<string,unknown>){this.writes.push(value);return this;}
  maybeSingle(){return Promise.resolve(this.result);} single(){return Promise.resolve(this.result);}
  then<T1=Result,T2=never>(resolve?:((value:Result)=>T1|PromiseLike<T1>)|null,reject?:((reason:unknown)=>T2|PromiseLike<T2>)|null){return Promise.resolve(this.result).then(resolve,reject);}
}
let lesson:CompiledItem;
beforeAll(async()=>{
  const result=await compileCourse(FIXTURES['ai-foundations'],fixtureResolver,{publish:true});
  if(!result.compiled) throw new Error('fixture compilation failed');
  lesson=result.compiled.items['what-is-ai'];
});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({id:'learner-1'});
  mocks.actor.mockResolvedValue({id:'learner-1',locale:'en'});
  mocks.validate.mockResolvedValue(undefined);
});
function setup(type:'matching'|'question_group'|'upload_answer') {
  const grading=structuredClone(lesson.grading);
  const question=grading.questions['check-1/q1'];
  question.type=type;
  question.selfAssessment=type==='upload_answer';
  if(type==='matching') question.correctAnswer=[{left:'left-one',right:'right-one'}];
  if(type==='question_group') question.children=[{...question,id:'check-1/q1/child',type:'matching',correctAnswer:[{left:'left-one',right:'right-one'}],children:undefined}];
  grading.quizzes['check-1']={...grading.quizzes['check-1'],questionIds:['check-1/q1'],mode:'practice',feedback:'per_question'};
  const writes:Record<string,unknown>[]=[];
  let attempts=0;
  const database={
    rpc:async()=>({data:true,error:null}),
    from:(table:string)=>{
      const result:Result=table==='enrollments'?{data:{course_version_id:'version-1'},error:null}
        :table==='course_version_items'?{data:{grading},error:null}
          :table==='quiz_attempts'?(attempts++%2===0?{data:null,error:null,count:0}:{data:{id:'quiz-attempt-one'},error:null})
            :{data:null,error:null};
      return new Query(result,writes);
    },
  };
  mocks.database.mockReturnValue(database);
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input),'http://localhost');
    const request=new Request(url,init);
    return url.pathname.endsWith('/check')?checkQuiz(request):submitQuiz(request);
  };
  const runtime=createApiRuntime({courseId:'ai-foundations',itemId:'what-is-ai',locale:'en',initialState:{},fetchImpl});
  return {runtime,writes};
}
describe('real quiz runtime and handler answer admission',()=>{
  it('checks and submits matching edges',async()=>{
    const {runtime,writes}=setup('matching');const answer=[{left:'left-one',right:'right-one'}];
    await expect(runtime.checkQuestion('check-1','check-1/q1',answer)).resolves.toMatchObject({questionId:'check-1/q1'});
    await runtime.submitQuiz('check-1',{'check-1/q1':answer});
    expect(writes[0].answers).toEqual({'check-1/q1':answer});runtime.dispose();
  });
  it('submits grouped matching with its pinned child id',async()=>{
    const {runtime,writes}=setup('question_group');const answer={'check-1/q1/child':[{left:'left-one',right:'right-one'}]};
    await runtime.submitQuiz('check-1',{'check-1/q1':answer});
    expect(writes[0].answers).toEqual({'check-1/q1':answer});runtime.dispose();
  });
  it('serializes an explicit clear as null without creating absent answer keys',async()=>{
    const {runtime,writes}=setup('matching');
    await runtime.submitQuiz('check-1',{'check-1/q1':undefined});
    expect(writes[0].answers).toEqual({'check-1/q1':null});runtime.dispose();
  });
  it('does not persist a foreign attachment when the validator rejects it',async()=>{
    const {runtime,writes}=setup('upload_answer');
    mocks.validate.mockRejectedValue(new ApiError(403,'FORBIDDEN','Attachment not owned'));
    await expect(runtime.submitQuiz('check-1',{'check-1/q1':{files:[{assetId:'foreign',name:'work.pdf',size:100,mime:'application/pdf'}]}})).rejects.toMatchObject({status:403});
    expect(writes).toEqual([]);runtime.dispose();
  });
});
