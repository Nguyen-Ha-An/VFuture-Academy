import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resourceList: vi.fn(),
  opportunityList: vi.fn(),
  projectList: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/resources/service', () => ({
  actorResourcePermissionCheck: vi.fn(() => vi.fn()),
  createResourceService: vi.fn(() => ({ listStudio: mocks.resourceList })),
}));
vi.mock('@/features/opportunities/service', () => ({
  actorOpportunityPermissionCheck: vi.fn(() => vi.fn()),
  createOpportunityService: vi.fn(() => ({ listStudio: mocks.opportunityList })),
}));
vi.mock('@/features/projects/service', () => ({
  actorPermissionCheck: vi.fn(() => vi.fn()),
  createSupabaseProjectStore: vi.fn(() => ({})),
  createProjectService: vi.fn(() => ({ listStudio: mocks.projectList })),
}));
vi.mock('@/features/bank/service', () => ({ actorPermissionCheck: vi.fn(), createBankService: vi.fn() }));
vi.mock('@/features/media/library', () => ({ createMediaLibraryService: vi.fn() }));

import { listPage, loadStudioOpportunities, loadStudioProjects, loadStudioResources } from '@/features/studio/content-lists-data';

const context = { actor: { userId: 'editor-1', roles: [] }, scope: { kind: 'central' } } as unknown as Parameters<typeof loadStudioResources>[0];

beforeEach(() => vi.clearAllMocks());

describe('Studio content list data', () => {
  it('maps resource rows to localized plain rows and reports a possible next page only for a full page', async () => {
    mocks.resourceList.mockResolvedValueOnce([
      { id: 'guide', status: 'published', updated_at: '2026-09-20T00:00:00Z', document: { title: { vi: 'Hướng dẫn', en: '' }, resourceType: 'guide' } },
      { id: 'odd', status: 'unexpected', document: null },
      { status: 'draft' },
    ]);
    const page = await loadStudioResources(context, { locale: 'en' });

    expect(mocks.resourceList).toHaveBeenCalledWith();
    expect(page).toEqual({
      page: 1,
      hasMore: false,
      rows: [
        { id: 'guide', title: 'Hướng dẫn', status: 'published', type: 'guide', secondary: null, updatedAt: '2026-09-20T00:00:00Z' },
        { id: 'odd', title: null, status: 'draft', type: null, secondary: null, updatedAt: null },
      ],
    });

    mocks.resourceList.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({ id: `r-${index}`, status: 'draft', document: {} })));
    const full = await loadStudioResources(context, { page: 2, locale: 'vi' });
    expect(mocks.resourceList).toHaveBeenLastCalledWith(2);
    expect(full.hasMore).toBe(true);
  });

  it('keeps the organization for opportunities', async () => {
    mocks.opportunityList.mockResolvedValueOnce([{ id: 'hack', title: { vi: 'Hackathon', en: 'Hackathon EN' }, organization: 'Future Lab', type: 'hackathon', status: 'draft', updated_at: null }]);
    const page = await loadStudioOpportunities(context, { locale: 'en' });
    expect(page.rows).toEqual([{ id: 'hack', title: 'Hackathon EN', status: 'draft', type: 'hackathon', secondary: 'Future Lab', updatedAt: null }]);
  });

  it('returns the whole project list newest first with approval', async () => {
    mocks.projectList.mockResolvedValueOnce([
      { id: 'old', title: { vi: 'Cũ', en: 'Old' }, status: 'idea', approved: false, updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'new', title: 'Plain title', status: 'active', approved: true, updatedAt: '2026-09-10T00:00:00Z' },
    ]);
    const rows = await loadStudioProjects(context, { locale: 'vi' });
    expect(mocks.projectList).toHaveBeenCalledWith({});
    expect(rows.map((row) => [row.id, row.title, row.approved])).toEqual([['new', 'Plain title', true], ['old', 'Cũ', false]]);
  });

  it('reads the page search param defensively', () => {
    expect(listPage(undefined)).toBe(1);
    expect(listPage('3')).toBe(3);
    expect(listPage(['4', '5'])).toBe(4);
    expect(listPage('0')).toBe(1);
    expect(listPage('abc')).toBe(1);
  });
});
