import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  listPublicResources: vi.fn(), getPublicResource: vi.fn(), listPublicOpportunities: vi.fn(),
  getPublicOpportunity: vi.fn(), listPublicProjects: vi.fn(), getPublicProject: vi.fn(),
}));

vi.mock('@/features/marketing/public-discovery', () => mocks);
vi.mock('@/features/marketing/public-http', () => ({
  checkPublicRateLimit: vi.fn(() => ({ allowed: true, headers: new Headers() })),
  applyPublicResponseHeaders: vi.fn((response: Response) => response),
}));

import { GET as listResources } from '@/app/api/v1/public/resources/route';
import { GET as getResource } from '@/app/api/v1/public/resources/[id]/route';
import { GET as listOpportunities } from '@/app/api/v1/public/opportunities/route';
import { GET as listProjects } from '@/app/api/v1/public/projects/route';
import { ApiError } from '@/lib/api';

describe('public discovery API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPublicResources.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    mocks.listPublicOpportunities.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    mocks.listPublicProjects.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
  });

  it('parses anonymous filters and returns the pagination envelope', async () => {
    const resources = await listResources(new Request('https://example.test/api/v1/public/resources?locale=en&type=guide&tag=ai&page=2&pageSize=20'));
    const opportunities = await listOpportunities(new Request('https://example.test/api/v1/public/opportunities?locale=vi&openNow=true&featured=false'));
    const projects = await listProjects(new Request('https://example.test/api/v1/public/projects?locale=en&skill=ai&course=foundations'));

    expect(resources.status).toBe(200);
    expect(await resources.json()).toEqual({ data: { items: [], total: 0, page: 1, pageSize: 12 } });
    expect(mocks.listPublicResources).toHaveBeenCalledWith('en', { type: 'guide', tag: 'ai', page: 2, pageSize: 20 });
    expect(mocks.listPublicOpportunities).toHaveBeenCalledWith('vi', { openNow: true, featured: false });
    expect(mocks.listPublicProjects).toHaveBeenCalledWith('en', { skill: 'ai', course: 'foundations' });
    expect(opportunities.status).toBe(200);
    expect(projects.status).toBe(200);
  });

  it('uses 404 only for a successful missing detail and preserves backend failure semantics', async () => {
    mocks.getPublicResource.mockResolvedValueOnce(null).mockRejectedValueOnce(
      new ApiError(503, 'PUBLIC_READ_UNAVAILABLE', 'Public resource is temporarily unavailable'),
    );
    const context = { params: Promise.resolve({ id: 'guide' }) };
    const missing = await getResource(new Request('https://example.test/api/v1/public/resources/guide?locale=en'), context);
    const failed = await getResource(new Request('https://example.test/api/v1/public/resources/guide?locale=en'), context);

    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: { code: 'PUBLIC_READ_UNAVAILABLE', message: 'Public resource is temporarily unavailable' } });
  });
});
