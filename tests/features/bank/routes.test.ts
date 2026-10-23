import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => {
  const service = {
    list: vi.fn(),
    importBundle: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    usages: vi.fn(),
    validate: vi.fn(),
  };
  return {
    requirePermission: vi.fn(),
    actorPermissionCheck: vi.fn((actor) => async () => actor),
    createBankService: vi.fn(() => service),
    service,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { import: {}, validation: {} },
  enforceRateLimit: vi.fn(),
  userRateLimitKey: vi.fn(() => 'test-rate-limit-key'),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/features/admin/context', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentContext: async (_request: Request, _permission: string, legacy: string) => {
    const actor = await mocks.requirePermission(legacy);
    return { context: { actor, scope: { kind: 'central' } }, service: { assignOwnership: vi.fn() } };
  },
}));
vi.mock('@/features/bank/service', () => ({
  actorPermissionCheck: mocks.actorPermissionCheck,
  createBankService: mocks.createBankService,
}));

import { GET as listBank, POST as importBank } from '@/app/api/v1/studio/bank/route';
import { GET as getQuestion, PUT as updateQuestion } from '@/app/api/v1/studio/bank/[questionId]/route';
import { POST as publishQuestion } from '@/app/api/v1/studio/bank/[questionId]/publish/route';
import { GET as getQuestionUsages } from '@/app/api/v1/studio/bank/[questionId]/usages/route';
import { POST as validateQuestion } from '@/app/api/v1/studio/bank/validate/route';

const context = { params: Promise.resolve({ questionId: 'bank-question' }) };

describe('question bank routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
  });

  it.each([
    ['list', 'bank.edit', () => listBank(new Request('http://localhost/api/v1/studio/bank'))],
    ['import', 'bank.edit', () => importBank(new Request('http://localhost/api/v1/studio/bank', { method: 'POST', body: '{}' }))],
    ['detail', 'bank.edit', () => getQuestion(new Request('http://localhost/api/v1/studio/bank/bank-question'), context)],
    ['update', 'bank.edit', () => updateQuestion(new Request('http://localhost/api/v1/studio/bank/bank-question', { method: 'PUT', body: '{}' }), context)],
    ['publish', 'bank.publish', () => publishQuestion(new Request('http://localhost/api/v1/studio/bank/bank-question/publish', { method: 'POST' }), context)],
    ['usages', 'bank.edit', () => getQuestionUsages(new Request('http://localhost/api/v1/studio/bank/bank-question/usages'), context)],
    ['validate', 'bank.edit', () => validateQuestion(new Request('http://localhost/api/v1/studio/bank/validate', { method: 'POST', body: '{}' }))],
  ] as const)('returns 403 before database access for denied %s requests', async (_name, permission, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: { code: 'FORBIDDEN', message: 'Permission denied' } });
    expect(mocks.requirePermission).toHaveBeenCalledWith(permission);
    expect(mocks.createBankService).not.toHaveBeenCalled();
  });

  it('returns question usages to an actor with bank.edit', async () => {
    const actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };
    const usages = [{ versionId: 'version-1', itemId: 'lesson-1', courseId: 'course-1' }];
    mocks.requirePermission.mockResolvedValueOnce(actor);
    mocks.service.usages.mockResolvedValueOnce(usages);

    const response = await getQuestionUsages(
      new Request('http://localhost/api/v1/studio/bank/bank-question/usages'),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: usages });
    expect(mocks.requirePermission).toHaveBeenCalledWith('bank.edit');
    expect(mocks.actorPermissionCheck).toHaveBeenCalledWith(actor, { kind: 'central' });
    expect(mocks.service.usages).toHaveBeenCalledWith('bank-question');
  });

  it.each([
    ['import', (body: BodyInit, headers?: HeadersInit) => importBank(new Request('http://localhost/api/v1/studio/bank', { method: 'POST', body, headers })), mocks.service.importBundle],
    ['update', (body: BodyInit, headers?: HeadersInit) => updateQuestion(new Request('http://localhost/api/v1/studio/bank/bank-question', { method: 'PUT', body, headers }), context), mocks.service.update],
  ] as const)('rejects oversized JSON before the %s bank write service', async (_name, invoke, serviceWrite) => {
    mocks.requirePermission.mockResolvedValueOnce({
      userId: 'editor-1',
      roles: [{ role: 'editor', branchId: null }],
    });

    const response = await invoke('{}', { 'content-length': String(2 * 1024 * 1024 + 1) });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(serviceWrite).not.toHaveBeenCalled();
  });

  it.each([
    ['import', (body: BodyInit) => importBank(new Request('http://localhost/api/v1/studio/bank', { method: 'POST', body })), mocks.service.importBundle],
    ['update', (body: BodyInit) => updateQuestion(new Request('http://localhost/api/v1/studio/bank/bank-question', { method: 'PUT', body }), context), mocks.service.update],
  ] as const)('rejects deeply nested JSON before the %s bank write service', async (_name, invoke, serviceWrite) => {
    mocks.requirePermission.mockResolvedValueOnce({
      userId: 'editor-1',
      roles: [{ role: 'editor', branchId: null }],
    });
    const body = '['.repeat(65) + '0' + ']'.repeat(65);

    const response = await invoke(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'JSON_NESTING_TOO_DEEP' } });
    expect(serviceWrite).not.toHaveBeenCalled();
  });

  it('validates a question without invoking the version update path', async () => {
    const actor = { userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] };
    const question = { id: 'bank-question', type: 'true_false', correctAnswer: true };
    mocks.requirePermission.mockResolvedValueOnce(actor);
    mocks.service.validate.mockResolvedValueOnce({ valid: true });

    const response = await validateQuestion(new Request('http://localhost/api/v1/studio/bank/validate', {
      method: 'POST',
      body: JSON.stringify(question),
    }));

    expect(response.status).toBe(200);
    expect(mocks.service.validate).toHaveBeenCalledWith(question);
    expect(mocks.service.update).not.toHaveBeenCalled();
  });
});
