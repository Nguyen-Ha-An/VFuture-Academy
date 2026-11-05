import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), tasks: vi.fn(), results: vi.fn(), calendar: vi.fn(), announcements: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('@/features/coursework/service', async (original) => ({
  ...await original<typeof import('@/features/coursework/service')>(),
  listCourseTasks: mocks.tasks, listCourseResults: mocks.results,
  listLearningCalendar: mocks.calendar, listLearningAnnouncements: mocks.announcements,
}));
import { ApiError } from '@/lib/api';
import { GET as tasks } from '@/app/api/v1/learning/tasks/route';
import { GET as results } from '@/app/api/v1/learning/results/route';
import { GET as calendar } from '@/app/api/v1/learning/calendar/route';
import { GET as announcements } from '@/app/api/v1/learning/announcements/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: 'authenticated-learner' });
  for (const fn of [mocks.tasks, mocks.results, mocks.announcements]) fn.mockResolvedValue([]);
  mocks.calendar.mockResolvedValue({ timeZone: 'Asia/Ho_Chi_Minh', events: [] });
});

describe('learner coursework GET routes', () => {
  it('uses the authenticated identity and typed locale/course filters with uncached envelopes', async () => {
    for (const [name, handler, fn] of [['tasks', tasks, mocks.tasks], ['results', results, mocks.results], ['announcements', announcements, mocks.announcements]] as const) {
      const response = await handler(new Request(`https://academy.test/api/v1/learning/${name}?courseId=course-a&locale=en`));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ data: [] });
      expect(fn).toHaveBeenCalledWith({ userId: 'authenticated-learner', roles: [] }, { courseId: 'course-a', locale: 'en' });
    }
  });
  it('rejects forged actor/school selectors and unauthenticated reads before querying read models', async () => {
    const forged = await tasks(new Request('https://academy.test/api/v1/learning/tasks?userId=victim&branchId=school-b'));
    expect(forged.status).toBe(400);
    expect(mocks.tasks).not.toHaveBeenCalled();
    mocks.user.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Sign in'));
    for (const handler of [tasks, results, calendar, announcements]) {
      expect((await handler(new Request('https://academy.test/api/v1/learning/tasks'))).status).toBe(401);
    }
    expect(mocks.results).not.toHaveBeenCalled();
    expect(mocks.calendar).not.toHaveBeenCalled();
    expect(mocks.announcements).not.toHaveBeenCalled();
  });
  it('requires a valid bounded timestamp range and returns the display timezone contract', async () => {
    expect((await calendar(new Request('https://academy.test/api/v1/learning/calendar'))).status).toBe(400);
    expect(mocks.calendar).not.toHaveBeenCalled();
    const response = await calendar(new Request('https://academy.test/api/v1/learning/calendar?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { timeZone: 'Asia/Ho_Chi_Minh', events: [] } });
    expect(mocks.calendar).toHaveBeenCalledWith({ userId: 'authenticated-learner', roles: [] }, {
      start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z', locale: 'vi',
    });
  });
});
