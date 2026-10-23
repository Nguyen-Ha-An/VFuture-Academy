import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  enroll: vi.fn(),
  getItemPayload: vi.fn(),
  markViewed: vi.fn(),
  putBlockState: vi.fn(),
  recompute: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/enrollment/service', () => ({ enroll: mocks.enroll }));
vi.mock('@/features/progress/service', () => ({
  getItemPayload: mocks.getItemPayload,
  markViewed: mocks.markViewed,
  putBlockState: mocks.putBlockState,
  recompute: mocks.recompute,
}));

import { ApiError } from '@/lib/api';
import { POST as enrollPost } from '@/app/api/v1/courses/[courseId]/enroll/route';
import { GET as itemGet } from '@/app/api/v1/courses/[courseId]/items/[itemId]/route';
import { POST as viewedPost } from '@/app/api/v1/progress/viewed/route';
import { POST as blockPost, PUT as blockPut } from '@/app/api/v1/progress/blocks/[blockId]/route';
import { successful, SupabaseStub } from './test-kit';

const actor = { userId: 'learner-1', roles: [] };

function rateLimitDatabase() {
  const counts = new Map<string, number>();
  return {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      const key = String(args.key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { data: count <= Number(args.limit), error: null };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ id: 'learner-1' });
  mocks.enroll.mockResolvedValue({ id: 'enrollment-1' });
  mocks.getItemPayload.mockResolvedValue({ item: { id: 'lesson-1' } });
  mocks.markViewed.mockResolvedValue({ itemId: 'lesson-1', status: 'in_progress' });
  mocks.putBlockState.mockResolvedValue({ blockId: 'activity-1', completed: true });
  mocks.recompute.mockResolvedValue({ course: { complete: false } });
  mocks.supabaseService.mockReturnValue(rateLimitDatabase());
});

