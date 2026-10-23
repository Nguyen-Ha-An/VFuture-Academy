import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPublicProfile: vi.fn(),
  checkPublicRateLimit: vi.fn(),
  headers: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <Args extends unknown[], Result>(operation: (...args: Args) => Result) => {
      const results = new Map<string, Result>();
      return (...args: Args) => {
        const key = JSON.stringify(args);
        if (!results.has(key)) results.set(key, operation(...args));
        return results.get(key)!;
      };
    },
  };
});
vi.mock('@/features/profile/service', () => ({ getPublicProfile: mocks.getPublicProfile }));
vi.mock('@/features/marketing/public-http', () => ({ checkPublicRateLimit: mocks.checkPublicRateLimit }));
vi.mock('@/features/profile/ui/PublicProfileView', () => ({ PublicProfileView: () => null }));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn().mockResolvedValue('en'),
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://academy.example' } }));

const profile = {
  handle: 'future_builder',
  displayName: 'Future Builder',
  avatarUrl: null,
  branch: { name: 'VinSMC' },
  completedCourses: [],
  skills: [],
  certificates: [],
  projects: [],
};

describe('public profile page', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ cookie: 'vf_public_session=0123456789abcdef' }));
    mocks.checkPublicRateLimit.mockReturnValue({ allowed: true, headers: new Headers() });
    mocks.getPublicProfile.mockResolvedValue(profile);
    mocks.notFound.mockImplementation(() => {
      throw Object.assign(new Error('not found'), { digest: 'NEXT_NOT_FOUND' });
    });
  });

  it('deduplicates the profile and limiter lookup between metadata and page rendering', async () => {
    const page = await import('@/app/u/[handle]/page');

    await page.generateMetadata({ params: Promise.resolve({ handle: 'future_builder' }) });
    await page.default({ params: Promise.resolve({ handle: 'future_builder' }) });

    expect(mocks.getPublicProfile).toHaveBeenCalledTimes(1);
    expect(mocks.checkPublicRateLimit).toHaveBeenCalledTimes(1);
  });

  it('does not read profile data when the shared public limiter denies the page request', async () => {
    mocks.checkPublicRateLimit.mockReturnValue({ allowed: false, headers: new Headers() });
    const page = await import('@/app/u/[handle]/page');

    await expect(page.default({ params: Promise.resolve({ handle: 'future_builder' }) }))
      .rejects.toMatchObject({ digest: 'NEXT_NOT_FOUND' });
    expect(mocks.getPublicProfile).not.toHaveBeenCalled();
  });
});
