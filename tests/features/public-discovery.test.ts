import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { createPublicDiscoveryService, type PublicDiscoveryDatabase } from '@/features/marketing/public-discovery';
import { isPublicProjectionAsset, type PublicMediaDatabase } from '@/features/media/public-access';
import { invalidatePublicCache } from '@/features/marketing/public-cache';

type Result = { data: unknown; error: unknown | null; count?: number | null };

function query(result: Result) {
  let range: { from: number; to: number } | undefined;
  const value = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), contains: vi.fn(), textSearch: vi.fn(), lte: vi.fn(), gte: vi.fn(), or: vi.fn(), not: vi.fn(),
    order: vi.fn(), range: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve({
      ...result,
      data: range && Array.isArray(result.data) ? result.data.slice(range.from, range.to + 1) : result.data,
    }).then(resolve, reject),
  };
  for (const method of ['select', 'eq', 'in', 'contains', 'textSearch', 'lte', 'gte', 'or', 'not', 'order', 'range', 'limit'] as const) {
    value[method].mockReturnValue(value);
  }
  value.range.mockImplementation((from: number, to: number) => {
    range = { from, to };
    return value;
  });
  return value;
}

function resourceDocument() {
  return {
    schemaVersion: 1, kind: 'resource', id: 'public-guide', languages: ['vi', 'en'], defaultLanguage: 'vi',
    title: { vi: 'Hướng dẫn', en: 'Guide' }, summary: { vi: 'Tóm tắt', en: 'Summary' }, resourceType: 'guide',
    branchScope: { scope: 'global' }, tags: ['ai'], skills: ['ai-literacy'], pathways: ['ai-emerging-technology'],
    body: { en: { blocks: [{ type: 'image', src: { assetId: 'asset_body' }, alt: 'Body' }] }, vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Nội dung' }] }] } },
    attachments: [{ src: { assetId: 'asset_attachment' }, label: { vi: 'Tệp', en: 'File' } }],
  };
}

describe('public discovery projections', () => {
  it('encodes tag and pathway filters as JSONB objects in the actual PostgREST request', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    let requested: URL | undefined;
    const client = createClient('https://unit.supabase.co', 'unit-test-only', {
      global: { fetch: async (input) => {
        requested = new URL(String(input));
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
      } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await createPublicDiscoveryService(client as unknown as PublicDiscoveryDatabase)
      .listResources('en', { tag: 'ai', pathway: 'ai-emerging-technology' });
    const filters = requested!.searchParams.getAll('document').map((value) => JSON.parse(value.slice(3)));
    expect(filters).toEqual([{ tags: ['ai'] }, { pathways: ['ai-emerging-technology'] }]);
    expect(requested!.searchParams.has('document->tags')).toBe(false);
  });

  it('returns resource cards without body data and requires published global records', async () => {
    const resources = query({ data: [{ id: 'public-guide', document: resourceDocument(), published_at: '2026-09-05T00:00:00Z', status: 'published', branch_scope: { scope: 'global' }, owner_id: 'private' }], error: null, count: 1 });
    const service = createPublicDiscoveryService({ from: vi.fn(() => resources) } as unknown as PublicDiscoveryDatabase);
    const result = await service.listResources('en');

    expect(result).toEqual({ items: [{ id: 'public-guide', title: 'Guide', summary: 'Summary', resourceType: 'guide', tags: ['ai'], skills: ['ai-literacy'], pathways: ['ai-emerging-technology'], publishedAt: '2026-09-05T00:00:00Z' }], total: 1, page: 1, pageSize: 12 });
    expect(resources.eq).toHaveBeenCalledWith('status', 'published');
    expect(resources.eq).toHaveBeenCalledWith('branch_scope->>scope', 'global');
    expect(resources.select.mock.calls[0]?.[0]).not.toContain('owner_id');
  });

  it('exposes approved global project output only and strips membership, owner, and interest data', async () => {
    const projects = query({ data: { id: 'showcase', title: { en: 'Showcase' }, summary: { en: 'Summary' }, status: 'showcased', approved: true, branch_scope: { scope: 'global' }, output_links: [{ label: { en: 'Demo' }, url: 'https://example.com/demo' }], skills: ['ai'], course_ids: ['course', 'branch-course'], cover_asset_id: 'asset_cover', created_at: 'a', updated_at: 'b', owner_id: 'secret', members: ['secret'], interested: true }, error: null });
    const courses = query({ data: [{ id: 'course', current_version_id: 'version', status: 'published' }, { id: 'branch-course', current_version_id: 'branch-version', status: 'published' }], error: null });
    const outlines = query({ data: [{ version_id: 'version', access: { scope: 'global' } }, { version_id: 'branch-version', access: { scope: 'branches', branchIds: ['vinsmc'] } }], error: null });
    const service = createPublicDiscoveryService({ from: vi.fn((table: string) => table === 'courses' ? courses : table === 'course_version_outline' ? outlines : projects) } as unknown as PublicDiscoveryDatabase);
    const detail = await service.getProject('showcase', 'en');

    expect(detail).toEqual({ id: 'showcase', title: 'Showcase', summary: 'Summary', status: 'showcased', outputLinks: [{ label: 'Demo', url: 'https://example.com/demo' }], skills: ['ai'], courseIds: ['course'], coverAssetId: 'asset_cover', createdAt: 'a', updatedAt: 'b' });
    expect(projects.eq).toHaveBeenCalledWith('approved', true);
    expect(projects.eq).toHaveBeenCalledWith('branch_scope->>scope', 'global');
    expect(projects.select.mock.calls[0]?.[0]).not.toMatch(/owner|member|interest/);
  });

  it('distinguishes a backend failure from an empty catalog', async () => {
    const failed = query({ data: null, error: { message: 'offline' } });
    const service = createPublicDiscoveryService({ from: vi.fn(() => failed) } as unknown as PublicDiscoveryDatabase);
    await expect(service.listOpportunities('en')).rejects.toMatchObject({ status: 503, code: 'PUBLIC_READ_UNAVAILABLE' });

    const empty = query({ data: [], error: null, count: 0 });
    const emptyService = createPublicDiscoveryService({ from: vi.fn(() => empty) } as unknown as PublicDiscoveryDatabase);
    await expect(emptyService.listOpportunities('en')).resolves.toMatchObject({ items: [], total: 0 });
  });

  it('defensively rejects wrong-branch resources and pending projects', async () => {
    const branchResource = query({ data: { id: 'private-guide', document: resourceDocument(), published_at: 'x', status: 'published', branch_scope: { scope: 'branches', branchIds: ['branch-a'] } }, error: null });
    const pendingProject = query({ data: { id: 'pending', title: 'Pending', summary: 'Private', status: 'idea', approved: false, branch_scope: { scope: 'global' } }, error: null });
    const resourceService = createPublicDiscoveryService({ from: vi.fn(() => branchResource) } as unknown as PublicDiscoveryDatabase);
    const projectService = createPublicDiscoveryService({ from: vi.fn(() => pendingProject) } as unknown as PublicDiscoveryDatabase);
    await expect(resourceService.getResource('private-guide', 'en')).resolves.toBeNull();
    await expect(projectService.getProject('pending', 'en')).resolves.toBeNull();
  });
});

describe('public catalog out-of-range pagination', () => {
  const catalogs = [
    { table: 'resources', method: 'listResources', filters: { type: 'guide', tag: 'ai', pathway: 'research-innovation', search: 'robot' } },
    { table: 'opportunities', method: 'listOpportunities', filters: { type: 'hackathon', featured: true, openNow: true } },
    { table: 'projects', method: 'listProjects', filters: { skill: 'robotics' } },
  ] as const;
  const rangeError = { code: 'PGRST103', details: 'Requested offset exceeds the available rows.', hint: null, message: 'Requested range not satisfiable' };

  async function clientWithResponses(responses: Array<{ status: number; body: unknown; total?: number }>) {
    const { createClient } = await import('@supabase/supabase-js');
    const requests: URL[] = [];
    const client = createClient('https://unit.supabase.co', 'unit-test-only', {
      global: { fetch: async (input) => {
        requests.push(new URL(String(input)));
        const response = responses[requests.length - 1];
        if (!response) throw new Error('Unexpected extra database request');
        return new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { 'content-type': 'application/json', ...(response.total === undefined ? {} : { 'content-range': `*/${response.total}` }) },
        });
      } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return { service: createPublicDiscoveryService(client as unknown as PublicDiscoveryDatabase), requests };
  }

  for (const catalog of catalogs) {
    it.each([0, 4, 12])(`recovers ${catalog.table} page 2 with total %i and identical public filters`, async (total) => {
      const { service, requests } = await clientWithResponses([
        { status: 416, body: rangeError, total },
        { status: 200, body: [], total },
      ]);
      const result = catalog.table === 'resources'
        ? await service.listResources('en', { ...catalog.filters, page: 2 })
        : catalog.table === 'opportunities'
          ? await service.listOpportunities('en', { ...catalog.filters, page: 2 })
          : await service.listProjects('en', { ...catalog.filters, page: 2 });
      expect(result).toEqual({ items: [], total, page: 2, pageSize: 12 });
      expect(requests).toHaveLength(2);
      expect(requests[0].pathname).toBe(`/rest/v1/${catalog.table}`);
      expect(requests[0].searchParams.get('offset')).toBe('12');
      expect(requests[0].searchParams.get('limit')).toBe('12');
      expect(requests[1].searchParams.get('offset')).toBe('0');
      expect(requests[1].searchParams.get('limit')).toBe('1');
      const withoutRange = (url: URL) => Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'offset' && key !== 'limit'));
      expect(withoutRange(requests[1])).toEqual(withoutRange(requests[0]));
      expect(requests[1].searchParams.get('branch_scope->>scope')).toBe('eq.global');
      expect(requests[1].searchParams.get(catalog.table === 'projects' ? 'approved' : 'status')).toBe(catalog.table === 'projects' ? 'eq.true' : 'eq.published');
    });

    it(`keeps real ${catalog.table} failures distinct from an out-of-range page`, async () => {
      const { service, requests } = await clientWithResponses([{ status: 403, body: { code: '42501', message: 'permission denied' } }]);
      await expect(service[catalog.method]('en', { page: 2 })).rejects.toMatchObject({ status: 503, code: 'PUBLIC_READ_UNAVAILABLE' });
      expect(requests).toHaveLength(1);
    });
  }

  it('does not disguise a failed recount or missing exact count as an empty catalog', async () => {
    for (const response of [{ status: 403, body: { code: '42501', message: 'permission denied' } }, { status: 200, body: [] }]) {
      const { service, requests } = await clientWithResponses([{ status: 416, body: rangeError }, response]);
      await expect(service.listResources('en', { page: 2 })).rejects.toMatchObject({ status: 503, code: 'PUBLIC_READ_UNAVAILABLE' });
      expect(requests).toHaveLength(2);
    }
  });

  it('never retries an unexpected invalid range on the first page', async () => {
    const { service, requests } = await clientWithResponses([{ status: 416, body: rangeError }]);
    await expect(service.listResources('en')).rejects.toMatchObject({ status: 503, code: 'PUBLIC_READ_UNAVAILABLE' });
    expect(requests).toHaveLength(1);
  });

  it('retries the requested page once if publication grows the catalog during recount', async () => {
    const row = { document: resourceDocument(), status: 'published', branch_scope: { scope: 'global' } };
    const { service, requests } = await clientWithResponses([
      { status: 416, body: rangeError },
      { status: 200, body: [row], total: 13 },
      { status: 200, body: [row], total: 13 },
    ]);
    const result = await service.listResources('en', { page: 2 });
    expect(result).toMatchObject({ items: [{ id: 'public-guide' }], total: 13, page: 2, pageSize: 12 });
    expect(requests.map((request) => request.searchParams.get('offset'))).toEqual(['12', '0', '12']);
  });

  it('bounds recovery when the requested page fails again after recount', async () => {
    const { service, requests } = await clientWithResponses([
      { status: 416, body: rangeError },
      { status: 200, body: [], total: 13 },
      { status: 416, body: rangeError },
    ]);
    await expect(service.listResources('en', { page: 2 })).rejects.toMatchObject({ status: 503, code: 'PUBLIC_READ_UNAVAILABLE' });
    expect(requests).toHaveLength(3);
  });
});

describe('anonymous public media access', () => {
  it('allows resource body and attachment assets but never unrelated lesson assets', async () => {
    const tables: Record<string, ReturnType<typeof query>> = {
      courses: query({ data: [{ current_version_id: 'v1', status: 'published' }], error: null }),
      course_version_outline: query({ data: [{ version_id: 'v1', access: { scope: 'global' }, meta: { cover: { assetId: 'asset_cover' } } }], error: null }),
      resources: query({ data: [{ document: resourceDocument(), status: 'published', branch_scope: { scope: 'global' } }], error: null }),
      projects: query({ data: [], error: null }),
    };
    const database = { from: vi.fn((table: string) => tables[table]) } as unknown as PublicMediaDatabase;
    await expect(isPublicProjectionAsset(database, 'asset_body')).resolves.toBe(true);
    await expect(isPublicProjectionAsset(database, 'asset_attachment')).resolves.toBe(true);
    await expect(isPublicProjectionAsset(database, 'asset_lesson_draft')).resolves.toBe(false);
    expect(tables.resources.eq).toHaveBeenCalledWith('status', 'published');
    expect(tables.resources.eq).toHaveBeenCalledWith('branch_scope->>scope', 'global');
  });

  it('requires approved global project covers and a current published global course cover', async () => {
    const tables: Record<string, ReturnType<typeof query>> = {
      courses: query({ data: [{ current_version_id: 'current', status: 'published' }], error: null }),
      course_version_outline: query({ data: [{ version_id: 'old', access: { scope: 'global' }, meta: { cover: { assetId: 'asset_old' } } }], error: null }),
      resources: query({ data: [], error: null }),
      projects: query({ data: [], error: null }),
    };
    const database = { from: vi.fn((table: string) => tables[table]) } as unknown as PublicMediaDatabase;
    await expect(isPublicProjectionAsset(database, 'asset_old')).resolves.toBe(false);
    expect(tables.projects.eq).toHaveBeenCalledWith('approved', true);
    expect(tables.projects.eq).toHaveBeenCalledWith('branch_scope->>scope', 'global');
    expect(tables.course_version_outline.eq).toHaveBeenCalledWith('access->>scope', 'global');
    expect(tables.courses.eq).toHaveBeenCalledWith('status', 'published');
  });

  it('rejects an asset that is referenced only by a draft resource', async () => {
    const tables: Record<string, ReturnType<typeof query>> = {
      courses: query({ data: [], error: null }),
      course_version_outline: query({ data: [], error: null }),
      resources: query({ data: [{ document: resourceDocument(), status: 'draft', branch_scope: { scope: 'global' } }], error: null }),
      projects: query({ data: [], error: null }),
    };
    const database = { from: vi.fn((table: string) => tables[table]) } as unknown as PublicMediaDatabase;
    await expect(isPublicProjectionAsset(database, 'asset_body')).resolves.toBe(false);
  });

  it('does not turn a public media authorization outage into a missing asset', async () => {
    const tables: Record<string, ReturnType<typeof query>> = {
      courses: query({ data: null, error: { message: 'offline' } }),
      resources: query({ data: [], error: null }),
      projects: query({ data: [], error: null }),
    };
    const database = { from: vi.fn((table: string) => tables[table]) } as unknown as PublicMediaDatabase;
    await expect(isPublicProjectionAsset(database, 'asset_cover')).rejects.toMatchObject({ status: 503, code: 'PUBLIC_MEDIA_UNAVAILABLE' });
  });

  it('finds an eligible public asset after the first scan page', async () => {
    const filler = Array.from({ length: 200 }, (_, index) => ({
      document: { ...resourceDocument(), id: `guide-${index}`, body: { blocks: [{ type: 'paragraph', content: [{ text: 'Public' }] }] }, attachments: [] }, status: 'published', branch_scope: { scope: 'global' },
    }));
    const tables: Record<string, ReturnType<typeof query>> = {
      courses: query({ data: [], error: null }),
      course_version_outline: query({ data: [], error: null }),
      resources: query({ data: [...filler, { document: resourceDocument(), status: 'published', branch_scope: { scope: 'global' } }], error: null }),
      projects: query({ data: [], error: null }),
    };
    const database = { from: vi.fn((table: string) => tables[table]) } as unknown as PublicMediaDatabase;
    await expect(isPublicProjectionAsset(database, 'asset_body')).resolves.toBe(true);
    expect(tables.resources.range).toHaveBeenNthCalledWith(2, 200, 399);
  });
});

describe('public cache publication hooks', () => {
  it('invalidates the selected projection and tolerates execution outside Next', () => {
    const invalidate = vi.fn();
    invalidatePublicCache('courses', invalidate);
    expect(invalidate).toHaveBeenCalledWith('public:courses');
    expect(() => invalidatePublicCache('resources', () => { throw new Error('Invariant: static generation store missing in revalidateTag'); })).not.toThrow();
    expect(() => invalidatePublicCache('projects', () => { throw new Error('cache backend failed'); })).toThrow('cache backend failed');
  });
});

describe('public discovery internal fixture guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('next/cache');
    vi.resetModules();
  });

  it('excludes fixtures in SQL so paginated totals stay exact, only while the flag is on', async () => {
    const empty = { data: [], error: null, count: 0 };
    const open = { resources: query(empty), opportunities: query(empty), projects: query(empty) };
    const openService = createPublicDiscoveryService({ from: vi.fn((table: keyof typeof open) => open[table]) } as unknown as PublicDiscoveryDatabase);
    await Promise.all([openService.listResources('en'), openService.listOpportunities('en'), openService.listProjects('en')]);
    for (const builder of Object.values(open)) expect(builder.not).not.toHaveBeenCalled();

    vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
    vi.stubEnv('INTERNAL_CONTENT_IDS', 'schema-stress');
    const hidden = { resources: query(empty), opportunities: query(empty), projects: query(empty), courses: query(empty) };
    const from = vi.fn((table: keyof typeof hidden) => hidden[table]);
    const service = createPublicDiscoveryService({ from } as unknown as PublicDiscoveryDatabase);
    await Promise.all([service.listResources('en'), service.listOpportunities('en'), service.listProjects('en')]);
    for (const table of ['resources', 'opportunities', 'projects'] as const) {
      expect(hidden[table].not.mock.calls).toEqual([['id', 'like', 'recovery-%'], ['id', 'in', '(schema-stress)']]);
    }

    // A hidden course filter short-circuits before any project query runs.
    from.mockClear();
    await expect(service.listProjects('en', { course: 'recovery-course-global' })).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 12 });
    expect(from).not.toHaveBeenCalled();
  });

  // A cache that already holds fixture rows, standing in for a Data Cache warmed before the flag was set.
  async function withWarmCache() {
    const keys: string[][] = [];
    const cached = vi.fn();
    const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 12 });
    const values: Record<string, unknown> = {
      'public-resources': page([{ id: 'public-guide' }, { id: 'recovery-resource' }]),
      'public-opportunities': page([{ id: 'recovery-opportunity' }, { id: 'sprint' }]),
      'public-projects': page([{ id: 'recovery-project', courseIds: [] }, { id: 'robot', courseIds: ['ai-foundations', 'recovery-course'] }]),
      'public-resource': { id: 'recovery-resource' },
      'public-opportunity': { id: 'recovery-opportunity' },
      'public-project': { id: 'robot', courseIds: ['ai-foundations', 'recovery-course'] },
    };
    vi.resetModules();
    vi.doMock('next/cache', () => ({
      unstable_cache: (_fn: unknown, keyParts: string[]) => {
        keys.push(keyParts);
        return async () => { cached(keyParts[0]); return structuredClone(values[keyParts[0]]); };
      },
    }));
    const discovery = await import('@/features/marketing/public-discovery');
    return { discovery, keys, cached };
  }

  it('passes cached lists through while HIDE_INTERNAL_CONTENT is unset', async () => {
    const { discovery, keys } = await withWarmCache();
    expect((await discovery.listPublicResources('en')).items.map(({ id }) => id)).toEqual(['public-guide', 'recovery-resource']);
    await expect(discovery.getPublicResource('recovery-resource', 'en')).resolves.toEqual({ id: 'recovery-resource' });
    expect(keys.every((parts) => parts.at(-1) === 'internal:shown')).toBe(true);
  });

  it('hides fixtures from every cached list and detail even when the cache already holds them', async () => {
    vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
    vi.stubEnv('INTERNAL_CONTENT_IDS', 'sprint');
    const { discovery, keys, cached } = await withWarmCache();

    expect(keys).toHaveLength(6);
    expect(keys.every((parts) => parts.at(-1) === 'internal:hidden:sprint')).toBe(true);
    expect(await discovery.listPublicResources('en')).toEqual({ items: [{ id: 'public-guide' }], total: 2, page: 1, pageSize: 12 });
    expect((await discovery.listPublicOpportunities('en')).items).toEqual([]);
    expect((await discovery.listPublicProjects('en')).items).toEqual([{ id: 'robot', courseIds: ['ai-foundations'] }]);
    await expect(discovery.getPublicResource('recovery-resource', 'en')).resolves.toBeNull();
    await expect(discovery.getPublicOpportunity('recovery-opportunity', 'en')).resolves.toBeNull();
    await expect(discovery.getPublicProject('recovery-project', 'en')).resolves.toBeNull();
    await expect(discovery.getPublicProject('robot', 'en')).resolves.toEqual({ id: 'robot', courseIds: ['ai-foundations'] });
    // Hidden details short-circuit before the cache; only the visible project detail is read.
    expect(cached.mock.calls.filter(([key]) => !String(key).endsWith('s'))).toEqual([['public-project']]);
  });
});
