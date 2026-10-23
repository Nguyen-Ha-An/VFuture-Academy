import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  hasPermission: vi.fn(),
  createCourse: vi.fn(),
  deleteItem: vi.fn(),
  exportVersion: vi.fn(),
  getDraft: vi.fn(),
  getVersionWorkspace: vi.fn(),
  importNewCourse: vi.fn(),
  importBundle: vi.fn(),
  importSingle: vi.fn(),
  listCourses: vi.fn(),
  listVersions: vi.fn(),
  previewItem: vi.fn(),
  previewWorkspace: vi.fn(),
  publish: vi.fn(),
  restoreAsDraft: vi.fn(),
  saveItem: vi.fn(),
  saveManifest: vi.fn(),
  saveWorkspace: vi.fn(),
  validateDraft: vi.fn(),
  productionBundleImportHooks: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission, hasPermission: mocks.hasPermission, can: mocks.hasPermission }));
vi.mock('@/features/admin/context', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  contentReviewContext: async (_request: Request, permission: string) => {
    const legacy = permission === 'content.create' ? 'course.create' : permission === 'content.read' ? 'course.read' : permission;
    const resolved = await mocks.requirePermission(legacy);
    return { context: { actor: resolved, scope: { kind: 'central' } }, service: { assignOwnership: vi.fn() } };
  },
  scopedContentContext: async (_request: Request, _type: string, _id: string, _workflow: string, legacy: string) => {
    const resolved = await mocks.requirePermission(legacy);
    return { context: { actor: resolved, scope: { kind: 'central' } }, service: {} };
  },
  typedContentContext: async (_request: Request, _workflow: string, legacy: string) => {
    const resolved = await mocks.requirePermission(legacy);
    return { context: { actor: resolved, scope: { kind: 'central' } }, service: { assignOwnership: vi.fn() } };
  },
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { import: {}, validation: {} },
  enforceRateLimit: vi.fn(),
  userRateLimitKey: vi.fn(() => 'test-rate-limit-key'),
}));
vi.mock('@/features/studio/drafts', async () => {
  const { z } = await import('zod');
  return {
    PublishInputSchema: z.object({
      checklist: z.object({
        outcomesReviewed: z.literal(true),
        answerKeysVerified: z.literal(true),
        accessibilityReviewed: z.literal(true),
        ageAppropriate: z.literal(true),
        linksValid: z.literal(true),
        warningsAcknowledged: z.literal(true),
      }).strict(),
      notes: z.string().max(4_000).nullable().optional(),
    }).strict(),
    NewCourseImportInputSchema: z.object({ text: z.string() }).strict(),
    createCourse: mocks.createCourse,
    deleteItem: mocks.deleteItem,
    exportVersion: mocks.exportVersion,
    getDraft: mocks.getDraft,
    getVersionWorkspace: mocks.getVersionWorkspace,
    importNewCourse: mocks.importNewCourse,
    importBundle: mocks.importBundle,
    importSingle: mocks.importSingle,
    listCourses: mocks.listCourses,
    listVersions: mocks.listVersions,
    previewItem: mocks.previewItem,
    previewWorkspace: mocks.previewWorkspace,
    publish: mocks.publish,
    restoreAsDraft: mocks.restoreAsDraft,
    saveItem: mocks.saveItem,
    saveManifest: mocks.saveManifest,
    saveWorkspace: mocks.saveWorkspace,
    validateDraft: mocks.validateDraft,
  };
});
vi.mock('@/features/studio/import-hooks', () => ({
  productionBundleImportHooks: mocks.productionBundleImportHooks,
}));

