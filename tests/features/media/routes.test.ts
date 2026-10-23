import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requirePermission: vi.fn(),
  getActor: vi.fn(),
  supabaseService: vi.fn(),
  disableTypes: vi.fn(),
  imageSize: vi.fn(),
  canViewProjectCover: vi.fn(),
  canReviewProjectCover: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  requirePermission: mocks.requirePermission,
  getActor: mocks.getActor,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { upload: {} },
  enforceRateLimit: vi.fn(),
  userRateLimitKey: vi.fn(() => 'test-rate-limit-key'),
}));
vi.mock('image-size', () => ({ disableTypes: mocks.disableTypes, imageSize: mocks.imageSize }));
vi.mock('@/features/projects/service', () => ({
  canViewProjectCover: mocks.canViewProjectCover,
  canReviewProjectCover: mocks.canReviewProjectCover,
}));
vi.mock('@/features/admin/context', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentContext: async () => ({
    context: { actor: await mocks.requirePermission('media.upload'), scope: { kind: 'central' } },
    service: { assignOwnership: vi.fn() },
  }),
}));

import { POST } from '@/app/api/v1/studio/media/route';
import { GET } from '@/app/api/v1/media/[assetId]/route';
import { MAX_MEDIA_BYTES } from '@/features/media/upload';
import { ApiError } from '@/lib/api';

function requestWithFile(file: File) {
  const form = new FormData();
  form.set('file', file);
  return new Request('http://localhost/api/v1/studio/media', {
    method: 'POST',
    headers: { 'Content-Length': String(file.size + 1024) },
    body: form,
  });
}

function requestWithFormData(formData: ReturnType<typeof vi.fn>, contentLength?: string) {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('Content-Length', contentLength);
  return { headers, formData } as unknown as Request;
}

