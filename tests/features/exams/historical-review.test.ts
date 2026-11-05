import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import type { ExamActor, ExamAttemptRecord } from '@/features/exams/types';
import { bankSource, compileExamFixtures, itemContext, learner, otherLearner, MutableClock } from './test-kit';

vi.mock('server-only',()=>({}));
vi.mock('@/lib/analytics',()=>({track:vi.fn(async()=>undefined)}));
let exam:CompiledItem;
beforeAll(async()=>{({all:exam}=await compileExamFixtures());});

describe('explicit historical exam review',()=>{
  it('reviews the owned immutable attempt after enrollment version changes without loading the current item',async()=>{
    const repo=new InMemoryExamRepo();let currentPin=true;let itemLoads=0;
    const authorize=vi.fn(async (_actor:ExamActor,_attempt:ExamAttemptRecord,courseId:string)=>courseId==='course-one');
    const service=createExamService({repo,clock:new MutableClock(new Date('2026-09-02T00:00:00.000Z')),bank:bankSource,
      loadItem:async()=>{itemLoads++;return itemContext(exam);},isEnrolled:async()=>currentPin,authorizeHistoricalReview:authorize});
    const started=await service.start(learner,'course-one',exam.id);
    await service.submit(learner,started.attemptId);
    currentPin=false;const priorLoads=itemLoads;
    await expect(service.review(learner,started.attemptId)).rejects.toMatchObject({code:'FORBIDDEN'});
    const result=await service.historicalReview(learner,started.attemptId,'course-one',exam.id);
    expect(result.review.attemptId).toBe(started.attemptId);
    expect(result.learner.kind).toBe('exam');
    expect(result.learner.sections).toBeDefined();
    expect(itemLoads).toBe(priorLoads);
    expect(authorize).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.learner)).not.toContain('correctAnswer');
  });
  it('rejects other owners, wrong item or course, and in-progress attempts',async()=>{
    const repo=new InMemoryExamRepo();
    const service=createExamService({repo,clock:new MutableClock(new Date('2026-09-02T00:00:00.000Z')),bank:bankSource,
      loadItem:async()=>itemContext(exam),isEnrolled:async()=>true,authorizeHistoricalReview:async(_actor,_attempt,courseId)=>courseId==='course-one'});
    const started=await service.start(learner,'course-one',exam.id);
    await expect(service.historicalReview(learner,started.attemptId,'course-one',exam.id)).rejects.toMatchObject({code:'ATTEMPT_NOT_ACTIVE'});
    await service.submit(learner,started.attemptId);
    await expect(service.historicalReview(otherLearner,started.attemptId,'course-one',exam.id)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.historicalReview({...otherLearner,permissions:['submission.grade'],global:true},started.attemptId,'course-one',exam.id)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.historicalReview(learner,started.attemptId,'course-one','wrong-item')).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.historicalReview(learner,started.attemptId,'wrong-course',exam.id)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
});
