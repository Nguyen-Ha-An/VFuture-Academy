import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createGradingDetailService,
  type GradingDetailRepository,
} from '@/features/grading/detail';
import type { Actor } from '@/lib/permissions';
import type { SubmissionQueueSubmission } from '@/features/submissions/contracts';
import type { ExamAnswerRecord, ExamAttemptRecord } from '@/features/exams/types';
import type { GradingItem } from '@/content-engine/compile';

const grader: Actor = {
  userId: 'grader', roles: [], authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'school-a', status: 'active' }],
    assignments: [{ roleDefinitionId: 'grader', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['submission.grade'] }],
  },
};

const releaser: Actor = {
  userId: 'releaser', roles: [], authorization: {
    source: 'database', accountStatus: 'active',
    memberships: [{ branchId: 'school-a', status: 'active' }],
    assignments: [{ roleDefinitionId: 'releaser', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['exam.release'] }],
  },
};

function repository(overrides: Partial<GradingDetailRepository> = {}): GradingDetailRepository {
  const assignmentSubmission: SubmissionQueueSubmission = {
    id: '11111111-1111-4111-8111-111111111111', userId: 'learner', learnerName: 'Learner',
    branchId: 'school-a', courseVersionId: '22222222-2222-4222-8222-222222222222',
    itemId: 'lesson-one', blockId: 'project', assignmentId: 'project', attemptNo: 1,
    status: 'submitted', submittedAt: '2026-09-07T00:00:00.000Z', payload: { text: 'answer' }, files: [],
  };
  const grading = {
    questions: {}, quizzes: {},
    rubrics: { project: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 10 }] } },
    assignments: { project: { submission: { accepts: ['text'] }, resubmission: 'until_approved' } },
    activities: [],
  } as unknown as GradingItem;
  const examAttempt = {
    id: '33333333-3333-4333-8333-333333333333', userId: 'learner',
    courseVersionId: '22222222-2222-4222-8222-222222222222', itemId: 'exam-one',
    branchId: 'school-a', attemptNo: 1, status: 'graded', late: false,
    questionSet: { locale: 'vi', defaultLocale: 'vi', sections: [{ id: 'main', questionIds: ['auto', 'manual', 'blank'], optionOrders: {}, deadlineOffsetMs: null }], learner: { kind: 'exam', id: 'exam-one', title: 'Exam', sections: [{ id: 'main', questions: [{ id: 'auto', type: 'single_choice', content: 'A' }, { id: 'manual', type: 'short_answer', content: 'M' }, { id: 'blank', type: 'short_answer', content: 'B' }] }] } },
    gradingSnapshot: { questions: { auto: { type: 'single_choice', points: 1 }, manual: { type: 'short_answer', points: 2 }, blank: { type: 'short_answer', points: 2 } }, quizzes: {}, rubrics: {}, assignments: {}, activities: [] } as unknown as GradingItem,
    startedAt: new Date('2026-09-07T00:00:00Z'), deadlineAt: null,
    submittedAt: new Date('2026-09-07T01:00:00Z'), points: 1, maxPoints: 5, percent: 20, releasedAt: null,
    resultAvailableAt: null,
  } satisfies ExamAttemptRecord;
  const answers: ExamAnswerRecord[] = [{
    attemptId: examAttempt.id, questionId: 'auto', answer: 'a',
    result: { questionId: 'auto', status: 'correct', points: 1, maxPoints: 1 }, manualPoints: null,
    manualFeedback: null, gradedBy: null, updatedAt: new Date('2026-09-07T01:00:00Z'),
  }, {
    attemptId: examAttempt.id, questionId: 'manual', answer: 'response',
    result: { questionId: 'manual', status: 'partial', points: 1, maxPoints: 2 }, manualPoints: 1,
    manualFeedback: 'feedback', gradedBy: 'grader', updatedAt: new Date('2026-09-07T02:00:00Z'),
  }];
  return {
    getAssignmentSubmission: vi.fn(async () => assignmentSubmission),
    getAssignmentSource: vi.fn(async () => ({
      courseId: 'course-a', courseVersionId: '22222222-2222-4222-8222-222222222222',
      courseVersion: 3, publishedAt: '2026-08-01T00:00:00.000Z', itemId: 'lesson-one',
      grading,
      defaultLocale: 'vi' as const, renders: { vi: { kind: 'lesson', id: 'lesson-one', title: 'Bài', sections: [{ id: 's', blocks: [{ id: 'project', type: 'assignment', instructions: [{ type: 'paragraph', text: 'Pinned prompt' }] }] }] } },
    })),
    getExamAttempt: vi.fn(async () => ({
      attempt: examAttempt, learnerName: 'Learner', integrityEventCount: 2,
    })),
    getExamAnswers: vi.fn(async () => answers),
    ...overrides,
  };
}