describe('media upload route', () => {
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ userId: 'owner-1' });
    mocks.imageSize.mockReturnValue({ width: 640, height: 480 });
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
    mocks.supabaseService.mockReturnValue({
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ insert })),
    });
  });

  it('writes a validated image to the private media bucket and records dimensions', async () => {
    const response = await POST(requestWithFile(new File(['png'], '../lesson.png', { type: 'image/png' })));

    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^media\/asset_[A-Z0-9]+\/lesson\.png$/), expect.any(File), { contentType: 'image/png', upsert: false });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'owner-1', bucket: 'media', mime: 'image/png', size_bytes: 3, width: 640, height: 480 }));
    expect(await response.json()).toEqual({ data: expect.objectContaining({ id: expect.stringMatching(/^asset_/), url: expect.stringMatching(/^\/api\/v1\/media\//) }) });
  });

  it('cleans up storage when the database record cannot be inserted', async () => {
    insert.mockResolvedValue({ error: { message: 'private database error' } });
    const response = await POST(requestWithFile(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' })));

    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^media\/asset_[A-Z0-9]+\/guide\.pdf$/)]);
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Internal error',
        correlationId: expect.any(String),
      },
    });
  });

  it('cleans up storage when inserting the database record rejects', async () => {
    insert.mockRejectedValue(new Error('private database error'));
    const response = await POST(requestWithFile(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' })));

    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^media\/asset_[A-Z0-9]+\/guide\.pdf$/)]);
  });

  it('does not insert a database record when storage upload fails', async () => {
    upload.mockResolvedValue({ error: { message: 'private storage error' } });
    const response = await POST(requestWithFile(new File(['pdf'], 'guide.pdf', { type: 'application/pdf' })));

    expect(response.status).toBe(500);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['image/svg+xml'],
    ['image/png'],
  ])('rejects an SVG upload declared as %s', async (type) => {
    const response = await POST(requestWithFile(new File([
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ], 'script.svg', { type })));

    expect(response.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid', 'not-a-number', 400, 'INVALID_CONTENT_LENGTH'],
    ['an empty', '0', 400, 'EMPTY_UPLOAD'],
    ['an oversized', String(MAX_MEDIA_BYTES + 1), 413, 'FILE_TOO_LARGE'],
  ])('rejects %s Content-Length before parsing multipart data', async (_label, contentLength, status, code) => {
    const formData = vi.fn();

    const response = await POST(requestWithFormData(formData, contentLength));

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(formData).not.toHaveBeenCalled();
  });

  it('reads image dimensions from only the first 64 KiB and uploads the original File once', async () => {
    const file = new File([new Uint8Array(70_000)], 'lesson.png', { type: 'image/png' });
    const prefix = new Blob(['png']);
    const readPrefix = vi.spyOn(prefix, 'arrayBuffer');
    const readWholeFile = vi.spyOn(file, 'arrayBuffer');
    const slice = vi.spyOn(file, 'slice').mockReturnValue(prefix);
    const form = new FormData();
    form.set('file', file);

    const response = await POST(requestWithFormData(vi.fn().mockResolvedValue(form), String(file.size + 1024)));

    expect(response.status).toBe(200);
    expect(slice).toHaveBeenCalledWith(0, 65_536);
    expect(readPrefix).toHaveBeenCalledOnce();
    expect(readWholeFile).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(expect.any(String), file, { contentType: 'image/png', upsert: false });
  });

  it('stores an allowlisted image with null dimensions when prefix parsing throws', async () => {
    mocks.imageSize.mockImplementation(() => {
      throw new Error('metadata extends beyond the 64 KiB prefix');
    });

    const response = await POST(requestWithFile(new File(['large metadata prefix'], 'large-exif.png', { type: 'image/png' })));

    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ width: null, height: null }));
  });

  it('returns 403 before parsing when the caller lacks media.upload', async () => {
    mocks.requirePermission.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const formData = vi.fn();

    const response = await POST(requestWithFormData(formData, '1024'));

    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('authenticated media redirect route', () => {
  const maybeSingle = vi.fn();
  const createSignedUrl = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();

  function queryResult(data: unknown, error: unknown = null) {
    const result = { data, error };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue(result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockReturnValue(query);
    return query;
  }

  function resourceDocument(id: string, branchScope: { scope: 'global' } | { scope: 'branches'; branchIds: string[] }, assetId = 'asset_X') {
    return {
      schemaVersion: 1,
      kind: 'resource',
      id,
      languages: ['en'],
      defaultLanguage: 'en',
      title: 'Guide',
      summary: 'Summary',
      resourceType: 'guide',
      branchScope,
      body: { blocks: [{ type: 'paragraph', content: [{ text: 'Read this guide.' }] }] },
      attachments: [{ src: { assetId }, label: 'Download' }],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'viewer-1' });
    mocks.getActor.mockResolvedValue({ userId: 'viewer-1', roles: [] });
    mocks.canViewProjectCover.mockResolvedValue(false);
    mocks.canReviewProjectCover.mockResolvedValue(false);
    maybeSingle.mockResolvedValue({ data: { owner_id: 'viewer-1', bucket: 'media', path: 'media/asset_X/file.pdf', mime: 'application/pdf' }, error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null });
    eq.mockReturnValue({ maybeSingle });
    select.mockReturnValue({ eq });
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => table === 'media_assets' ? { select } : queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });
  });

  it('requires an authenticated actor before creating a one-hour signed redirect', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('allows the asset owner with a private non-cacheable one-hour signed redirect', async () => {
    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://storage.example/signed');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(select).toHaveBeenCalledWith('owner_id,bucket,path,mime,ownership_kind,owner_branch_id');
    expect(eq).toHaveBeenCalledWith('id', 'asset_X');
    expect(createSignedUrl).toHaveBeenCalledWith('media/asset_X/file.pdf', 60 * 60);
  });

  it.each([
    ['text/plain', 'work.txt'],
    ['application/json', 'result.json'],
  ])('forces %s assets to download as attachments', async (mime, filename) => {
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'viewer-1', bucket: 'submissions', path: `viewer-1/asset_X/${filename}`, mime },
      error: null,
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(302);
    expect(createSignedUrl).toHaveBeenCalledWith(
      `viewer-1/asset_X/${filename}`,
      60 * 60,
      { download: filename },
    );
  });

  it('does not let broad course.read expose an unrelated asset', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'instructor-1',
      roles: [{ role: 'instructor', branchId: null }],
    });
    maybeSingle.mockResolvedValue({ data: { owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf', ownership_kind: 'central', owner_branch_id: null }, error: null });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['published item source', {
      course_version_items: [{ version_id: 'version-1', source: { blocks: [{ src: { assetId: 'asset_X' } }] } }],
      course_version_item_renders: [],
    }],
    ['localized item render', {
      course_version_items: [],
      course_version_item_renders: [{ version_id: 'version-1', payload: { blocks: [{ src: { assetId: 'asset_X' } }] } }],
    }],
  ])('allows an enrolled learner to read an asset referenced by a %s', async (_label, references) => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf', mime: 'application/pdf',
    });
    const enrollments = queryResult([{ course_version_id: 'version-1' }]);
    const items = queryResult(references.course_version_items);
    const renders = queryResult(references.course_version_item_renders);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({
        media_assets: media,
        enrollments,
        course_version_items: items,
        course_version_item_renders: renders,
      })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(302);
    expect(enrollments.eq).toHaveBeenCalledWith('user_id', 'viewer-1');
    expect(enrollments.in).toHaveBeenCalledWith('status', ['active', 'completed']);
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it.each([
    ['suspended immutable school', true, 'school-a', [{ course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-a' }], 404],
    ['active immutable school despite old suspended profile', true, 'school-a', [{ course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-b' }], 302],
    ['mixed suspended and active grants for the same version', true, 'school-a', [
      { course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-a' },
      { course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-b' },
    ], 302],
    ['historical unknown school', true, 'school-a', [{ course_version_id: 'version-1', branch_scope_known: false, branch_id: 'school-a' }], 302],
    ['historical null school', true, 'school-a', [{ course_version_id: 'version-1', branch_scope_known: true, branch_id: null }], 302],
    ['failed live membership lookup', false, 'school-a', [{ course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-a' }], 503],
  ])('checks course media grants against %s', async (_label, authoritative, profileBranch, grants, status) => {
    mocks.getActor.mockResolvedValue({ userId: 'viewer-1', roles: [], ...(authoritative ? {
      authorization: { source: 'database', accountStatus: 'active', assignments: [], memberships: [
        { branchId: 'school-a', status: 'suspended' }, { branchId: 'school-b', status: 'active' },
      ] },
    } : {}) });
    const enrollments = queryResult(grants);
    const profile = queryResult({ branch_id: profileBranch });
    const membership = queryResult(null, new Error('membership unavailable'));
    const from = vi.fn((table: string) => ({
      media_assets: queryResult({ owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf' }),
      enrollments, profiles: profile, branch_memberships: membership,
      course_version_items: queryResult([{ version_id: 'version-1', source: { assetId: 'asset_X' } }]),
    })[table] ?? queryResult([]));
    mocks.supabaseService.mockReturnValue({ from, storage: { from: vi.fn(() => ({ createSignedUrl })) } });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(status);
    expect(enrollments.select).toHaveBeenCalledWith('course_version_id,branch_id,branch_scope_known');
    if (status === 302) expect(createSignedUrl).toHaveBeenCalledOnce();
    else expect(createSignedUrl).not.toHaveBeenCalled();
    if (authoritative) expect(membership.select).not.toHaveBeenCalled();
  });

  it('allows an independent resource grant after excluding a suspended course grant', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'viewer-1', roles: [], authorization: {
      source: 'database', accountStatus: 'active', assignments: [],
      memberships: [{ branchId: 'school-a', status: 'suspended' }],
    } });
    const from = vi.fn((table: string) => ({
      media_assets: queryResult({ owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf' }),
      enrollments: queryResult([{ course_version_id: 'version-1', branch_scope_known: true, branch_id: 'school-a' }]),
      profiles: queryResult({ branch_id: 'school-a' }),
      resources: queryResult([{ id: 'guide', status: 'published', branch_scope: { scope: 'global' }, document: resourceDocument('guide', { scope: 'global' }) }]),
    })[table] ?? queryResult([]));
    mocks.supabaseService.mockReturnValue({ from, storage: { from: vi.fn(() => ({ createSignedUrl })) } });
    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });
    expect(response.status).toBe(302);
    expect(createSignedUrl).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalledWith('course_version_items');
  });

  it('hides a referenced course asset from a learner without an active enrollment', async () => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf', mime: 'application/pdf',
    });
    const enrollments = queryResult([]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, enrollments })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('hides an asset referenced only by a course version outside the learner enrollment', async () => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf', mime: 'application/pdf',
    });
    const enrollments = queryResult([{ course_version_id: 'version-enrolled' }]);
    const items = queryResult([{
      version_id: 'version-other', source: { blocks: [{ src: { assetId: 'asset_X' } }] },
    }]);
    const renders = queryResult([]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({
        media_assets: media,
        enrollments,
        course_version_items: items,
        course_version_item_renders: renders,
      })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('continues authorization scans beyond the first database result page', async () => {
    const firstEnrollmentPage = Array.from({ length: 500 }, (_, index) => ({
      course_version_id: `version-${index}`,
    }));
    const calls: Array<{ table: string; ranges: number[]; versions: string[] }> = [];
    const from = vi.fn((table: string) => {
      if (table === 'media_assets') return queryResult({
        owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf', mime: 'application/pdf',
      });
      const state = { table, ranges: [] as number[], versions: [] as string[] };
      calls.push(state);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn((column: string, values: string[]) => {
          if (column === 'course_version_id' || column === 'version_id') state.versions = values;
          return query;
        }),
        order: vi.fn(() => query),
        range: vi.fn((fromIndex: number, toIndex: number) => {
          state.ranges = [fromIndex, toIndex];
          return query;
        }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
          let data: unknown = [];
          if (table === 'enrollments') {
            data = state.ranges[0] === 500
              ? [{ course_version_id: 'version-target' }]
              : firstEnrollmentPage;
          } else if (table === 'course_version_items' && state.versions.includes('version-target')) {
            data = [{ version_id: 'version-target', source: { src: { assetId: 'asset_X' } } }];
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    });
    mocks.supabaseService.mockReturnValue({
      from,
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(302);
    expect(calls.some(({ table, ranges }) => table === 'enrollments' && ranges[0] === 500)).toBe(true);
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it('does not let media.upload expose another learner submission asset', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'editor-1',
      roles: [{ role: 'editor', branchId: null }],
    });
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'owner-1', bucket: 'submissions', path: 'owner-1/asset_X/work.pdf' },
      error: null,
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('keeps submission files with their historical school after a learner transfers', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'instructor-1',
      roles: [{ role: 'instructor', branchId: 'vinsmc' }],
    });
    const media = queryResult({
      owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/asset_X/work.pdf',
    });
    const files = queryResult([{ submission_id: 'submission-1', user_id: 'learner-1' }]);
    const profile = queryResult({ branch_id: 'ans' });
    const submissions = queryResult([{id:'submission-1',user_id:'learner-1',branch_id:'vinsmc',branch_scope_known:true}]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, submission_files: files, profiles: profile, assignment_submissions: submissions })[table]),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(302);
    expect(files.eq).toHaveBeenCalledWith('asset_id', 'asset_X');
    expect(profile.eq).not.toHaveBeenCalled();
    expect(submissions.in).toHaveBeenCalledWith('id', ['submission-1']);
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it('hides a linked submission asset from an instructor in another branch', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'instructor-1',
      roles: [{ role: 'instructor', branchId: 'vinsmc' }],
    });
    const media = queryResult({
      owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/asset_X/work.pdf',
    });
    const files = queryResult([{ submission_id: 'submission-1', user_id: 'learner-1' }]);
    const profile = queryResult({ branch_id: 'vinsmc' });
    const submissions = queryResult([{id:'submission-1',user_id:'learner-1',branch_id:'ans',branch_scope_known:true}]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, submission_files: files, profiles: profile, assignment_submissions: submissions })[table]),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('allows a learner to read the cover of a project visible to their branch', async () => {
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/cover.png', mime: 'image/png' },
      error: null,
    });
    mocks.canViewProjectCover.mockResolvedValue(true);

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(302);
    expect(mocks.canViewProjectCover).toHaveBeenCalledWith('viewer-1', 'asset_X');
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it('allows a scoped project reviewer to read a learner-uploaded proposal cover', async () => {
    const reviewer = { userId: 'reviewer-1', roles: [] };
    mocks.getActor.mockResolvedValue(reviewer);
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'learner-1', bucket: 'media', path: 'learner-1/project-cover/asset_X/cover.png', mime: 'image/png', ownership_kind: null, owner_branch_id: null },
      error: null,
    });
    mocks.canReviewProjectCover.mockResolvedValue(true);

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(302);
    expect(mocks.canReviewProjectCover).toHaveBeenCalledWith(reviewer, 'asset_X');
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it('hides a learner-uploaded cover from staff outside every covering project scope', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'reviewer-2', roles: [] });
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'learner-1', bucket: 'media', path: 'learner-1/project-cover/asset_X/cover.png', mime: 'image/png', ownership_kind: null, owner_branch_id: null },
      error: null,
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(404);
    expect(mocks.canReviewProjectCover).toHaveBeenCalledOnce();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('allows a learner to read media referenced by a published resource for their exact profile branch', async () => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/guide.pdf', mime: 'application/pdf',
    });
    const profile = queryResult({ branch_id: 'vinsmc' });
    const resources = queryResult([{
      id: 'branch-guide',
      status: 'published',
      branch_scope: { scope: 'branches', branchIds: ['vinsmc'] },
      document: resourceDocument('branch-guide', { scope: 'branches', branchIds: ['vinsmc'] }),
    }]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, profiles: profile, resources })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(302);
    expect(profile.eq).toHaveBeenCalledWith('id', 'viewer-1');
    expect(resources.eq).toHaveBeenCalledWith('status', 'published');
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it.each([
    ['another branch', 'published', { scope: 'branches', branchIds: ['ans'] }],
    ['a draft', 'draft', { scope: 'branches', branchIds: ['vinsmc'] }],
  ])('hides media referenced only by a resource in %s', async (_label, status, branchScope) => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/guide.pdf', mime: 'application/pdf',
    });
    const profile = queryResult({ branch_id: 'vinsmc' });
    const resources = queryResult([{
      id: 'restricted-guide', status, branch_scope: branchScope,
      document: resourceDocument('restricted-guide', branchScope as { scope: 'branches'; branchIds: string[] }),
    }]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, profiles: profile, resources })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('does not let Studio permissions or eligible content references expose another learner certificate asset', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'editor-1',
      roles: [{ role: 'editor', branchId: null }],
    });
    const media = queryResult({
      owner_id: 'certificate-owner', bucket: 'certificates', path: 'certificates/certificate-owner/cert.pdf', mime: 'application/pdf',
    });
    const profile = queryResult({ branch_id: 'vinsmc' });
    const resources = queryResult([{
      id: 'branch-guide', status: 'published', branch_scope: { scope: 'branches', branchIds: ['vinsmc'] },
      document: resourceDocument('branch-guide', { scope: 'branches', branchIds: ['vinsmc'] }),
    }]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, profiles: profile, resources })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.canViewProjectCover).not.toHaveBeenCalled();
    expect(resources.select).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('keeps a certificate asset available to its owner', async () => {
    maybeSingle.mockResolvedValue({
      data: { owner_id: 'viewer-1', bucket: 'certificates', path: 'certificates/viewer-1/cert.pdf', mime: 'application/pdf' },
      error: null,
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(302);
    expect(createSignedUrl).toHaveBeenCalledOnce();
  });

  it.each([
    ['a malformed resource document', 'matching-id', { attachments: [{ src: { assetId: 'asset_X' } }] }],
    ['a document whose id does not match its row', 'row-id', resourceDocument('different-id', { scope: 'global' })],
  ])('does not authorize media referenced by %s', async (_label, rowId, document) => {
    const media = queryResult({
      owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/guide.pdf', mime: 'application/pdf',
    });
    const profile = queryResult({ branch_id: 'vinsmc' });
    const resources = queryResult([{
      id: rowId, status: 'published', branch_scope: { scope: 'global' }, document,
    }]);
    mocks.supabaseService.mockReturnValue({
      from: vi.fn((table: string) => ({ media_assets: media, profiles: profile, resources })[table] ?? queryResult([])),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), {
      params: Promise.resolve({ assetId: 'asset_X' }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 404 without signing for an unrelated learner', async () => {
    maybeSingle.mockResolvedValue({ data: { owner_id: 'owner-1', bucket: 'media', path: 'media/asset_X/file.pdf' }, error: null });

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Media not found' } });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('hides missing media', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const missing = await GET(new Request('http://localhost/api/v1/media/missing'), { params: Promise.resolve({ assetId: 'missing' }) });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Media not found' } });
  });

  it('returns the standard internal error envelope when the media lookup fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'private database error' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(new Request('http://localhost/api/v1/media/asset_X'), { params: Promise.resolve({ assetId: 'asset_X' }) });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Internal error', correlationId: expect.any(String) },
    });
  });
});
