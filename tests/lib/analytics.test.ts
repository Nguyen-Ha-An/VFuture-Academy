import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { track, type AnalyticsEventName } from '@/lib/analytics';

describe('server analytics tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseService.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ insert: mocks.insert });
    mocks.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the authenticated user separately from anonymous-safe properties', async () => {
    await track('exam.started', {
      userId: 'learner-1',
      courseId: 'course-1',
      itemId: 'exam-1',
    });

    expect(mocks.from).toHaveBeenCalledWith('analytics_events');
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: 'learner-1',
      name: 'exam.started',
      props: { courseId: 'course-1', itemId: 'exam-1' },
    });
  });

  it('never rejects when the database returns or throws an analytics error', async () => {
    mocks.insert.mockResolvedValueOnce({ error: { code: 'DATABASE_DOWN' } });
    await expect(track('lesson.completed', { userId: 'learner-1', itemId: 'lesson-1' })).resolves.toBeUndefined();

    mocks.insert.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(track('course.completed', { userId: 'learner-1', courseId: 'course-1' })).resolves.toBeUndefined();
  });

  it('drops names outside the runtime allowlist without touching the database', async () => {
    await expect(track('forged.event' as AnalyticsEventName, { userId: 'learner-1' })).resolves.toBeUndefined();

    expect(mocks.supabaseService).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('drops event properties whose serialized JSON exceeds 4 KiB', async () => {
    await expect(track('exam.started', { value: 'x'.repeat(4096) })).resolves.toBeUndefined();

    expect(mocks.supabaseService).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('settles after 1.5 seconds when the analytics insert never settles', async () => {
    vi.useFakeTimers();
    mocks.insert.mockReturnValueOnce(new Promise(() => undefined));

    let settled = false;
    const result = track('exam.started', { userId: 'learner-1' }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBeUndefined();
  });
});
