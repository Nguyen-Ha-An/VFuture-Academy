import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  requireApiUser: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  proposeProject: vi.fn(),
  setProjectInterest: vi.fn(),
  listStudioProjects: vi.fn(),
  getStudioProject: vi.fn(),
  createStudioProject: vi.fn(),
  updateStudioProject: vi.fn(),
  deleteStudioProject: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService, supabaseUser: vi.fn() }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/features/admin/context', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentContext: async () => ({
    context: { actor: await mocks.requirePermission('project.edit'), scope: { kind: 'central' } },
    service: { assignOwnership: vi.fn() },
  }),
  scopedContentContext: async () => ({
    context: { actor: await mocks.requirePermission('project.edit'), scope: { kind: 'central' } },
    service: {},
  }),
}));
vi.mock('@/features/projects/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/projects/service')>(),
  listProjects: mocks.listProjects,
  getProject: mocks.getProject,
  proposeProject: mocks.proposeProject,
  setProjectInterest: mocks.setProjectInterest,
  listStudioProjects: mocks.listStudioProjects,
  getStudioProject: mocks.getStudioProject,
  createStudioProject: mocks.createStudioProject,
  updateStudioProject: mocks.updateStudioProject,
  deleteStudioProject: mocks.deleteStudioProject,
  createSupabaseProjectStore: vi.fn(() => ({})),
  createProjectService: vi.fn(() => ({
    listStudio: mocks.listStudioProjects,
    createStudio: mocks.createStudioProject,
    getStudio: mocks.getStudioProject,
    updateStudio: mocks.updateStudioProject,
    deleteStudio: mocks.deleteStudioProject,
  })),
}));

import { GET as listProjects, POST as proposeProject } from '@/app/api/v1/projects/route';
import { GET as getProject } from '@/app/api/v1/projects/[id]/route';
import { POST as setInterest } from '@/app/api/v1/projects/[id]/interest/route';
import { GET as listStudioProjects, POST as createStudioProject } from '@/app/api/v1/studio/projects/route';
import {
  DELETE as deleteStudioProject,
  GET as getStudioProject,
  PUT as updateStudioProject,
} from '@/app/api/v1/studio/projects/[id]/route';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const actor = { userId: USER_ID, roles: [{ role: 'editor' as const, branchId: null }] };
const user = { id: USER_ID };
const proposal = {
  id: 'climate-lab',
  title: { vi: 'Khí hậu', en: 'Climate' },
  summary: { vi: 'Dự án khí hậu', en: 'Climate project' },
  outputLinks: [],
  skills: [],
  courseIds: [],
  coverAssetId: null,
  members: [],
};
const studioProject = {
  ...proposal,
  status: 'idea',
  approved: false,
  branchScope: { scope: 'global' },
  members: [{ userId: USER_ID, role: 'owner' }],
};
const context = { params: Promise.resolve({ id: 'climate-lab' }) };

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

