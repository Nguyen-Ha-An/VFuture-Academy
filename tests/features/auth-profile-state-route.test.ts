import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  requireApiUser: vi.fn(),
  supabaseUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({
  getSessionUser: mocks.getSessionUser,
  requireApiUser: mocks.requireApiUser,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));

import * as routeModule from '@/app/api/v1/auth/profile-state/route';
import { ApiError } from '@/lib/api';

const { GET } = routeModule;
const URL_BASE = 'https://academy.example/api/v1/auth/profile-state';

type ProfileResult = { data: { handle: string | null } | null; error: unknown };

function profileClient(result: ProfileResult | (() => Promise<ProfileResult>)) {
  const maybeSingle = vi.fn(typeof result === 'function' ? result : async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, eq, maybeSingle };
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSessionUser.mockResolvedValue({ id: 'user-1', email: 'learner@example.com' });
  mocks.requireApiUser.mockResolvedValue({ id: 'user-1', email: 'learner@example.com' });
  mocks.supabaseUser.mockResolvedValue(profileClient({ data: { handle: 'learner' }, error: null }).client);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/auth/profile-state', () => {
  it('exports only GET', () => {
    expect(Object.keys(routeModule).sort()).toEqual(['GET']);
  });

  it('returns a private, uncached 401 envelope without a verified session', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expectPrivateNoStore(response);
    expect(mocks.supabaseUser).not.toHaveBeenCalled();
  });

  it.each([
    ['complete', { handle: 'learner' }],
    ['incomplete', { handle: null }],
  ] as const)('reports the caller own %s state and nothing else', async (state, row) => {
    const { client, from, select, eq } = profileClient({ data: row, error: null });
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ data: { state } });
    expectPrivateNoStore(response);
    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('handle');
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('never leaks the handle or the user identity in the payload', async () => {
    const { client } = profileClient({ data: { handle: 'private_handle' }, error: null });
    mocks.supabaseUser.mockResolvedValue(client);

    const text = await (await GET(new Request(URL_BASE))).text();

    expect(text).not.toContain('private_handle');
    expect(text).not.toContain('user-1');
    expect(text).not.toContain('learner@example.com');
  });

  it('derives the user from the verified session, never from the query, body, or headers', async () => {
    const { client, eq } = profileClient({ data: { handle: 'learner' }, error: null });
    mocks.supabaseUser.mockResolvedValue(client);

    await GET(new Request(`${URL_BASE}?userId=victim&id=victim&user_id=victim`, {
      headers: { 'x-user-id': 'victim', 'x-supabase-user-id': 'victim' },
    }));

    expect(eq).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('returns a private, uncached 403 without reading the profile of a suspended account', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended'));

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: { code: 'ACCOUNT_SUSPENDED', message: 'This account is suspended' } });
    expectPrivateNoStore(response);
    expect(mocks.supabaseUser).not.toHaveBeenCalled();
  });

  it('fails closed with a private generic 500 when the account is not provisioned', async () => {
    mocks.requireApiUser.mockRejectedValue(new Error('Unable to verify account status'));

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: { code: 'INTERNAL', message: 'Internal error', correlationId: expect.any(String) } });
    expectPrivateNoStore(response);
    expect(mocks.supabaseUser).not.toHaveBeenCalled();
  });

  it.each([
    ['a read error', { data: null, error: new Error('RLS denied') }],
    ['a missing row', { data: null, error: null }],
  ] as const)('reports unavailable (200) for %s, mirroring the previous semantics', async (_case, result) => {
    mocks.supabaseUser.mockResolvedValue(profileClient(result).client);

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ data: { state: 'unavailable' } });
    expectPrivateNoStore(response);
  });

  it('returns a generic private 500 when session verification throws unexpectedly', async () => {
    mocks.requireApiUser.mockRejectedValue(new Error('Unable to authenticate user token=super-secret'));

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(500);
    const payload = await body(response);
    expect(payload).toEqual({ error: { code: 'INTERNAL', message: 'Internal error', correlationId: expect.any(String) } });
    expect(JSON.stringify(payload)).not.toContain('super-secret');
    expectPrivateNoStore(response);
  });

  it('returns a generic private 500 when the profile query throws', async () => {
    mocks.supabaseUser.mockResolvedValue(profileClient(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
    }).client);

    const response = await GET(new Request(URL_BASE));

    expect(response.status).toBe(500);
    const text = JSON.stringify(await body(response));
    expect(text).not.toContain('ECONNREFUSED');
    expect(text).not.toContain('hunter2');
    expectPrivateNoStore(response);
  });
});