describe('learner enrollment and progress routes', () => {
  it('enrolls the authenticated learner into the validated route course', async () => {
    const response = await enrollPost(
      new Request('http://localhost/api/v1/courses/ai-foundations/enroll', { method: 'POST' }),
      { params: Promise.resolve({ courseId: 'ai-foundations' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.enroll).toHaveBeenCalledWith(actor, 'ai-foundations');
  });

  it('loads a learner item using a validated locale and pinned service lookup', async () => {
    const response = await itemGet(
      new Request('http://localhost/api/v1/courses/ai-foundations/items/lesson-1?locale=en'),
      { params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getItemPayload).toHaveBeenCalledWith(actor, 'ai-foundations', 'lesson-1', 'en');
  });

  it('marks a viewed lesson and recomputes completion', async () => {
    const response = await viewedPost(new Request('http://localhost/api/v1/progress/viewed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courseId: 'ai-foundations', itemId: 'lesson-1' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.markViewed).toHaveBeenCalledWith(actor, 'ai-foundations', 'lesson-1');
    expect(mocks.recompute).toHaveBeenCalledWith(actor, 'ai-foundations');
  });

  it.each([
    ['PUT', blockPut],
    ['POST', blockPost],
  ] as const)('accepts a small keepalive %s without redirects and recomputes after the upsert', async (method, handler) => {
    const response = await handler(new Request('http://localhost/api/v1/progress/blocks/activity-1', {
      method,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        courseId: 'ai-foundations',
        itemId: 'lesson-1',
        state: { selected: ['a'] },
        completed: true,
      }),
    }), { params: Promise.resolve({ blockId: 'activity-1' }) });

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(mocks.putBlockState).toHaveBeenCalledWith(
      actor,
      'ai-foundations',
      'lesson-1',
      'activity-1',
      { selected: ['a'] },
      true,
    );
    expect(mocks.recompute).toHaveBeenCalledWith(actor, 'ai-foundations');
  });

  it('returns 200 when completion-effect delivery throws and leaves the effect pending', async () => {
    const completionActor = { userId: 'completion-learner', roles: [] };
    const completedAt = '2026-09-03T00:00:00Z';
    const completion = {
      user_id: completionActor.userId,
      course_id: 'ai-foundations',
      course_version_id: 'version-1',
      completed_at: completedAt,
    };
    const client = new SupabaseStub({
      enrollments: [successful({ ...completion, status: 'completed' })],
      course_version_outline: [successful({
        outline: { modules: [{ id: 'module-1', items: [{ id: 'lesson-1', type: 'lesson', required: true }] }] },
        completion: { rules: [{ type: 'all_items' }] },
      })],
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
      rate_limit: [successful(true)],
      learner_claim_completion_effect: [successful({
        id: 'effect-route-1', ...completion, status: 'pending', attempts: 1,
      })],
    });
    mocks.supabaseService.mockReturnValue(client);
    mocks.requireApiUser.mockResolvedValue({ id: completionActor.userId });
    const onCourseCompleted = vi.fn().mockRejectedValue(new Error('effect unavailable'));
    const { recompute: actualRecompute } = await vi.importActual<typeof import('@/features/progress/service')>(
      '@/features/progress/service',
    );
    mocks.recompute.mockImplementationOnce((requestActor, courseId) => actualRecompute(
      requestActor,
      courseId,
      { onCourseCompleted, now: () => new Date(completedAt) },
    ));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await viewedPost(new Request('http://localhost/api/v1/progress/viewed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseId: 'ai-foundations', itemId: 'lesson-1' }),
      }));

      expect(response.status).toBe(200);
      expect(onCourseCompleted).toHaveBeenCalledOnce();
      expect(client.queriesFor('course_completion_effects')[0].operations).toContainEqual([
        'update', expect.objectContaining({ status: 'pending', locked_until: null }),
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rate limits progress mutations to 120 immediate requests per user across both routes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00Z'));
    mocks.requireApiUser.mockResolvedValue({ id: 'rate-limited-learner' });

    try {
      for (let requestNumber = 0; requestNumber < 120; requestNumber += 1) {
        const response = await viewedPost(new Request('http://localhost/api/v1/progress/viewed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ courseId: 'ai-foundations', itemId: 'lesson-1' }),
        }));
        expect(response.status).toBe(200);
      }
      mocks.putBlockState.mockClear();

      const response = await blockPost(new Request('http://localhost/api/v1/progress/blocks/activity-1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseId: 'ai-foundations', itemId: 'lesson-1', state: {}, completed: false,
        }),
      }), { params: Promise.resolve({ blockId: 'activity-1' }) });

      expect(response.status).toBe(429);
      expect((await response.json()).error.code).toBe('RATE_LIMITED');
      expect(mocks.putBlockState).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects oversized block state before calling persistence', async () => {
    const response = await blockPut(new Request('http://localhost/api/v1/progress/blocks/activity-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        courseId: 'ai-foundations', itemId: 'lesson-1', state: { value: 'x'.repeat(17_000) }, completed: false,
      }),
    }), { params: Promise.resolve({ blockId: 'activity-1' }) });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mocks.putBlockState).not.toHaveBeenCalled();
  });

  it('does not recompute the full course for a non-completing autosave', async () => {
    const response = await blockPut(new Request('http://localhost/api/v1/progress/blocks/activity-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        courseId: 'ai-foundations', itemId: 'lesson-1', state: { draft: 'typing' }, completed: false,
      }),
    }), { params: Promise.resolve({ blockId: 'activity-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.putBlockState).toHaveBeenCalledOnce();
    expect(mocks.recompute).not.toHaveBeenCalled();
  });

  it('uses requireApiUser and returns its API-safe 401 envelope', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    const response = await itemGet(
      new Request('http://localhost/api/v1/courses/ai-foundations/items/lesson-1'),
      { params: Promise.resolve({ courseId: 'ai-foundations', itemId: 'lesson-1' }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(mocks.getItemPayload).not.toHaveBeenCalled();
  });
});
