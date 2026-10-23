import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/completion/effects', () => ({
  handleCourseCompleted: vi.fn(),
  handleLessonCompleted: vi.fn(),
}));

import {
  getItemPayload,
  markViewed,
  putBlockState,
  recompute,
} from '@/features/progress/service';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub } from './test-kit';

const actor: Actor = { userId: 'learner-1', roles: [] };
const activeEnrollment = {
  id: 'enrollment-1',
  user_id: 'learner-1',
  course_id: 'ai-foundations',
  course_version_id: 'version-1',
  status: 'active',
};

function forbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => forbiddenKeys(entry, found));
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    if (['correctAnswer', 'explanation', 'feedback', 'sampleAnswer', 'sampleSolution', 'sourceRef'].includes(key)) found.push(key);
    forbiddenKeys(nested, found);
  }
  return found;
}

beforeEach(() => mocks.supabaseService.mockReset());

describe('learner progress service', () => {
  it('blocks item content at an explicitly suspended trusted enrollment branch',async()=>{
    const suspended:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'}],assignments:[]}};
    const client=new SupabaseStub({enrollments:[successful({...activeEnrollment,branch_id:'school-a',branch_scope_known:true})]});
    mocks.supabaseService.mockReturnValue(client);
    await expect(getItemPayload(suspended,'ai-foundations','lesson-1','en')).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(client.queriesFor('course_version_outline')).toHaveLength(0);
  });
  it.each(['fixed', 'pool'])('returns only exam introduction metadata for %s exams', async (source) => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'exam-1', type: 'exam' }] }] } })],
      course_version_item_renders: [successful([{ locale: 'en', payload: { id: 'exam-1', kind: 'exam', title: 'Exam', settings: { openAt: '2099-01-01' }, sections: [{ questions: [{ id: 'secret', prompt: 'Secret prompt', source }] }], blocks: [{ prompt: 'Secret alternate' }] } }])],
      activity_state: [successful([])],
    });
    mocks.supabaseService.mockReturnValue(client);
    const response = await getItemPayload(actor, 'ai-foundations', 'exam-1', 'en');
    expect(response.item).toEqual({ id: 'exam-1', kind: 'exam', title: 'Exam', settings: { openAt: '2099-01-01' }, sections: [] });
    expect(JSON.stringify(response)).not.toContain('Secret');
  });

  it.each(['quiz', 'assignment'])('ignores a client completion claim for a %s without server evidence while preserving drafts', async (type) => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson' }] }] } })],
      course_version_items: [successful({ grading: { activities: [{ id: 'assessment', type }], quizzes: { assessment: {} } } })],
      quiz_attempts: [successful([])], assignment_submissions: [successful([])],
      activity_state: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    expect(await putBlockState(actor, 'ai-foundations', 'lesson-1', 'assessment', { draft: 'keep' }, true)).toMatchObject({ state: { draft: 'keep' }, completed: false });
    expect(client.queriesFor('activity_state')[0].operations).toContainEqual(['upsert', expect.objectContaining({ state: { draft: 'keep' }, completed: false }), expect.anything()]);
  });

  it.each([
    ['quiz', undefined, 0, true],
    ['quiz', 80, 79, false],
    ['quiz', 80, 80, true],
    ['assignment', undefined, 0, true],
  ] as const)('uses committed %s evidence with threshold %s and score %s', async (type, passPercent, percent, expected) => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson' }] }] } })],
      course_version_items: [successful({ grading: { activities: [{ id: 'assessment', type }], quizzes: { assessment: { passPercent } } } })],
      quiz_attempts: [successful([{ percent }])],
      assignment_submissions: [successful([{ block_id: 'assessment', status: 'submitted', submitted_at: '2026-09-03' }])],
      activity_state: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    expect(await putBlockState(actor, 'ai-foundations', 'lesson-1', 'assessment', { draft: 'keep' }, true)).toMatchObject({ completed: expected });
    const evidence = client.queriesFor(type === 'quiz' ? 'quiz_attempts' : 'assignment_submissions')[0];
    expect(evidence.operations).toEqual(expect.arrayContaining([['eq', 'user_id', actor.userId], ['eq', 'course_version_id', 'version-1'], ['eq', 'item_id', 'lesson-1']]));
    if (type === 'quiz') expect(evidence.operations).toContainEqual(['eq', 'quiz_id', 'assessment']);
  });

  it.each(['quiz', 'assignment'])('recompute ignores historical forged %s completion rows', async (type) => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] }, completion: { rules: [{ type: 'all_items' }] } })],
      course_version_items: [successful([{ item_id: 'lesson-1', kind: 'lesson', grading: { lessonCompletionMode: 'activities', activities: [{ id: 'assessment', type, required: true }], quizzes: { assessment: {} } } }])],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])], assignment_submissions: [successful([]), successful([])], quiz_attempts: [successful([])],
      activity_state: [successful([{ item_id: 'lesson-1', block_id: 'assessment', completed: true }])], course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    expect(await recompute(actor, 'ai-foundations')).toMatchObject({ lessons: { 'lesson-1': { complete: false, pending: ['assessment'] } }, course: { complete: false } });
  });

  it.each(['quiz', 'assignment'])('recompute credits a committed %s without a client activity flag', async (type) => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] }, completion: { rules: [{ type: 'exam_passed', examId: 'not-done' }] } })],
      course_version_items: [successful([{ item_id: 'lesson-1', kind: 'lesson', grading: { lessonCompletionMode: 'activities', activities: [{ id: 'assessment', type, required: true }], quizzes: { assessment: {} } } }])],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])],
      quiz_attempts: [successful(type === 'quiz' ? [{ item_id: 'lesson-1', quiz_id: 'assessment', percent: 0 }] : [])],
      assignment_submissions: [successful([]), successful(type === 'assignment' ? [{ item_id: 'lesson-1', block_id: 'assessment', status: 'submitted', submitted_at: '2026-09-03' }] : [])],
      activity_state: [successful([])], course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    expect(await recompute(actor, 'ai-foundations')).toMatchObject({ lessons: { 'lesson-1': { complete: true, pending: [] } }, course: { complete: false } });
  });

  it('requires an exact embedded assignment target, preserving unrelated draft completion as false', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson' }] }] } })],
      course_version_items: [successful({ grading: { activities: [{ id: 'assessment', type: 'assignment' }] } })],
      assignment_submissions: [successful([{ block_id: 'different-block', status: 'approved', submitted_at: '2026-09-03' }])],
      activity_state: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);
    expect(await putBlockState(actor, 'ai-foundations', 'lesson-1', 'assessment', {}, true)).toMatchObject({ completed: false });
  });

  it.each(['none', 'after_submit', 'per_question'])('projects old quiz activity results under %s feedback on read and write', async (feedback) => {
    const result = { questionId: 'group', status: 'partial', points: 1, maxPoints: 2, children: [{ questionId: 'child', status: 'partial', points: 1, maxPoints: 2, parts: { secret: 'missing' } }] };
    const state = { answers: { draft: 'preserve' }, last: { results: [result], percent: 50, revealed: {} }, checks: { group: { ...result, revealed: {} } } };
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment), successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson' }] }] } }), successful({ outline: { modules: [{ items: [{ id: 'lesson-1', type: 'lesson' }] }] } })],
      course_version_item_renders: [successful([{ locale: 'en', payload: { id: 'lesson-1', kind: 'lesson', blocks: [{ type: 'quiz', id: 'assessment', settings: { feedback } }] } }])],
      course_version_items: [successful({ grading: { activities: [{ id: 'assessment', type: 'quiz' }], quizzes: { assessment: { feedback } } } })],
      quiz_attempts: [successful([])],
      activity_state: [successful([{ block_id: 'assessment', state, completed: false }, { block_id: 'reflection', state: { parts: { draft: 'keep' }, last: { results: ['draft'] } }, completed: false }]), successful({ block_id: 'assessment', state, completed: false })],
    });
    mocks.supabaseService.mockReturnValue(client);
    const read = await getItemPayload(actor, 'ai-foundations', 'lesson-1', 'en');
    expect(read.activityState.reflection).toMatchObject({ parts: { draft: 'keep' }, last: { results: ['draft'] } });
    const written = await putBlockState(actor, 'ai-foundations', 'lesson-1', 'assessment', state, false);
    const insert = client.queriesFor('activity_state')[1].operations.find(([op]) => op === 'upsert')?.[1] as { state: unknown };
    for (const actual of [read.activityState.assessment, written.state, insert.state]) {
      expect(actual).toMatchObject({ answers: { draft: 'preserve' }, last: { percent: 50 } });
      if (feedback === 'none') expect(JSON.stringify(actual)).not.toContain('parts');
      else expect(JSON.stringify(actual)).toContain('secret');
    }
  });

  it('upserts block state against the enrollment-pinned version', async () => {
    const stored = {
      user_id: 'learner-1', course_version_id: 'version-1', item_id: 'lesson-1', block_id: 'activity-1',
      state: { selected: ['a'] }, completed: true, updated_at: '2026-09-03T00:00:00Z',
    };
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
      course_version_items: [successful({
        item_id: 'lesson-1', kind: 'lesson',
        grading: { activities: [{ id: 'activity-1', type: 'reflection', required: true }] },
      })],
      activity_state: [successful(stored)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(putBlockState(
      actor,
      'ai-foundations',
      'lesson-1',
      'activity-1',
      { selected: ['a'] },
      true,
      new Date('2026-09-03T00:00:00Z'),
    )).resolves.toMatchObject({ blockId: 'activity-1', completed: true });

    expect(client.queriesFor('activity_state')[0].operations).toContainEqual(['upsert', {
      user_id: 'learner-1',
      course_version_id: 'version-1',
      item_id: 'lesson-1',
      block_id: 'activity-1',
      state: { selected: ['a'] },
      completed: true,
      updated_at: '2026-09-03T00:00:00.000Z',
    }, { onConflict: 'user_id,course_version_id,item_id,block_id' }]);
  });

  it('returns only the pinned learner render and strips defense-in-depth answer material', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        default_language: 'en',
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
      course_version_item_renders: [successful([{
        locale: 'en',
        payload: {
          id: 'lesson-1',
          kind: 'lesson',
          blocks: [{
            id: 'quiz-1',
            questions: [{
              id: 'q-1',
              correctAnswer: 'a',
              explanation: { blocks: [] },
              feedback: { correct: 'yes' },
              sampleAnswer: 'answer',
              sampleSolution: 'solution',
              sourceRef: 'bank-version-1',
              rubric: { levels: ['visible'] },
              rubrics: { essay: { levels: ['visible'] } },
            }],
          }],
        },
      }])],
      activity_state: [successful([{
        block_id: 'activity-1',
        state: {
          selected: ['a'],
          correctAnswer: 'must-not-round-trip',
          feedback: 'must-not-round-trip',
          sampleAnswer: 'must-not-round-trip',
          sampleSolution: 'must-not-round-trip',
          sourceRef: 'must-not-round-trip',
          rubric: { levels: ['visible'] },
        },
        completed: true,
        updated_at: '2026-09-03T12:00:00Z',
      }])],
    });
    mocks.supabaseService.mockReturnValue(client);

    const response = await getItemPayload(actor, 'ai-foundations', 'lesson-1', 'en');

    expect(response).toMatchObject({
      courseVersionId: 'version-1',
      item: {
        id: 'lesson-1',
        kind: 'lesson',
        blocks: [{ questions: [{
          rubric: { levels: ['visible'] },
          rubrics: { essay: { levels: ['visible'] } },
        }] }],
      },
      activityState: {
        'activity-1': {
          selected: ['a'],
          rubric: { levels: ['visible'] },
          completed: true,
          updatedAt: '2026-09-03T12:00:00Z',
        },
      },
    });
    expect(forbiddenKeys(response)).toEqual([]);
    expect(client.queriesFor('course_version_item_renders')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'version_id', 'version-1'],
      ['eq', 'item_id', 'lesson-1'],
      ['in', 'locale', ['en']],
    ]));
    expect(client.queriesFor('course_version_items')).toHaveLength(0);
  });

  it('falls back to the course default locale when the requested learner render is unavailable', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        default_language: 'vi',
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
      course_version_item_renders: [successful([{
        locale: 'vi',
        payload: { id: 'lesson-1', kind: 'lesson', title: 'Bài học' },
      }])],
      activity_state: [successful([])],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getItemPayload(actor, 'ai-foundations', 'lesson-1', 'en')).resolves.toMatchObject({
      locale: 'vi',
      item: { id: 'lesson-1', title: 'Bài học' },
    });
    expect(client.queriesFor('course_version_item_renders')[0].operations).toContainEqual([
      'in', 'locale', ['en', 'vi'],
    ]);
  });

  it('does not expose a render for an orphan item outside the pinned outline', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({ outline: { modules: [] } })],
      course_version_item_renders: [successful({ payload: { id: 'orphan-lesson', kind: 'lesson' } })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getItemPayload(actor, 'ai-foundations', 'orphan-lesson', 'en')).rejects.toMatchObject({
      status: 404,
      code: 'ITEM_NOT_FOUND',
    });
    expect(client.queriesFor('course_version_item_renders')).toHaveLength(0);
  });

  it('loads a current item for a non-enrolled learner whose branch can access the course', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(null)],
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful({
        access: { scope: 'branches', branchIds: ['branch-1'] },
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
      course_version_item_renders: [successful([{ locale: 'en', payload: { id: 'lesson-1', kind: 'lesson' } }])],
      activity_state: [successful([])],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getItemPayload(actor, 'ai-foundations', 'lesson-1', 'en')).resolves.toMatchObject({
      courseVersionId: 'version-current', item: { id: 'lesson-1' }, activityState: {},
    });
  });

  it('returns not found for a non-enrolled learner outside a branch-scoped course', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(null)],
      courses: [successful({ id: 'ai-foundations', status: 'published', current_version_id: 'version-current' })],
      profiles: [successful({ branch_id: 'branch-1' })],
      course_version_outline: [successful({
        access: { scope: 'branches', branchIds: ['branch-2'] },
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(getItemPayload(actor, 'ai-foundations', 'lesson-1', 'en')).rejects.toMatchObject({
      status: 404, code: 'COURSE_NOT_FOUND',
    });
    expect(client.queriesFor('course_version_item_renders')).toHaveLength(0);
  });

  it('does not downgrade an already completed lesson when marking it viewed', async () => {
    const completedProgress = { item_id: 'lesson-1', status: 'completed', completed_at: '2026-09-02T00:00:00Z' };
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
    }, {
      learner_mark_viewed: [successful(completedProgress)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(markViewed(actor, 'ai-foundations', 'lesson-1')).resolves.toEqual({
      itemId: 'lesson-1', status: 'completed',
    });
    expect(client.queriesFor('lesson_progress')).toHaveLength(0);
    expect(client.rpcCalls[0]).toMatchObject({ name: 'learner_mark_viewed' });
  });

  it('conditionally updates a not-started lesson without racing a completed transition', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
    }, {
      learner_mark_viewed: [successful({ item_id: 'lesson-1', status: 'in_progress' })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await markViewed(actor, 'ai-foundations', 'lesson-1', new Date('2026-09-03T00:00:00Z'));

    expect(client.rpcCalls).toEqual([{
      name: 'learner_mark_viewed',
      args: {
        p_user_id: 'learner-1',
        p_course_version_id: 'version-1',
        p_item_id: 'lesson-1',
        p_started_at: '2026-09-03T00:00:00.000Z',
      },
    }]);
    expect(client.queriesFor('lesson_progress')).toHaveLength(0);
  });

  it('rejects viewed progress for a non-lesson outline item', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'exam-1', type: 'exam', required: true }] }] },
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(markViewed(actor, 'ai-foundations', 'exam-1')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PROGRESS_TARGET',
    });
    expect(client.queriesFor('lesson_progress')).toHaveLength(0);
  });

  it('rejects block state for an id absent from the pinned item activity manifest', async () => {
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      })],
      course_version_items: [successful({
        item_id: 'lesson-1', kind: 'lesson',
        grading: { activities: [{ id: 'activity-1', type: 'reflection', required: true }] },
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(putBlockState(
      actor, 'ai-foundations', 'lesson-1', 'guessed-block', {}, false,
    )).rejects.toMatchObject({ status: 400, code: 'INVALID_BLOCK_ID' });
    expect(client.queriesFor('activity_state')).toHaveLength(0);
  });

  it('treats an outline lesson with no grading row as incomplete and returns a warning', async () => {
    const backgroundActor:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'}],assignments:[]}};
    const client = new SupabaseStub({
      enrollments: [successful({...activeEnrollment,branch_id:'school-a',branch_scope_known:true})],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
        completion: { rules: [{ type: 'all_items' }] },
      })],
      course_version_items: [successful([])],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      quiz_attempts: [successful([])],
      activity_state: [successful([])],
      course_completions: [successful(null)],
    });
    mocks.supabaseService.mockReturnValue(client);

    await expect(recompute(backgroundActor, 'ai-foundations')).resolves.toMatchObject({
      warnings: [{
        code: 'MISSING_LESSON_GRADING',
        itemId: 'lesson-1',
        message: 'Lesson grading is unavailable',
      }],
      lessons: {
        'lesson-1': { complete: false, pending: ['grading'], transitioned: false },
      },
      course: { complete: false },
    });
    expect(client.queriesFor('branch_memberships')).toHaveLength(0);
  });

  it('transitions a lesson and course to complete once and emits one completion hook', async () => {
    const outline = {
      outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      completion: { rules: [{ type: 'all_items' }], certificate: true },
    };
    const grading = {
      lessonCompletionMode: 'activities',
      activities: [{ id: 'activity-1', type: 'reflection', required: true }],
      questions: {}, quizzes: {}, rubrics: {},
    };
    const completion = {
      user_id: 'learner-1', course_id: 'ai-foundations', course_version_id: 'version-1', completed_at: '2026-09-03T00:00:00Z',
    };
    const completionEffect = { id: 'effect-1', ...completion, status: 'pending', attempts: 0 };
    const client = new SupabaseStub({
      enrollments: [
        successful(activeEnrollment),
        successful({ ...activeEnrollment, status: 'completed', completed_at: completion.completed_at }),
      ],
      course_version_outline: [successful(outline), successful(outline)],
      course_version_items: [
        successful([{ item_id: 'lesson-1', kind: 'lesson', grading }]),
        successful([{ item_id: 'lesson-1', kind: 'lesson', grading }]),
      ],
      lesson_progress: [
        successful([{ item_id: 'lesson-1', status: 'in_progress' }]),
        successful({ item_id: 'lesson-1', status: 'completed', completed_at: completion.completed_at }),
        successful([{ item_id: 'lesson-1', status: 'completed' }]),
      ],
      exam_grades: [successful([]), successful([])],
      assignment_submissions: [successful([]), successful([])],
      quiz_attempts: [successful([]), successful([])],
      activity_state: [
        successful([{ item_id: 'lesson-1', block_id: 'activity-1', completed: true }]),
        successful([{ item_id: 'lesson-1', block_id: 'activity-1', completed: true }]),
      ],
      course_completions: [successful(null), successful(completion)],
      course_completion_effects: [successful(null)],
    }, {
      learner_complete_course: [successful({ ...completion, transitioned: true })],
      learner_claim_completion_effect: [
        successful({ ...completionEffect, attempts: 1 }),
        successful(null),
        successful(null),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);
    const onCourseCompleted = vi.fn();
    const onLessonCompleted = vi.fn().mockRejectedValue(new Error('xp unavailable'));
    const lessonLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const first = await recompute(actor, 'ai-foundations', { onCourseCompleted, onLessonCompleted, now: () => new Date(completion.completed_at) });
    const second = await recompute(actor, 'ai-foundations', { onCourseCompleted, onLessonCompleted, now: () => new Date(completion.completed_at) });

    expect(first).toMatchObject({
      lessons: { 'lesson-1': { complete: true, transitioned: true } },
      course: { complete: true, transitioned: true },
    });
    expect(second).toMatchObject({
      lessons: { 'lesson-1': { complete: true, transitioned: false } },
      course: { complete: true, transitioned: false },
    });
    expect(client.queriesFor('lesson_progress').filter((query) => query.operations.some(([operation]) => operation === 'upsert'))).toHaveLength(1);
    expect(client.rpcCalls.filter(({ name }) => name === 'learner_complete_course')).toEqual([{
      name: 'learner_complete_course',
      args: {
        p_user_id: 'learner-1',
        p_course_id: 'ai-foundations',
        p_course_version_id: 'version-1',
        p_completed_at: '2026-09-03T00:00:00.000Z',
      },
    }]);
    expect(client.queriesFor('course_completions').filter((query) => query.operations.some(([operation]) => operation === 'insert'))).toHaveLength(0);
    expect(onCourseCompleted).toHaveBeenCalledTimes(1);
    expect(onCourseCompleted).toHaveBeenCalledWith(completion);
    expect(onLessonCompleted).toHaveBeenCalledTimes(1);
    expect(lessonLog).toHaveBeenCalledWith(
      expect.stringMatching(/^\[learning-effect:[0-9a-f-]+\]/),
      expect.objectContaining({ effect: 'xp.lesson_completed', itemId: 'lesson-1' }),
    );
    lessonLog.mockRestore();
  });

  it('keeps a failed completion effect pending and retries it on the next recompute', async () => {
    const completedAt = '2026-09-03T00:00:00Z';
    const completion = {
      user_id: 'learner-1', course_id: 'ai-foundations', course_version_id: 'version-1', completed_at: completedAt,
    };
    const pendingEffect = {
      id: 'effect-1',
      ...completion,
      status: 'pending',
      attempts: 0,
    };
    const outline = {
      outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      completion: { rules: [{ type: 'all_items' }] },
    };
    const grading = {
      lessonCompletionMode: 'view', activities: [], questions: {}, quizzes: {}, rubrics: {},
    };
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment), successful(activeEnrollment)],
      course_version_outline: [successful(outline), successful(outline)],
      course_version_items: [
        successful([{ item_id: 'lesson-1', kind: 'lesson', grading }]),
        successful([{ item_id: 'lesson-1', kind: 'lesson', grading }]),
      ],
      lesson_progress: [
        successful([{ item_id: 'lesson-1', status: 'completed' }]),
        successful([{ item_id: 'lesson-1', status: 'completed' }]),
      ],
      exam_grades: [successful([]), successful([])],
      assignment_submissions: [successful([]), successful([])],
      quiz_attempts: [successful([]), successful([])],
      activity_state: [successful([]), successful([])],
      course_completions: [successful(completion), successful(completion)],
      course_completion_effects: [successful(null), successful(null)],
    }, {
      learner_claim_completion_effect: [
        successful({ ...pendingEffect, attempts: 1 }),
        successful({ ...pendingEffect, attempts: 2 }),
        successful(null),
      ],
    });
    mocks.supabaseService.mockReturnValue(client);
    const onCourseCompleted = vi.fn()
      .mockRejectedValueOnce(new Error('certificate service unavailable'))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(recompute(actor, 'ai-foundations', {
        onCourseCompleted, now: () => new Date(completedAt),
      })).resolves.toMatchObject({
        course: { complete: true },
      });
      await expect(recompute(actor, 'ai-foundations', {
        onCourseCompleted, now: () => new Date(completedAt),
      })).resolves.toMatchObject({
        course: { complete: true },
      });
      expect(errorSpy).toHaveBeenCalledWith(
        '[learning-completion-effect:effect-1] Completion hook failed',
        expect.objectContaining({ courseId: 'ai-foundations' }),
      );
    } finally {
      errorSpy.mockRestore();
    }

    expect(onCourseCompleted).toHaveBeenCalledTimes(2);
    expect(onCourseCompleted).toHaveBeenNthCalledWith(1, completion);
    expect(client.queriesFor('course_completion_effects')[0].operations).toContainEqual(['update', expect.objectContaining({
      status: 'pending', locked_until: null,
    })]);
    expect(client.queriesFor('course_completion_effects')[1].operations).toContainEqual(['update', expect.objectContaining({
      status: 'done', locked_until: null, last_error: null,
    })]);
    expect(client.rpcCalls.filter(({ name }) => name === 'learner_claim_completion_effect')).toEqual([
      expect.objectContaining({ name: 'learner_claim_completion_effect' }),
      expect.objectContaining({ name: 'learner_claim_completion_effect' }),
      expect.objectContaining({ name: 'learner_claim_completion_effect' }),
    ]);
  });

  it('marks a completion effect failed when delivery fails on its fifth claimed attempt', async () => {
    const completedAt = '2026-09-03T00:00:00Z';
    const completion = {
      user_id: 'learner-1', course_id: 'ai-foundations', course_version_id: 'version-1', completed_at: completedAt,
    };
    const outline = {
      outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
      completion: { rules: [{ type: 'all_items' }] },
    };
    const client = new SupabaseStub({
      enrollments: [successful(activeEnrollment)],
      course_version_outline: [successful(outline)],
      course_version_items: [successful([{
        item_id: 'lesson-1', kind: 'lesson',
        grading: { lessonCompletionMode: 'view', activities: [], questions: {}, quizzes: {}, rubrics: {} },
      }])],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([])],
      assignment_submissions: [successful([])],
      quiz_attempts: [successful([])],
      activity_state: [successful([])],
      course_completions: [successful(completion)],
      course_completion_effects: [successful(null)],
    }, {
      learner_claim_completion_effect: [successful({
        id: 'effect-final-attempt', ...completion, status: 'pending', attempts: 5,
      })],
    });
    mocks.supabaseService.mockReturnValue(client);
    const onCourseCompleted = vi.fn().mockRejectedValue(new Error('certificate service unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await recompute(actor, 'ai-foundations', {
        onCourseCompleted,
        now: () => new Date(completedAt),
      });
    } finally {
      errorSpy.mockRestore();
    }

    expect(client.queriesFor('course_completion_effects')[0].operations).toContainEqual([
      'update', expect.objectContaining({
        status: 'failed',
        locked_until: null,
        last_error: 'certificate service unavailable',
      }),
    ]);
  });

  it('derives course requirements from lesson, exam, assignment, and quiz facts', async () => {
    const completedAt = '2026-09-03T00:00:00Z';
    const outline = {
      outline: { modules: [{ id: 'module-1', items: [
        { id: 'lesson-1', type: 'lesson', required: true },
        { id: 'exam-1', type: 'exam', required: true },
        { id: 'assignment-1', type: 'assignment', required: true },
      ] }] },
      completion: { rules: [
        { type: 'all_items' },
        { type: 'lessons_completed', lessonIds: 'all' },
        { type: 'exam_passed', examId: 'exam-1' },
        { type: 'assignment_approved', assignmentId: 'assignment-1' },
        { type: 'quiz_min_score', lessonId: 'lesson-1', quizId: 'quiz-1', percent: 80 },
      ] },
    };
    const client = new SupabaseStub({
      enrollments: [successful({ ...activeEnrollment, status: 'completed', completed_at: completedAt })],
      course_version_outline: [successful(outline)],
      course_version_items: [successful([{
        item_id: 'lesson-1', kind: 'lesson',
        grading: { lessonCompletionMode: 'view', activities: [], questions: {}, quizzes: {}, rubrics: {} },
      }])],
      lesson_progress: [successful([{ item_id: 'lesson-1', status: 'completed' }])],
      exam_grades: [successful([{ item_id: 'exam-1', percent: 88, passed: true }])],
      assignment_submissions: [successful([{
        item_id: 'assignment-1', block_id: null, status: 'approved', submitted_at: completedAt,
        grades: [{ decision: 'approved', released: true }],
      }])],
      quiz_attempts: [successful([
        { item_id: 'lesson-1', quiz_id: 'quiz-1', percent: 70 },
        { item_id: 'lesson-1', quiz_id: 'quiz-1', percent: 85 },
      ])],
      activity_state: [successful([])],
      course_completions: [successful({
        user_id: 'learner-1', course_id: 'ai-foundations', course_version_id: 'version-1', completed_at: completedAt,
      })],
    });
    mocks.supabaseService.mockReturnValue(client);

    const result = await recompute(actor, 'ai-foundations');

    expect(result.course.complete).toBe(true);
    expect(result.course.requirements).toHaveLength(5);
    expect(result.course.requirements.every(({ satisfied }) => satisfied)).toBe(true);
    expect(result.course.requirements[0].progress).toEqual({ done: 3, total: 3 });
  });
});