describe('exam grading detail result availability', () => {
  it('projects a null result timestamp for a historical graded attempt', async () => {
    const detail = await createGradingDetailService(repository())
      .exam(grader, '33333333-3333-4333-8333-333333333333', 'school-a');

    if (detail.kind !== 'exam') throw new Error('expected an exam detail');
    expect(detail.attempt.resultAvailableAt).toBeNull();
    expect(detail.attempt.releasedAt).toBeNull();
  });

  it('projects the result timestamp independently of the release timestamp', async () => {
    const base = repository();
    const entry = (await base.getExamAttempt('x'))!;
    const repo = repository({
      getExamAttempt: async () => ({
        ...entry,
        attempt: {
          ...entry.attempt,
          resultAvailableAt: new Date('2026-09-07T03:00:00Z'),
        },
      }),
    });

    const detail = await createGradingDetailService(repo)
      .exam(grader, '33333333-3333-4333-8333-333333333333', 'school-a');

    if (detail.kind !== 'exam') throw new Error('expected an exam detail');
    expect(detail.attempt.resultAvailableAt).toBe('2026-09-07T03:00:00.000Z');
    // Completing grading must never look like an answer-key release.
    expect(detail.attempt.releasedAt).toBeNull();
  });

  it('reports grading complete when every manual question carries a score', async () => {
    const detail = await createGradingDetailService(repository())
      .exam(grader, '33333333-3333-4333-8333-333333333333', 'school-a');

    if (detail.kind !== 'exam') throw new Error('expected an exam detail');
    // `manual` is scored; `auto` is not a grader's question, and `blank` was never
    // answered so it grades as incomplete rather than awaiting a human.
    expect(detail.manualGrading).toEqual({
      total: 1, scored: 1, outstanding: [], complete: true,
    });
  });

  it('names the unscored manual questions and withholds completion', async () => {
    const base = repository();
    const answers = await base.getExamAnswers('x');
    const repo = repository({
      getExamAnswers: async () => answers.map((answer) => answer.questionId === 'manual'
        ? {
          ...answer,
          result: { questionId: 'manual', status: 'pending_manual' as const, points: 0, maxPoints: 2 },
          manualPoints: null,
          gradedBy: null,
        }
        : answer),
    });

    const detail = await createGradingDetailService(repo)
      .exam(grader, '33333333-3333-4333-8333-333333333333', 'school-a');

    if (detail.kind !== 'exam') throw new Error('expected an exam detail');
    expect(detail.manualGrading).toEqual({
      total: 1, scored: 0, outstanding: ['manual'], complete: false,
    });
  });
});

describe('Studio grading detail', () => {
  it('exposes nested manual questions with their shared context and stored answer',async()=>{
    const repo=repository();const entry=await repo.getExamAttempt('attempt');if(!entry)throw new Error('fixture');
    const child={id:'main/group/essay',type:'essay',parentId:'main/group',points:4};
    entry.attempt.questionSet.sections[0].questionIds=['main/group'];
    entry.attempt.questionSet.learner.sections=[{id:'main',questions:[{id:'main/group',type:'question_group',sharedContent:{blocks:[{type:'paragraph',content:[{text:'Shared context'}]}]},questions:[{id:child.id,type:'essay',content:{blocks:[]}}]}]}];
    entry.attempt.gradingSnapshot.questions={'main/group':{id:'main/group',type:'question_group',children:[child]},[child.id]:child} as unknown as GradingItem['questions'];
    repo.getExamAttempt=vi.fn(async()=>entry);
    repo.getExamAnswers=vi.fn(async()=>[{attemptId:entry.attempt.id,questionId:'main/group',answer:{[child.id]:'Nested essay'},result:{questionId:'main/group',status:'pending_manual',points:0,maxPoints:4,children:[{questionId:child.id,status:'pending_manual',points:0,maxPoints:4}]},manualPoints:null,manualFeedback:null,gradedBy:null,updatedAt:new Date()}] as ExamAnswerRecord[]);
    const result=await createGradingDetailService(repo).exam(grader,entry.attempt.id,'school-a');
    expect(result.questions.map(q=>q.questionId)).toEqual(['main/group',child.id]);
    expect(result.questions[1]).toMatchObject({answer:'Nested essay',result:{status:'pending_manual'},context:{blocks:[{type:'paragraph',content:[{text:'Shared context'}]}]}});
  });
  it('returns an assignment prompt and rubric from the submission pinned version', async () => {
    const service = createGradingDetailService(repository());
    const detail = await service.assignment(grader, '11111111-1111-4111-8111-111111111111', 'school-a', 'vi');
    expect(detail.source).toMatchObject({ courseVersion: 3, assignmentId: 'project' });
    expect(detail.source.prompt).toMatchObject({ id: 'project', type: 'assignment' });
    expect(detail.source.rubric?.criteria[0].id).toBe('quality');
  });

  it('reports an explicit historical error instead of using a current draft', async () => {
    const service = createGradingDetailService(repository({ getAssignmentSource: vi.fn(async () => null) }));
    await expect(service.assignment(grader, '11111111-1111-4111-8111-111111111111', 'school-a', 'vi'))
      .rejects.toMatchObject({ status: 409, code: 'HISTORICAL_SOURCE_UNAVAILABLE' });
  });

  it('rejects a submission outside the authorized requested branch', async () => {
    const service = createGradingDetailService(repository());
    await expect(service.assignment(grader, '11111111-1111-4111-8111-111111111111', 'school-b', 'vi'))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('returns every snapshotted exam question including automatic, graded, and unanswered questions', async () => {
    const service = createGradingDetailService(repository());
    const detail = await service.exam(grader, '33333333-3333-4333-8333-333333333333', 'school-a');
    expect(detail.questions.map(({ questionId }) => questionId)).toEqual(['auto', 'manual', 'blank']);
    expect(detail.questions.map(({ answer }) => answer)).toEqual(['a', 'response', null]);
    expect(detail.source.gradingSnapshot.questions).toHaveProperty('auto');
  });

  it('does not expose grading snapshots or answer keys to release-only actors', async () => {
    const service = createGradingDetailService(repository());
    await expect(service.exam(releaser, '33333333-3333-4333-8333-333333333333', 'school-a'))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
