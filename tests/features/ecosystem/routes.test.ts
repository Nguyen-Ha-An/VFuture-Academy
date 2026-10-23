import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const resources = {
    list: vi.fn(), listPage: vi.fn(), validate: vi.fn(), get: vi.fn(), listStudio: vi.fn(), getStudio: vi.fn(), saveDraft: vi.fn(), publish: vi.fn(),
  };
  const opportunities = {
    list: vi.fn(), listPage: vi.fn(), get: vi.fn(), listStudio: vi.fn(), getStudio: vi.fn(), saveDraft: vi.fn(), publish: vi.fn(), setInterest: vi.fn(),
  };
  return {
    resources,
    opportunities,
    requirePermission: vi.fn(),
    requireApiUser: vi.fn(),
    learnerContext: vi.fn(),
    requestLocale: vi.fn(),
    resourceFiltersFromUrl: vi.fn(() => ({})),
    opportunityFiltersFromUrl: vi.fn(() => ({})),
    createResourceService: vi.fn(() => resources),
    createOpportunityService: vi.fn(() => opportunities),
    invalidatePublicCache: vi.fn(),
    assignOwnership: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/features/admin/context', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentContext: async (request: Request, permission: string) => {
    const resource = new URL(request.url).pathname.includes('/resources');
    const legacy = permission === 'content.publish'
      ? resource ? 'resource.publish' : 'opportunity.publish'
      : resource ? 'resource.edit' : 'opportunity.edit';
    const actor = await mocks.requirePermission(legacy);
    return { context: { actor, scope: { kind: 'central' } }, service: { assignOwnership: mocks.assignOwnership } };
  },
}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/ecosystem/context', () => ({
  learnerContext: mocks.learnerContext,
  requestLocale: mocks.requestLocale,
}));
vi.mock('@/features/resources/service', () => ({
  actorResourcePermissionCheck: vi.fn(() => vi.fn()),
  createResourceService: mocks.createResourceService,
  resourceFiltersFromUrl: mocks.resourceFiltersFromUrl,
}));
vi.mock('@/features/opportunities/service', () => ({
  actorOpportunityPermissionCheck: vi.fn(() => vi.fn()),
  createOpportunityService: mocks.createOpportunityService,
  opportunityFiltersFromUrl: mocks.opportunityFiltersFromUrl,
}));
vi.mock('@/features/marketing/public-cache', () => ({ invalidatePublicCache: mocks.invalidatePublicCache }));

import { GET as listResources } from '@/app/api/v1/resources/route';
import { GET as getResource } from '@/app/api/v1/resources/[id]/route';
import { GET as listOpportunities } from '@/app/api/v1/opportunities/route';
import { GET as getOpportunity } from '@/app/api/v1/opportunities/[id]/route';
import { PUT as setOpportunityInterest } from '@/app/api/v1/opportunities/[id]/interest/route';
import { GET as listStudioResources, POST as saveStudioResource } from '@/app/api/v1/studio/resources/route';
import { GET as getStudioResource, PUT as updateStudioResource } from '@/app/api/v1/studio/resources/[id]/route';
import { POST as publishStudioResource } from '@/app/api/v1/studio/resources/[id]/publish/route';
import { GET as listStudioOpportunities, POST as saveStudioOpportunity } from '@/app/api/v1/studio/opportunities/route';
import { GET as getStudioOpportunity, PUT as updateStudioOpportunity } from '@/app/api/v1/studio/opportunities/[id]/route';
import { POST as publishStudioOpportunity } from '@/app/api/v1/studio/opportunities/[id]/publish/route';

const resourceContext = { params: Promise.resolve({ id: 'prompting-guide' }) };
const opportunityContext = { params: Promise.resolve({ id: 'ai-internship' }) };

