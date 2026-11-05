import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { ExamAnswersSchema } from '@/features/exams/http';
import { bankSource, compileExamFixtures, itemContext, learner, MutableClock } from './test-kit';

const mocks=vi.hoisted(()=>({service:vi.fn(),requireUser:vi.fn(),actor:vi.fn(),database:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth',()=>({requireApiUser:mocks.requireUser}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/exams/server',()=>({createServerExamService:mocks.service,learnerExamActor:mocks.actor}));
vi.mock('@/lib/analytics',()=>({track:vi.fn(async()=>undefined)}));
import { PUT as saveAnswers } from '@/app/api/v1/exams/attempts/[attemptId]/answers/route';

const matching=[{left:'left-one',right:'right-one'}];
const supported=[
  ['matching',matching],
  ['grouped matching',{'group/child':matching}],
  ['file upload',{files:[{assetId:'file-one',name:'answer.pdf',size:100,mime:'application/pdf'}]}],
  ['link upload',{links:[{url:'https://example.test/answer',label:'Answer'}]}],
  ['long essay','a'.repeat(5000)],
  ['long code',{language:'python',code:'a'.repeat(5000)}],
] as const;
let exam:CompiledItem;
beforeAll(async()=>{({all:exam}=await compileExamFixtures());});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({id:learner.id});mocks.actor.mockResolvedValue(learner);
  mocks.database.mockReturnValue({rpc:async()=>({data:true,error:null})});
});
function serviceHarness(label: string){
  const repo=new InMemoryExamRepo();
  const pinned=structuredClone(exam);
  const questionId=pinned.grading.exam!.sections[0].questionIds[0];
  const question=pinned.grading.questions[questionId];
  const type = label === 'matching' ? 'matching' : label === 'grouped matching' ? 'question_group'
    : label === 'file upload' || label === 'link upload' ? 'upload_answer'
      : label === 'long code' ? 'code_answer' : 'essay';
  question.type=type;
  if(type==='question_group') question.children=[{...question,id:`${questionId}/child`,type:'matching',children:undefined}];
  const service=createExamService({repo,clock:new MutableClock(new Date('2026-09-02T00:00:00.000Z')),bank:bankSource,loadItem:async()=>itemContext(pinned),isEnrolled:async()=>true,
    validateAnswerAttachments:async(actor,_attempt,answers)=>{
      expect(actor.id).toBe(learner.id);
      const serialized=JSON.stringify(answers);
      if(serialized.includes('assetId') && !serialized.includes('file-one')) throw new Error('Unowned test asset');
    },
  });
  mocks.service.mockReturnValue(service);
  return {repo,service};
}

describe('exam answer HTTP boundary',()=>{
  it.each(supported)('accepts %s in the actual bounded answer schema',(_label,value)=>{
    expect(ExamAnswersSchema.safeParse({'section/question':value}).success).toBe(true);
  });
  it.each(supported)('persists %s through the real answer route and exam service',async(_label,value)=>{
    const {repo,service}=serviceHarness(_label);
    const started=await service.start(learner,'course-one',exam.id);
    const attempt=await repo.getAttempt(started.attemptId);
    const questionId=attempt!.questionSet.sections[0].questionIds[0];
    const actualValue=_label==='grouped matching'?{[`${questionId}/child`]:matching}:value;
    const response=await saveAnswers(new Request(`http://localhost/api/v1/exams/attempts/${started.attemptId}/answers`,{
      method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({answers:{[questionId]:actualValue}}),
    }),{params:Promise.resolve({attemptId:started.attemptId})});
    expect(response.status).toBe(200);
    expect((await repo.listAnswers(started.attemptId)).find(row=>row.questionId===questionId)?.answer).toEqual(actualValue);
  });
  it('retains the 250-answer and 64 KiB serialized limits',()=>{
    expect(ExamAnswersSchema.safeParse(Object.fromEntries(Array.from({length:251},(_,i)=>[`q-${i}`,null]))).success).toBe(false);
    expect(ExamAnswersSchema.safeParse({q:'x'.repeat(65_536)}).success).toBe(false);
  });
  it('retains array, field-count and nesting limits',()=>{
    expect(ExamAnswersSchema.safeParse({q:Array.from({length:201},()=>1)}).success).toBe(false);
    expect(ExamAnswersSchema.safeParse({q:Object.fromEntries(Array.from({length:201},(_,i)=>[`k-${i}`,1]))}).success).toBe(false);
    expect(ExamAnswersSchema.safeParse({q:{a:{b:{c:{d:{e:'deep'}}}}}}).success).toBe(false);
  });
  it.each(['__proto__','constructor','prototype'])('rejects dangerous object key %s',key=>{
    const answers=JSON.parse(`{"q":{"${key}":"x"}}`);
    expect(ExamAnswersSchema.safeParse(answers).success).toBe(false);
  });
  it('fails closed when file references are supplied without an attachment validator', async () => {
    const pinned=structuredClone(exam);
    const questionId=pinned.grading.exam!.sections[0].questionIds[0];
    pinned.grading.questions[questionId].type='upload_answer';
    const repo=new InMemoryExamRepo();
    const service=createExamService({repo,clock:new MutableClock(new Date('2026-09-02T00:00:00.000Z')),bank:bankSource,loadItem:async()=>itemContext(pinned),isEnrolled:async()=>true});
    const started=await service.start(learner,'course-one',pinned.id);
    await expect(service.save(learner,started.attemptId,{[questionId]:{files:[{assetId:'file-one',name:'answer.pdf',size:100,mime:'application/pdf'}]}})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await repo.listAnswers(started.attemptId)).toEqual([]);
  });
});
