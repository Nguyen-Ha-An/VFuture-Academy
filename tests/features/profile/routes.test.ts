import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  getPublicProfile: vi.fn(),
  requireApiUser: vi.fn(),
  changeHandle: vi.fn(),
  setProfilePublic: vi.fn(),
  supabaseService: vi.fn(),
  supabaseUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/profile/service', () => ({
  getPublicProfile: mocks.getPublicProfile,
  changeHandle: mocks.changeHandle,
  setProfilePublic: mocks.setProfilePublic,
  PROFILE_HANDLE_PATTERN: /^[a-z0-9][a-z0-9_-]{2,31}$/,
}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseService: mocks.supabaseService,
  supabaseUser: mocks.supabaseUser,
}));

const actor = {
  userId: 'learner-1',
  roles: [],
};
const userClient = { from: vi.fn() };

function rateLimitDatabase(allowed = true) {
  return { rpc: vi.fn().mockResolvedValue({ data: allowed, error: null }) };
}

describe('profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: actor.userId });
    mocks.supabaseService.mockReturnValue(rateLimitDatabase());
    mocks.supabaseUser.mockResolvedValue(userClient);
  });

  it('returns the identical 404 envelope for private and unknown handles', async () => {
    const { GET } = await import('@/app/api/v1/u/[handle]/route');
    mocks.getPublicProfile.mockResolvedValue(null);

    const privateResponse = await GET(new Request('https://academy.example/api/v1/u/private-user'), {
      params: Promise.resolve({ handle: 'private-user' }),
    });
    const unknownResponse = await GET(new Request('https://academy.example/api/v1/u/missing-user'), {
      params: Promise.resolve({ handle: 'missing-user' }),
    });

    expect(privateResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    await expect(privateResponse.json()).resolves.toEqual({
      error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' },
    });
    await expect(unknownResponse.json()).resolves.toEqual({
      error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' },
    });
  });

  it('updates a validated handle for the authenticated learner', async () => {
    const { PATCH } = await import('@/app/api/v1/profile/handle/route');
    mocks.changeHandle.mockResolvedValue({ handle: 'new_handle' });

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/handle', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'new_handle' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.supabaseService).toHaveBeenCalledOnce();
    expect(mocks.changeHandle).toHaveBeenCalledWith(actor, 'new_handle');
  });

  it('updates public visibility for the authenticated learner', async () => {
    const { PATCH } = await import('@/app/api/v1/profile/public/route');
    mocks.setProfilePublic.mockResolvedValue({ profilePublic: true });

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/public', {
      method: 'PATCH',
      body: JSON.stringify({ profilePublic: true }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.setProfilePublic).toHaveBeenCalledWith(actor, true, { client: userClient });
  });

  it('returns 401 before profile mutations when the request is unauthenticated', async () => {
    const { PATCH } = await import('@/app/api/v1/profile/handle/route');
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/handle', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'new_handle' }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    expect(mocks.changeHandle).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid handle', async () => {
    const { PATCH } = await import('@/app/api/v1/profile/handle/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/handle', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'Invalid Handle' }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
    });
    expect(mocks.changeHandle).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-user request limiter is exhausted', async () => {
    const { PATCH } = await import('@/app/api/v1/profile/handle/route');
    mocks.supabaseService.mockReturnValueOnce(rateLimitDatabase(false));

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/handle', {
      method: 'PATCH',
      body: JSON.stringify({ handle: 'new_handle' }),
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many handle requests; try again later' },
    });
    expect(mocks.changeHandle).not.toHaveBeenCalled();
  });

  it('returns a correlated 500 without exposing internal profile errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { GET } = await import('@/app/api/v1/u/[handle]/route');
    mocks.getPublicProfile.mockRejectedValueOnce(new Error('database credentials leaked here'));

    const response = await GET(new Request('https://academy.example/api/v1/u/future_builder'), {
      params: Promise.resolve({ handle: 'future_builder' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL', message: 'Internal error', correlationId: expect.any(String) },
    });
    error.mockRestore();
  });
});