describe('project routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    mocks.requireApiUser.mockResolvedValue(user);
    mocks.supabaseService.mockReturnValue(rateLimitDatabase());
  });

  it.each([
    ['list', () => listStudioProjects(new Request('http://localhost/api/v1/studio/projects'))],
    ['create', () => createStudioProject(new Request('http://localhost/api/v1/studio/projects', { method: 'POST', body: JSON.stringify(studioProject) }))],
    ['detail', () => getStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab'), context)],
    ['update', () => updateStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab', { method: 'PUT', body: JSON.stringify(studioProject) }), context)],
    ['delete', () => deleteStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab', { method: 'DELETE', headers: { 'if-match': '2026-09-03T00:00:00.000Z' } }), context)],
  ] as const)('requires project.edit before the Studio %s operation', async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith('project.edit');
    expect(mocks.listStudioProjects).not.toHaveBeenCalled();
    expect(mocks.createStudioProject).not.toHaveBeenCalled();
    expect(mocks.getStudioProject).not.toHaveBeenCalled();
    expect(mocks.updateStudioProject).not.toHaveBeenCalled();
    expect(mocks.deleteStudioProject).not.toHaveBeenCalled();
  });

  it('passes validated filters to the learner project list', async () => {
    mocks.listProjects.mockResolvedValue([{ id: 'climate-lab' }]);

    const response = await listProjects(new Request(
      'http://localhost/api/v1/projects?status=idea,active&skill=data-literacy&course=ai-foundations',
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [{ id: 'climate-lab' }] });
    expect(mocks.listProjects).toHaveBeenCalledWith(USER_ID, {
      statuses: ['idea', 'active'],
      skills: ['data-literacy'],
      courseIds: ['ai-foundations'],
    });
  });

  it('creates a rate-limited learner proposal through the authenticated route', async () => {
    mocks.proposeProject.mockResolvedValue({ id: 'climate-lab', status: 'idea', approved: false });

    const response = await proposeProject(new Request('http://localhost/api/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(proposal),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ data: { id: 'climate-lab', status: 'idea', approved: false } });
    expect(mocks.proposeProject).toHaveBeenCalledWith(USER_ID, proposal);
  });

  it('sets interest to an explicit desired state and returns the standard envelope', async () => {
    mocks.setProjectInterest.mockResolvedValue({ interested: true });

    const response = await setInterest(new Request('http://localhost/api/v1/projects/climate-lab/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interested: true }),
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { interested: true } });
    expect(mocks.setProjectInterest).toHaveBeenCalledWith(USER_ID, 'climate-lab', true);
  });

  it('rate-limits interest toggles per user and project after 60 requests in a minute', async () => {
    const rateUserId = '00000000-0000-4000-8000-000000000099';
    const rateContext = { params: Promise.resolve({ id: 'rate-limit-project' }) };
    mocks.requireApiUser.mockResolvedValue({ id: rateUserId });
    mocks.setProjectInterest.mockResolvedValue({ interested: true });

    const responses = [];
    for (let index = 0; index < 61; index += 1) {
      responses.push(await setInterest(new Request('http://localhost/api/v1/projects/rate-limit-project/interest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interested: true }),
      }), rateContext));
    }

    expect(responses.slice(0, 60).every(({ status }) => status === 200)).toBe(true);
    expect(responses[60].status).toBe(429);
    await expect(responses[60].json()).resolves.toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many project interest requests; try again later' },
    });
    expect(mocks.setProjectInterest).toHaveBeenCalledTimes(60);
  });

  it('loads a visible learner detail for the authenticated viewer', async () => {
    mocks.getProject.mockResolvedValue({ id: 'climate-lab', interested: false });

    const response = await getProject(new Request('http://localhost/api/v1/projects/climate-lab'), context);

    expect(response.status).toBe(200);
    expect(mocks.getProject).toHaveBeenCalledWith(USER_ID, 'climate-lab');
  });

  it('uses project.edit and the strict project schema for Studio updates', async () => {
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.updateStudioProject.mockResolvedValue({ id: 'climate-lab', approved: true });
    const approved = { ...studioProject, approved: true };

    const response = await updateStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approved),
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.updateStudioProject).toHaveBeenCalledWith('climate-lab', approved);
  });

  it('passes the exact If-Match revision to guarded Studio deletion', async () => {
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.deleteStudioProject.mockResolvedValue({ id: 'climate-lab', deleted: true });
    const revision = '2026-09-03T00:00:00.123456Z';

    const response = await deleteStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab', {
      method: 'DELETE', headers: { 'if-match': revision },
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.deleteStudioProject).toHaveBeenCalledWith('climate-lab', revision);
  });

  it('rejects Studio deletion without an If-Match revision', async () => {
    mocks.requirePermission.mockResolvedValue(actor);
    const response = await deleteStudioProject(new Request('http://localhost/api/v1/studio/projects/climate-lab', { method: 'DELETE' }), context);

    expect(response.status).toBe(428);
    expect(mocks.deleteStudioProject).not.toHaveBeenCalled();
  });
});
