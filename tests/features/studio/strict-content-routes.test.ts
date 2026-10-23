import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level cover for the strict ingress.
 *
 * The editor performs these checks too, but a client that skips the editor — curl, a
 * stale tab, a script — must not get a laxer contract. These tests drive the real
 * route handlers with raw request bytes and assert the rejection happens before the
 * service is ever called.
 */
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  saveWorkspace: vi.fn(),
  saveManifest: vi.fn(),
  saveItem: vi.fn(),
  previewWorkspace: vi.fn(),
  createCourse: vi.fn(),
  publish: vi.fn(),
  importSingle: vi.fn(),
  importNewCourse: vi.fn(),
  validateDraft: vi.fn(),
  bankImportBundle: vi.fn(),
  bankValidate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({
  requirePermission: mocks.requirePermission,
  hasPermission: vi.fn(() => true),
  can: vi.fn(() => true),
}));
vi.mock('@/features/admin/content-review-production', () => ({
  scopedContentContext: async () => ({ context: { actor: { userId: 'user-1', roles: [] }, scope: { kind: 'central' } }, service: {} }),
  typedContentContext: async () => ({ context: { actor: { userId: 'user-1', roles: [] }, scope: { kind: 'central' } }, service: { assignOwnership: vi.fn() } }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { import: {}, validation: {} },
  enforceRateLimit: vi.fn(),
  enforceRequestRateLimit: vi.fn(),
  userRateLimitKey: vi.fn(() => 'key'),
}));
vi.mock('@/features/studio/drafts', async () => {
  const actual = await vi.importActual<typeof import('@/features/studio/drafts')>('@/features/studio/drafts');
  return {
    ...actual,
    saveWorkspace: mocks.saveWorkspace,
    saveManifest: mocks.saveManifest,
    saveItem: mocks.saveItem,
    previewWorkspace: mocks.previewWorkspace,
    createCourse: mocks.createCourse,
    publish: mocks.publish,
    importSingle: mocks.importSingle,
    importNewCourse: mocks.importNewCourse,
    validateDraft: mocks.validateDraft,
  };
});
vi.mock('@/features/bank/service', () => ({
  createBankService: () => ({ importBundle: mocks.bankImportBundle, validate: mocks.bankValidate }),
  actorPermissionCheck: vi.fn(() => vi.fn()),
  bankFiltersFromUrl: vi.fn(() => ({})),
}));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));