describe('ecosystem routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'learner-1' });
    mocks.requestLocale.mockResolvedValue('en');
    mocks.learnerContext.mockResolvedValue({ userId: 'learner-1', branchId: 'branch-one', locale: 'en' });
    mocks.resources.list.mockResolvedValue([]);
    mocks.resources.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    mocks.opportunities.list.mockResolvedValue([]);
    mocks.opportunities.listPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it.each([
    ['resource list', 'resource.edit', () => listStudioResources(new Request('http://localhost/api/v1/studio/resources'))],
    ['resource create', 'resource.edit', () => saveStudioResource(new Request('http://localhost/api/v1/studio/resources', { method: 'POST', body: '{}' }))],
    ['resource detail', 'resource.edit', () => getStudioResource(new Request('http://localhost/api/v1/studio/resources/prompting-guide'), resourceContext)],
    ['resource update', 'resource.edit', () => updateStudioResource(new Request('http://localhost/api/v1/studio/resources/prompting-guide', { method: 'PUT', body: '{}' }), resourceContext)],
    ['resource publish', 'resource.publish', () => publishStudioResource(new Request('http://localhost/api/v1/studio/resources/prompting-guide/publish', { method: 'POST' }), resourceContext)],
    ['opportunity list', 'opportunity.edit', () => listStudioOpportunities(new Request('http://localhost/api/v1/studio/opportunities'))],
    ['opportunity create', 'opportunity.edit', () => saveStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities', { method: 'POST', body: '{}' }))],
    ['opportunity detail', 'opportunity.edit', () => getStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship'), opportunityContext)],
    ['opportunity update', 'opportunity.edit', () => updateStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship', { method: 'PUT', body: '{}' }), opportunityContext)],
    ['opportunity publish', 'opportunity.publish', () => publishStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship/publish', { method: 'POST' }), opportunityContext)],
  ] as const)('requires the exact permission for %s', async (_name, permission, invoke) => {
    mocks.requirePermission.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(permission);
    expect(mocks.createResourceService).not.toHaveBeenCalled();
    expect(mocks.createOpportunityService).not.toHaveBeenCalled();
  });

  it('passes validated filters and the learner branch to resource listing', async () => {
    const filters = { type: 'guide', search: 'prompt' };
    mocks.resourceFiltersFromUrl.mockReturnValueOnce(filters);

    const response = await listResources(new Request('http://localhost/api/v1/resources?locale=en&type=guide&search=prompt'));

    expect(response.status).toBe(200);
    expect(mocks.requireApiUser).toHaveBeenCalled();
    expect(mocks.learnerContext).toHaveBeenCalledWith('learner-1', 'en');
    expect(mocks.resources.listPage).toHaveBeenCalledWith(filters, { userId: 'learner-1', branchId: 'branch-one', locale: 'en' });
  });

  it('passes validated filters and the learner branch to opportunity listing', async () => {
    const filters = { type: 'external_program', openNow: true };
    mocks.opportunityFiltersFromUrl.mockReturnValueOnce(filters);

    const response = await listOpportunities(new Request('http://localhost/api/v1/opportunities?locale=en&type=external_program&openNow=true'));

    expect(response.status).toBe(200);
    expect(mocks.opportunities.listPage).toHaveBeenCalledWith(
      filters,
      { userId: 'learner-1', branchId: 'branch-one', locale: 'en' },
    );
  });

  it('returns localized resource and opportunity details in the API envelope', async () => {
    mocks.resources.get.mockResolvedValueOnce({ id: 'prompting-guide', title: 'Guide' });
    mocks.opportunities.get.mockResolvedValueOnce({ id: 'ai-internship', title: 'Internship' });

    const resourceResponse = await getResource(new Request('http://localhost/api/v1/resources/prompting-guide?locale=en'), resourceContext);
    const opportunityResponse = await getOpportunity(new Request('http://localhost/api/v1/opportunities/ai-internship?locale=en'), opportunityContext);

    await expect(resourceResponse.json()).resolves.toEqual({ data: { id: 'prompting-guide', title: 'Guide' } });
    await expect(opportunityResponse.json()).resolves.toEqual({ data: { id: 'ai-internship', title: 'Internship' } });
  });

  it('sets internal interest only for the authenticated learner', async () => {
    mocks.opportunities.setInterest.mockResolvedValueOnce({ interested: true });

    const response = await setOpportunityInterest(new Request('http://localhost/api/v1/opportunities/ai-internship/interest?locale=en', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ interested: true }),
    }), opportunityContext);

    expect(response.status).toBe(200);
    expect(mocks.opportunities.setInterest).toHaveBeenCalledWith(
      'ai-internship',
      true,
      { userId: 'learner-1', branchId: 'branch-one', locale: 'en' },
    );
  });

  it('creates a resource through the scoped service without a later ownership transfer', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: 'editor-1', roles: [] });
    const document = { id: 'prompting-guide' };
    mocks.resources.saveDraft.mockResolvedValueOnce({ id: document.id, status: 'draft' });
    const response = await saveStudioResource(new Request('http://localhost/api/v1/studio/resources', {
      method: 'POST', body: JSON.stringify({ document }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createResourceService).toHaveBeenCalledWith(expect.objectContaining({ scope: { kind: 'central' } }));
    expect(mocks.resources.saveDraft).toHaveBeenCalledWith(document, { unpublish: false, createOnly: true });
    expect(mocks.assignOwnership).not.toHaveBeenCalled();
  });

  it('rejects a studio resource update whose route id differs from the document id', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });

    const response = await updateStudioResource(new Request('http://localhost/api/v1/studio/resources/prompting-guide', {
      method: 'PUT', body: JSON.stringify({ id: 'other-guide' }),
    }), resourceContext);

    expect(response.status).toBe(400);
    expect(mocks.resources.saveDraft).not.toHaveBeenCalled();
  });

  it('passes an explicit unpublish request separately from the resource document', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });
    mocks.resources.saveDraft.mockResolvedValueOnce({ id: 'prompting-guide', status: 'draft' });
    const document = { id: 'prompting-guide' };

    const response = await updateStudioResource(new Request('http://localhost/api/v1/studio/resources/prompting-guide', {
      method: 'PUT',
      body: JSON.stringify({ document, expectedUpdatedAt: '2026-09-05T00:00:00.000Z', unpublish: true }),
    }), resourceContext);

    expect(response.status).toBe(200);
    expect(mocks.resources.saveDraft).toHaveBeenCalledWith(document, { unpublish: true, expectedUpdatedAt: '2026-09-05T00:00:00.000Z' });
  });

  it('passes an explicit unpublish request separately from the opportunity form', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });
    mocks.opportunities.saveDraft.mockResolvedValueOnce({ id: 'ai-internship', status: 'draft' });
    const document = { id: 'ai-internship' };

    const response = await updateStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship', {
      method: 'PUT',
      body: JSON.stringify({ document, unpublish: true }),
    }), opportunityContext);

    expect(response.status).toBe(200);
    expect(mocks.opportunities.saveDraft).toHaveBeenCalledWith(document, { unpublish: true });
    expect(mocks.invalidatePublicCache).toHaveBeenCalledWith('opportunities');
  });

  it('uses create-only semantics for the Studio opportunity collection', async () => {
    mocks.requirePermission.mockResolvedValueOnce({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });
    mocks.opportunities.saveDraft.mockResolvedValueOnce({ id: 'new-opportunity', status: 'draft' });
    const document = { id: 'new-opportunity' };

    const response = await saveStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities', {
      method: 'POST', body: JSON.stringify({ document }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.opportunities.saveDraft).toHaveBeenCalledWith(document, { unpublish: false, createOnly: true });
  });

  it('forwards opportunity draft and publish CAS envelopes without changing identity', async () => {
    mocks.requirePermission.mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });
    mocks.opportunities.saveDraft.mockResolvedValueOnce({ id: 'ai-internship', status: 'draft' });
    mocks.opportunities.publish.mockResolvedValueOnce({ id: 'ai-internship', status: 'published' });
    const document = { id: 'ai-internship', organization: 'Current form' };
    const expectedUpdatedAt = '2026-09-05T01:00:00.000Z';

    const saved = await updateStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship', {
      method: 'PUT',
      body: JSON.stringify({ document, expectedUpdatedAt }),
    }), opportunityContext);
    const published = await publishStudioOpportunity(new Request('http://localhost/api/v1/studio/opportunities/ai-internship/publish', {
      method: 'POST',
      body: JSON.stringify({ document, expectedUpdatedAt }),
    }), opportunityContext);

    expect(saved.status).toBe(200);
    expect(published.status).toBe(200);
    expect(mocks.opportunities.saveDraft).toHaveBeenCalledWith(document, { unpublish: false, expectedUpdatedAt });
    expect(mocks.opportunities.publish).toHaveBeenCalledWith('ai-internship', { document, expectedUpdatedAt });
  });

  it('validates and forwards Studio list page numbers', async () => {
    mocks.requirePermission.mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] });
    mocks.resources.listStudio.mockResolvedValueOnce([]);
    mocks.opportunities.listStudio.mockResolvedValueOnce([]);

    const resourceResponse = await listStudioResources(new Request('http://localhost/api/v1/studio/resources?page=2'));
    const opportunityResponse = await listStudioOpportunities(new Request('http://localhost/api/v1/studio/opportunities?page=3'));

    expect(resourceResponse.status).toBe(200);
    expect(opportunityResponse.status).toBe(200);
    expect(mocks.resources.listStudio).toHaveBeenCalledWith(2);
    expect(mocks.opportunities.listStudio).toHaveBeenCalledWith(3);
  });
});
