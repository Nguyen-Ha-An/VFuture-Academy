import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
  supabaseUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://academy.example' } }));

import { getSessionUser, requireApiUser, requireUser } from '@/lib/auth';
import { GET as callback } from '@/app/auth/callback/route';
import { profileState } from '@/lib/profile-state';

function authClient({
  user = { id: 'user-1' } as { id: string } | null,
  exchangeError = null as unknown,
  profile = { data: { handle: 'learner' }, error: null } as { data: { handle: string | null } | null; error: unknown },
} = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: exchangeError }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(profile) })),
      })),
    })),
  };
}

describe('server authentication routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers());
  });

  it('preserves the trusted requested path through the page guard', async () => {
    const client = authClient({ user: null });
    mocks.supabaseUser.mockResolvedValue(client);
    mocks.headers.mockResolvedValue(new Headers({
      'x-vfuture-request-path': '/app/courses/ai-foundations/items/intro?mode=review',
    }));

    await expect(requireUser()).rejects.toThrow(
      'redirect:/login?next=%2Fapp%2Fcourses%2Fai-foundations%2Fitems%2Fintro%3Fmode%3Dreview',
    );
  });

  it('keeps API authentication as a structured 401 without navigation', async () => {
    mocks.supabaseUser.mockResolvedValue(authClient({ user: null }));

    await expect(requireApiUser()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('separates profile completeness from navigation', () => {
    expect(profileState({ data: { handle: 'learner' }, error: null })).toBe('complete');
    expect(profileState({ data: { handle: null }, error: null })).toBe('incomplete');
    expect(profileState({ data: null, error: new Error('lookup failed') })).toBe('unavailable');
    expect(profileState({ data: null, error: null })).toBe('unavailable');
  });

  it('returns an existing profile to the exact validated public action page', async () => {
    const client = authClient();
    mocks.supabaseUser.mockResolvedValue(client);

    const response = await callback(new Request(
      'https://academy.example/auth/callback?code=pkce&next=%2Fcourses%2Fai-foundations%3Fenroll%3D1',
    ));

    expect(response.headers.get('location')).toBe('https://academy.example/courses/ai-foundations?enroll=1');
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce');
  });

  it('carries an incomplete profile destination through onboarding', async () => {
    mocks.supabaseUser.mockResolvedValue(authClient({
      profile: { data: { handle: null }, error: null },
    }));

    const response = await callback(new Request(
      'https://academy.example/auth/callback?code=pkce&next=%2Fapp%2Fprojects%2Fclimate-lab%3Fjoin%3D1',
    ));

    expect(response.headers.get('location')).toBe(
      'https://academy.example/welcome?next=%2Fapp%2Fprojects%2Fclimate-lab%3Fjoin%3D1',
    );
  });

  it.each([
    ['cancelled', 'error=access_denied&error_description=User%20cancelled'],
    ['expired', 'error=access_denied&error_description=Confirmation%20link%20expired'],
    ['provider', 'error=server_error'],
  ] as const)('retains next and reports a stable %s provider failure', async (reason, errorQuery) => {
    const response = await callback(new Request(
      `https://academy.example/auth/callback?${errorQuery}&next=%2Fopportunities%2Fsummer-lab`,
    ));

    expect(response.headers.get('location')).toBe(
      `https://academy.example/login?error=${reason}&next=%2Fopportunities%2Fsummer-lab`,
    );
  });

  it('retains next and reports profile lookup failures separately', async () => {
    mocks.supabaseUser.mockResolvedValue(authClient({
      profile: { data: null, error: new Error('RLS') },
    }));

    const response = await callback(new Request(
      'https://academy.example/auth/callback?code=pkce&next=%2Fprojects%2Fclimate-lab',
    ));

    expect(response.headers.get('location')).toBe(
      'https://academy.example/login?error=profile&next=%2Fprojects%2Fclimate-lab',
    );
  });

  it('still reads a verified session for authenticated callers', async () => {
    mocks.supabaseUser.mockResolvedValue(authClient());
    await expect(getSessionUser()).resolves.toMatchObject({ id: 'user-1' });
  });
});