import { PUT as saveWorkspaceRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/workspace/route';
import { PUT as saveManifestRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/route';
import { PUT as saveItemRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/items/[itemId]/route';
import { POST as previewRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/preview/route';
import { POST as importRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/import/route';
import { POST as newCourseRoute } from '@/app/api/v1/studio/courses/import/route';
import { POST as validateRoute } from '@/app/api/v1/studio/courses/[courseId]/draft/validate/route';
import { POST as bankCreateRoute } from '@/app/api/v1/studio/bank/route';
import { POST as bankValidateRoute } from '@/app/api/v1/studio/bank/validate/route';
import { POST as createCourseRoute } from '@/app/api/v1/studio/courses/route';
import { POST as publishRoute } from '@/app/api/v1/studio/courses/[courseId]/publish/route';

const actor = { userId: 'user-1', roles: [{ role: 'editor' as const, branchId: null }] };

const post = (url: string, body: string | Uint8Array, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers, body: body as unknown as BodyInit });
const put = (url: string, body: string | Uint8Array, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'PUT', headers, body: body as unknown as BodyInit });

const envelope = async (response: Response) => ({
  status: response.status,
  body: await response.json() as { error?: { code: string; issues?: { code?: string }[] } },
});

const codesOf = (body: { error?: { issues?: { code?: string }[] } }) => (body.error?.issues ?? []).map((issue) => issue.code);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue(actor);
  mocks.saveWorkspace.mockResolvedValue({});
  mocks.saveManifest.mockResolvedValue({});
  mocks.saveItem.mockResolvedValue({});
  mocks.previewWorkspace.mockResolvedValue({ item: null, course: null, report: { ok: true, errors: [], warnings: [] } });
  mocks.importSingle.mockResolvedValue({});
  mocks.importNewCourse.mockResolvedValue({ draft: { courseId: 'c' } });
  mocks.validateDraft.mockResolvedValue({ ok: true, errors: [], warnings: [] });
  mocks.createCourse.mockResolvedValue({ course: { id: 'c1' }, draft: {} });
  mocks.publish.mockResolvedValue({ version: 1 });
  mocks.bankImportBundle.mockResolvedValue([]);
  mocks.bankValidate.mockResolvedValue({ ok: true });
});

const duplicateKeyBody = '{"kind":"course","id":"a","id":"b"}';

describe('every authored-content route rejects a duplicate property', () => {
  const cases: [string, () => Promise<Response>, () => ReturnType<typeof vi.fn>][] = [
    ['workspace save', () => saveWorkspaceRoute(put('http://localhost/ws', duplicateKeyBody, { 'if-match': 'rev' }), { params: { courseId: 'c1' } }), () => mocks.saveWorkspace],
    ['manifest save', () => saveManifestRoute(put('http://localhost/draft', duplicateKeyBody, { 'if-match': 'rev' }), { params: { courseId: 'c1' } }), () => mocks.saveManifest],
    ['item save', () => saveItemRoute(put('http://localhost/item', duplicateKeyBody, { 'if-match': 'rev' }), { params: { courseId: 'c1', itemId: 'i1' } }), () => mocks.saveItem],
    ['preview', () => previewRoute(post('http://localhost/preview', duplicateKeyBody), { params: { courseId: 'c1' } }), () => mocks.previewWorkspace],
    ['course import', () => importRoute(post('http://localhost/import', duplicateKeyBody, { 'content-type': 'application/json' }), { params: { courseId: 'c1' } }), () => mocks.importSingle],
    ['new course import', () => newCourseRoute(post('http://localhost/courses/import', duplicateKeyBody)), () => mocks.importNewCourse],
    ['draft validate', () => validateRoute(post('http://localhost/validate', '{"publish":false,"publish":true}'), { params: { courseId: 'c1' } }), () => mocks.validateDraft],
    ['bank create', () => bankCreateRoute(post('http://localhost/bank', duplicateKeyBody)), () => mocks.bankImportBundle],
    ['bank validate', () => bankValidateRoute(post('http://localhost/bank/validate', duplicateKeyBody)), () => mocks.bankValidate],
    ['course creation', () => createCourseRoute(post('http://localhost/courses', '{"id":"a","id":"b","title":"T"}')), () => mocks.createCourse],
    ['publish', () => publishRoute(post('http://localhost/publish', '{"notes":"a","notes":"b"}', { 'if-match': 'rev' }), { params: { courseId: 'c1' } }), () => mocks.publish],
  ];

  it.each(cases)('%s', async (_label, call, service) => {
    const { status, body } = await envelope(await call());
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_JSON');
    expect(codesOf(body)).toContain('E_JSON_DUPLICATE_KEY');
    // The service never runs: a bypassing client gets no further than the ingress.
    expect(service()).not.toHaveBeenCalled();
  });
});

describe('strict ingress details', () => {
  it('rejects malformed UTF-8 bytes on a content route', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    const { status, body } = await envelope(await saveWorkspaceRoute(put('http://localhost/ws', bytes, { 'if-match': 'rev' }), { params: { courseId: 'c1' } }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_ENCODING');
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
  });

  it('rejects a leading byte order mark rather than silently stripping it', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"kind":"course"}')]);
    const { status, body } = await envelope(await saveManifestRoute(put('http://localhost/draft', bytes, { 'if-match': 'rev' }), { params: { courseId: 'c1' } }));
    expect(status).toBe(400);
    expect(codesOf(body)).toContain('E_JSON_PARSE');
  });

  it('passes a clean body through to the service unchanged', async () => {
    const payload = { manifest: { kind: 'course', id: 'c1' }, items: {} };
    const response = await saveWorkspaceRoute(put('http://localhost/ws', JSON.stringify(payload), { 'if-match': 'rev' }), { params: { courseId: 'c1' } });
    expect(response.status).toBe(200);
    expect(mocks.saveWorkspace).toHaveBeenCalledWith('c1', payload, expect.anything(), 'rev');
  });

  it('lets a workspace envelope exceed one document while a single document may not', async () => {
    const pad = (bytes: number) => 'x'.repeat(bytes);
    const big = JSON.stringify({ manifest: { kind: 'course', id: 'c1', pad: pad(1_100_000) }, items: {} });

    const accepted = await saveWorkspaceRoute(put('http://localhost/ws', big, { 'if-match': 'rev' }), { params: { courseId: 'c1' } });
    expect(accepted.status).toBe(200);

    const refused = await envelope(await saveManifestRoute(put('http://localhost/draft', JSON.stringify({ kind: 'course', id: 'c1', pad: pad(1_100_000) }), { 'if-match': 'rev' }), { params: { courseId: 'c1' } }));
    expect(refused.status).toBe(413);
    expect(refused.body.error?.code).toBe('DOCUMENT_TOO_LARGE');
    expect(codesOf(refused.body)).toContain('E_LIMIT_EXCEEDED');
  });

  it('rejects malformed UTF-8 on the creation and publish routes too', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x69, 0x64, 0x22, 0x3a, 0x22, 0xfe, 0x22, 0x7d]);
    for (const call of [
      () => createCourseRoute(post('http://localhost/courses', bytes)),
      () => publishRoute(post('http://localhost/publish', bytes, { 'if-match': 'rev' }), { params: { courseId: 'c1' } }),
    ]) {
      const { status, body } = await envelope(await call());
      expect(status).toBe(400);
      expect(body.error?.code).toBe('INVALID_ENCODING');
    }
    expect(mocks.createCourse).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('keeps the publish precondition and its error context', async () => {
    const checklist = {
      outcomesReviewed: true, answerKeysVerified: true, accessibilityReviewed: true,
      ageAppropriate: true, linksValid: true, warningsAcknowledged: true,
    };
    const { status, body } = await envelope(await publishRoute(post('http://localhost/publish', JSON.stringify({ checklist })), { params: { courseId: 'c1' } }));
    expect(status).toBe(428);
    expect(body.error?.code).toBe('PRECONDITION_REQUIRED');
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('accepts a validate request with no body at all', async () => {
    const response = await validateRoute(new Request('http://localhost/validate', { method: 'POST' }), { params: { courseId: 'c1' } });
    expect(response.status).toBe(200);
    expect(mocks.validateDraft).toHaveBeenCalledWith('c1', { publish: false });
  });
});
