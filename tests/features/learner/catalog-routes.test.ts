import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  listCatalog: vi.fn(),
  getCourse: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/features/catalog/service', () => ({
  listCatalog: mocks.listCatalog,
  getCourse: mocks.getCourse,
}));

import { GET as catalogGet } from '@/app/api/v1/catalog/route';
import { GET as courseGet } from '@/app/api/v1/courses/[courseId]/route';

describe('learner catalog routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'learner-1' });
    mocks.listCatalog.mockResolvedValue([]);
    mocks.getCourse.mockResolvedValue({ id: 'ai-foundations' });
  });

  it('validates and forwards catalog filters for the authenticated learner', async () => {
    const response = await catalogGet(new Request(
      'http://localhost/api/v1/catalog?locale=en&level=foundation&pathway=ai-emerging-technology&difficulty=beginner&language=vi',
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
    expect(mocks.listCatalog).toHaveBeenCalledWith(
      { userId: 'learner-1', roles: [] },
      'en',
      { level: 'foundation', pathway: 'ai-emerging-technology', difficulty: 'beginner', language: 'vi' },
    );
  });

  it('returns the standard validation envelope before service access for invalid filters', async () => {
    const response = await catalogGet(new Request('http://localhost/api/v1/catalog?difficulty=expert'));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mocks.listCatalog).not.toHaveBeenCalled();
  });

  it('loads a validated course id in the requested locale', async () => {
    const response = await courseGet(
      new Request('http://localhost/api/v1/courses/ai-foundations?locale=vi'),
      { params: Promise.resolve({ courseId: 'ai-foundations' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getCourse).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, 'ai-foundations', 'vi');
  });
});
