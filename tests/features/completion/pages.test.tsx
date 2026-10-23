// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  checkPublicRateLimit: vi.fn(),
  headers: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <Args extends unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => {
      const key = JSON.stringify(args);
      if (!state.cache.has(key)) state.cache.set(key, fn(...args));
      return state.cache.get(key) as Result;
    },
  };
});

vi.mock('next/headers', () => ({ headers: state.headers }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn().mockResolvedValue('en'),
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));
vi.mock('@/components/LocaleSwitcher', () => ({ LocaleSwitcher: () => <span>locale</span> }));
vi.mock('@/features/certificates/service', () => ({ verify: state.verify }));
vi.mock('@/features/marketing/public-http', () => ({
  checkPublicRateLimit: state.checkPublicRateLimit,
}));

import CertificateVerificationPage, {
  generateMetadata,
} from '@/app/verify/[code]/page';

beforeEach(() => {
  state.cache.clear();
  vi.clearAllMocks();
  state.headers.mockResolvedValue(new Headers({ cookie: 'vf_public_session=signed.cookie' }));
});

afterEach(cleanup);

describe('certificate verification page', () => {
  it('does not query certificate data when the page request is rate limited', async () => {
    state.checkPublicRateLimit.mockReturnValue({ allowed: false, headers: new Headers() });

    render(await CertificateVerificationPage({
      params: Promise.resolve({ code: 'rate-limited-code' }),
    }));

    expect(state.verify).not.toHaveBeenCalled();
    expect(screen.getByRole('heading').textContent).toContain('Verification temporarily unavailable');
  });

  it('shares one cached verification lookup between metadata and page rendering', async () => {
    state.checkPublicRateLimit.mockReturnValue({ allowed: true, headers: new Headers() });
    state.verify.mockResolvedValue({
      learnerDisplayName: 'Learner One',
      courseTitle: 'AI Foundations',
      issuedAt: '2026-09-03T12:00:00.000Z',
      serial: 'VFA-2026-ABCDEFGH',
      pdfUrl: 'https://storage.example/signed',
    });
    const params = Promise.resolve({ code: 'cached-verification-code' });

    await generateMetadata({ params });
    render(await CertificateVerificationPage({ params }));

    expect(state.verify).toHaveBeenCalledOnce();
    expect(state.checkPublicRateLimit).toHaveBeenCalledOnce();
    expect(screen.getByText('AI Foundations')).toBeDefined();
  });
});
