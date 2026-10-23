import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURES } from '@/content-engine/fixtures';

const mocks = vi.hoisted(() => ({
  enforceRequestRateLimit: vi.fn(),
  rpc: vi.fn(),
  supabaseService: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { validation: { limit: 60, windowSeconds: 60 } },
  enforceRequestRateLimit: mocks.enforceRequestRateLimit,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/content-engine/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content-engine/validate')>();
  return {
    ...actual,
    validateStandaloneDocument: vi.fn(actual.validateStandaloneDocument),
    validateWorkspace: vi.fn(actual.validateWorkspace),
  };
});

import { GET as getSchema } from '@/app/api/v1/schema/v1/[kind]/route';
import { GET as getManifest } from '@/app/api/v1/schema/manifest/route';
import { POST as validateDocuments } from '@/app/api/v1/schema/validate/route';
import { validateStandaloneDocument, validateWorkspace } from '@/content-engine/validate';

describe('public schema API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceRequestRateLimit.mockResolvedValue(undefined);
    mocks.supabaseService.mockReturnValue({ rpc: mocks.rpc });
  });

  it('serves only exported v1 JSON schemas', async () => {
    const response = await getSchema(
      new Request('https://academy.example/api/v1/schema/v1/course.json'),
      { params: Promise.resolve({ kind: 'course.json' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/schema+json');
    await expect(response.json()).resolves.toMatchObject({ title: expect.any(String) });

    const missing = await getSchema(
      new Request('https://academy.example/api/v1/schema/v1/secret.json'),
      { params: Promise.resolve({ kind: 'secret.json' }) },
    );
    expect(missing.status).toBe(404);
  });

  it('publishes the block and player manifests without an API envelope', async () => {
    const response = await getManifest(new Request('https://academy.example/api/v1/schema/manifest'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.blocks.length).toBeGreaterThan(0);
    expect(body.players.length).toBeGreaterThan(0);
    expect(body.data).toBeUndefined();
  });

  it('validates course documents without querying content reference tables', async () => {
    const fixture = FIXTURES.minimal;
    const manifest = { ...(fixture.manifest as Record<string, unknown>), relatedOpportunities: [] };
    const response = await validateDocuments(new Request('https://academy.example/api/v1/schema/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: [manifest, ...Object.values(fixture.items)] }),
    }));
    const report = await response.json();

    expect(response.status).toBe(200);
    expect(report).toMatchObject({ ok: true, errors: [], summary: { items: { lesson: 1 } } });
    expect(mocks.enforceRequestRateLimit).toHaveBeenCalledWith(
      { rpc: mocks.rpc },
      'schema:validate',
      expect.any(Request),
      { limit: 60, windowSeconds: 60 },
    );
  });

  it('rejects more than 50 documents before invoking content validation', async () => {
    const response = await validateDocuments(new Request('https://academy.example/api/v1/schema/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: Array.from({ length: 51 }, () => ({})) }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(validateStandaloneDocument).not.toHaveBeenCalled();
    expect(validateWorkspace).not.toHaveBeenCalled();
  });

  it('enforces the 512 KiB JSON limit before invoking content validation', async () => {
    const response = await validateDocuments(new Request('https://academy.example/api/v1/schema/validate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(512 * 1024 + 1),
      },
      body: '{}',
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(validateStandaloneDocument).not.toHaveBeenCalled();
    expect(validateWorkspace).not.toHaveBeenCalled();
  });
});