import { POST as createCourseRoute } from '@/app/api/v1/studio/courses/route';
import { POST as importNewCourseRoute } from '@/app/api/v1/studio/courses/import/route';
import { GET as getDraftRoute, PUT as saveManifestRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/route';
import { POST as previewWorkspaceRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/preview/route';
import { PUT as saveWorkspaceRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/workspace/route';
import { POST as importRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/import/route';
import { DELETE as deleteItemRoute, PUT as saveItemRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/items/[itemId]/route';
import { POST as previewRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/preview/[itemId]/route';
import { POST as validateRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/validate/route';
import { GET as exportRoute } from '@/app/api/v1/studio/courses/[courseId]/export/route';
import { POST as publishRoute } from '@/app/api/v1/studio/courses/[courseId]/publish/route';
import { POST as restoreRoute } from '@/app/api/v1/studio/courses/[courseId]/versions/[v]/restore/route';
import { GET as versionsRoute } from '@/app/api/v1/studio/courses/[courseId]/versions/route';
import { GET as versionWorkspaceRoute } from '@/app/api/v1/studio/courses/[courseId]/versions/[v]/route';
import { GET as promptPackRoute } from '@/app/api/v1/studio/prompt-pack/route';

const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [] };
const checklist = {
  outcomesReviewed: true,
  answerKeysVerified: true,
  accessibilityReviewed: true,
  ageAppropriate: true,
  linksValid: true,
  warningsAcknowledged: true,
};
const limit = 2 * 1024 * 1024;

function request(url: string, method: string, body?: BodyInit, headers?: HeadersInit): Request {
  return new Request(url, { method, body, headers });
}

function streamedRequest(url: string, chunkCount: number, chunkSize: number, headers?: HeadersInit): Request {
  let emitted = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted++ < chunkCount) controller.enqueue(new Uint8Array(chunkSize));
      else controller.close();
    },
  });
  return new Request(url, {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function expectStatus(response: Promise<Response>, status: number) {
  const resolved = await response;
  expect(resolved.status).toBe(status);
  return resolved;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue(actor);
  mocks.productionBundleImportHooks.mockReturnValue({ importQuestions: vi.fn(), uploadMedia: vi.fn() });
  for (const mock of Object.values(mocks)) {
    if (mock !== mocks.requirePermission) mock.mockResolvedValue({});
  }
  mocks.hasPermission.mockReturnValue(false);
  mocks.exportVersion.mockResolvedValue({
    body: '{}',
    checksum: 'checksum',
    contentType: 'application/json; charset=utf-8',
    filename: 'course-1-v1.json',
  });
});

describe('Studio route request body limits', () => {
  const cases = [
    ['course create', createCourseRoute, 'http://localhost/api/v1/studio/courses', undefined],
    ['draft manifest', saveManifestRoute, 'http://localhost/api/v1/studio/courses/course-1/draft', { params: { courseId: 'course-1' } }],
    ['draft item', saveItemRoute, 'http://localhost/api/v1/studio/courses/course-1/draft/items/item-1', { params: { courseId: 'course-1', itemId: 'item-1' } }],
    ['publish', publishRoute, 'http://localhost/api/v1/studio/courses/course-1/publish', { params: { courseId: 'course-1' } }],
    ['validate', validateRoute, 'http://localhost/api/v1/studio/courses/course-1/draft/validate', { params: { courseId: 'course-1' } }],
    ['single import', importRoute, 'http://localhost/api/v1/studio/courses/course-1/draft/import', { params: { courseId: 'course-1' } }],
  ] as const;

  it.each(cases)('rejects oversized JSON on %s', async (_name, handler, url, context) => {
    const response = await expectStatus(handler(
      request(url, 'POST', '{}', { 'content-type': 'application/json', 'content-length': String(limit + 1) }),
      context,
    ), 413);

    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('rejects a chunked JSON body without Content-Length after it crosses the cap', async () => {
    const response = await expectStatus(createCourseRoute(
      streamedRequest('http://localhost/api/v1/studio/courses', 3, 1024 * 1024, { 'content-type': 'application/json' }),
    ), 413);

    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(mocks.createCourse).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['non-numeric', 'unknown'],
  ] as const)('counts an oversized multipart import with %s Content-Length', async (_name, contentLength) => {
    const headers: Record<string, string> = { 'content-type': 'multipart/form-data; boundary=security-test' };
    if (contentLength !== undefined) headers['content-length'] = contentLength;
    const response = await expectStatus(importRoute(
      streamedRequest('http://localhost/api/v1/studio/courses/course-1/draft/import', 51, 1024 * 1024, headers),
      { params: { courseId: 'course-1' } },
    ), 413);

    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(mocks.importBundle).not.toHaveBeenCalled();
  });
});

describe('Studio course creation validation wiring', () => {
  it('accepts a one-character id and default-language-only title before calling the service', async () => {
    await createCourseRoute(request(
      'http://localhost/api/v1/studio/courses',
      'POST',
      JSON.stringify({
        id: 'a',
        title: { vi: 'Khoá học' },
        languages: ['vi'],
        defaultLanguage: 'vi',
        pathway: 'core-future-skills',
        level: 'foundation',
      }),
      { 'content-type': 'application/json' },
    ));

    expect(mocks.createCourse).toHaveBeenCalledWith({
      id: 'a',
      title: { vi: 'Khoá học' },
      languages: ['vi'],
      defaultLanguage: 'vi',
      pathway: 'core-future-skills',
      level: 'foundation',
    }, actor);
  });
});

describe('Plan 2 shared route rate limits', () => {
  it.each([
    'courses/[courseId]/draft/import/route.ts',
    'courses/[courseId]/draft/validate/route.ts',
    'bank/route.ts',
    'bank/validate/route.ts',
    'media/route.ts',
  ])('enforces a PostgreSQL rate limit in Studio %s', (relativePath) => {
    const source = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'v1', 'studio', ...relativePath.split('/')), 'utf8');
    expect(source).toMatch(/enforce(?:Request)?RateLimit\s*\(/);
  });

  it.each([
    'src/app/api/v1/uploads/route.ts',
    'src/app/api/v1/analytics/route.ts',
    'src/app/api/v1/schema/validate/route.ts',
  ])('enforces a PostgreSQL rate limit in %s', (relativePath) => {
    const source = readFileSync(join(process.cwd(), ...relativePath.split('/')), 'utf8');
    expect(source).toMatch(/enforce(?:Request)?RateLimit\s*\(/);
  });
});

describe('Studio bundle import wiring', () => {
  it('passes the production bank and media hooks into a bundle import', async () => {
    const hooks = { importQuestions: vi.fn(), uploadMedia: vi.fn() };
    mocks.productionBundleImportHooks.mockReturnValue(hooks);
    const form = new FormData();
    form.set('mode', 'bundle');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'course.zip', { type: 'application/zip' }));

    const response = await importRoute(
      new Request('http://localhost/api/v1/studio/courses/course-1/draft/import', { method: 'POST', body: form }),
      { params: { courseId: 'course-1' } },
    );

    expect(response.status).toBe(200);
    expect(mocks.productionBundleImportHooks).toHaveBeenCalledWith(actor);
    expect(mocks.importBundle).toHaveBeenCalledWith('course-1', expect.any(ArrayBuffer), actor, hooks);
  });

  it('passes the flushed If-Match token to bundle replacement', async () => {
    const hooks = { importQuestions: vi.fn(), uploadMedia: vi.fn() };
    mocks.productionBundleImportHooks.mockReturnValue(hooks);
    const form = new FormData();
    form.set('mode', 'bundle');
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'course.zip', { type: 'application/zip' }));
    const token = '2026-09-02T00:00:00.000Z';

    await importRoute(
      new Request('http://localhost/api/v1/studio/courses/course-1/draft/import', {
        method: 'POST',
        headers: { 'if-match': token },
        body: form,
      }),
      { params: { courseId: 'course-1' } },
    );

    expect(mocks.importBundle).toHaveBeenCalledWith('course-1', expect.any(ArrayBuffer), actor, hooks, undefined, token);
  });

  it('passes the flushed If-Match token to whole-course replacement', async () => {
    const token = '2026-09-02T00:00:00.000Z';
    await importRoute(
      request(
        'http://localhost/api/v1/studio/courses/course-1/draft/import',
        'POST',
        JSON.stringify({ mode: 'single', text: '{}' }),
        { 'content-type': 'application/json', 'if-match': token },
      ),
      { params: { courseId: 'course-1' } },
    );

    expect(mocks.importSingle).toHaveBeenCalledWith('course-1', '{}', actor, undefined, token);
  });
});

describe('Studio draft optimistic concurrency wiring', () => {
  it('passes the required workspace revision and complete payload to one save call', async () => {
    const token = '2026-09-02T00:00:00.000Z';
    const body = { manifest: {}, items: {} };
    await saveWorkspaceRoute(request('http://localhost/workspace', 'PUT', JSON.stringify(body), {
      'content-type': 'application/json', 'if-match': token,
    }), { params: { courseId: 'course-1' } });

    expect(mocks.saveWorkspace).toHaveBeenCalledWith('course-1', body, actor, token);
  });

  it('passes the manifest If-Match token to the draft service', async () => {
    const token = '2026-09-02T00:00:00.000Z';

    await saveManifestRoute(
      request('http://localhost/draft', 'PUT', '{}', { 'content-type': 'application/json', 'if-match': token }),
      { params: { courseId: 'course-1' } },
    );

    expect(mocks.saveManifest).toHaveBeenCalledWith('course-1', {}, actor, token);
  });

  it('passes the item If-Match token to the draft service', async () => {
    const token = '2026-09-02T00:00:00.000Z';

    await saveItemRoute(
      request('http://localhost/item', 'PUT', '{}', { 'content-type': 'application/json', 'if-match': token }),
      { params: { courseId: 'course-1', itemId: 'item-1' } },
    );

    expect(mocks.saveItem).toHaveBeenCalledWith('course-1', 'item-1', {}, actor, token);
  });

  it('passes no manifest precondition when If-Match is absent', async () => {
    await saveManifestRoute(
      request('http://localhost/draft', 'PUT', '{}', { 'content-type': 'application/json' }),
      { params: { courseId: 'course-1' } },
    );

    expect(mocks.saveManifest).toHaveBeenCalledWith('course-1', {}, actor, undefined);
  });

  it('passes no item precondition when If-Match is absent', async () => {
    await saveItemRoute(
      request('http://localhost/item', 'PUT', '{}', { 'content-type': 'application/json' }),
      { params: { courseId: 'course-1', itemId: 'item-1' } },
    );

    expect(mocks.saveItem).toHaveBeenCalledWith('course-1', 'item-1', {}, actor, undefined);
  });
});

describe('simplified Studio route wiring', () => {
  it('uses course.read and strips grading unless the actor also has course.edit', async () => {
    const body = { manifest: {}, items: {}, selectedDocId: 'manifest', locale: 'vi' };
    await previewWorkspaceRoute(request('http://localhost/preview', 'POST', JSON.stringify(body), {
      'content-type': 'application/json',
    }), { params: { courseId: 'course-1' } });

    expect(mocks.requirePermission).toHaveBeenCalledWith('course.read');
    expect(mocks.hasPermission).toHaveBeenCalledWith(actor, 'course.edit', { kind: 'central' });
    expect(mocks.previewWorkspace).toHaveBeenCalledWith('course-1', body, false);
  });

  it('creates an imported course under course.create permission', async () => {
    await importNewCourseRoute(request('http://localhost/import', 'POST', JSON.stringify({ text: '{}' }), {
      'content-type': 'application/json',
    }));
    expect(mocks.requirePermission).toHaveBeenCalledWith('course.create');
    expect(mocks.importNewCourse).toHaveBeenCalledWith('{}', actor);
  });

  it('returns one immutable source workspace under course.read permission', async () => {
    await versionWorkspaceRoute(request('http://localhost/version', 'GET'), {
      params: { courseId: 'course-1', v: '2' },
    });
    expect(mocks.requirePermission).toHaveBeenCalledWith('course.read');
    expect(mocks.getVersionWorkspace).toHaveBeenCalledWith('course-1', 2);
  });

  it('passes the required publish revision to the guarded publisher', async () => {
    const token = '2026-09-02T00:00:00.000Z';
    await publishRoute(request('http://localhost/publish', 'POST', JSON.stringify({ checklist }), {
      'content-type': 'application/json', 'if-match': token,
    }), { params: { courseId: 'course-1' } });
    expect(mocks.publish).toHaveBeenCalledWith('course-1', { checklist }, actor, undefined, token);
  });

  it('rejects publish without If-Match before calling the service', async () => {
    const response = await publishRoute(request('http://localhost/publish', 'POST', JSON.stringify({ checklist }), {
      'content-type': 'application/json',
    }), { params: { courseId: 'course-1' } });

    expect(response.status).toBe(428);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

describe('Studio read-only validation wiring', () => {
  it('allows a course reader to validate without course.edit', async () => {
    await validateRoute(request('http://localhost/validate', 'POST', '{}'), {
      params: { courseId: 'course-1' },
    });

    expect(mocks.requirePermission).toHaveBeenCalledWith('course.read');
  });
});

describe('Studio route identifier validation', () => {
  const invalidCourseCases = [
    ['draft', getDraftRoute, request('http://localhost/draft', 'GET'), { params: { courseId: 'Bad_ID' } }],
    ['draft item', deleteItemRoute, request('http://localhost/item', 'DELETE'), { params: { courseId: 'Bad_ID', itemId: 'item-1' } }],
    ['import', importRoute, request('http://localhost/import', 'POST', JSON.stringify({ mode: 'single', text: '{}' }), { 'content-type': 'application/json' }), { params: { courseId: 'Bad_ID' } }],
    ['validate', validateRoute, request('http://localhost/validate', 'POST', '{}'), { params: { courseId: 'Bad_ID' } }],
    ['preview', previewRoute, request('http://localhost/preview?locale=vi', 'POST'), { params: { courseId: 'Bad_ID', itemId: 'item-1' } }],
    ['publish', publishRoute, request('http://localhost/publish', 'POST', JSON.stringify({ checklist })), { params: { courseId: 'Bad_ID' } }],
    ['versions', versionsRoute, request('http://localhost/versions', 'GET'), { params: { courseId: 'Bad_ID' } }],
    ['restore', restoreRoute, request('http://localhost/restore', 'POST'), { params: { courseId: 'Bad_ID', v: '1' } }],
    ['export', exportRoute, request('http://localhost/export?version=1&format=single', 'GET'), { params: { courseId: 'Bad_ID' } }],
  ] as const;

  it.each(invalidCourseCases)('rejects a non-kebab courseId on %s', async (_name, handler, routeRequest, context) => {
    await expectStatus(handler(routeRequest, context), 400);
  });

  it.each([
    ['item save', saveItemRoute, request('http://localhost/item', 'PUT', '{}'), { params: { courseId: 'course-1', itemId: 'Bad_ID' } }],
    ['preview', previewRoute, request('http://localhost/preview?locale=vi', 'POST'), { params: { courseId: 'course-1', itemId: 'Bad_ID' } }],
  ] as const)('rejects a non-kebab itemId on %s', async (_name, handler, routeRequest, context) => {
    await expectStatus(handler(routeRequest, context), 400);
  });

  it.each(['0', '-1', '1.5', 'nope'])('rejects restore version %s', async (version) => {
    await expectStatus(restoreRoute(request('http://localhost/restore', 'POST'), {
      params: { courseId: 'course-1', v: version },
    }), 400);
  });

  it('validates prompt-pack courseId and optional itemId with IdSchema', async () => {
    await expectStatus(promptPackRoute(request(
      'http://localhost/prompt-pack?courseId=course-1&kind=lesson&itemId=Bad_ID',
      'GET',
    )), 400);
    await expectStatus(promptPackRoute(request(
      'http://localhost/prompt-pack?courseId=Bad_ID&kind=outline',
      'GET',
    )), 400);
  });
});
