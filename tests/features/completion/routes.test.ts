import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getMe: vi.fn(),
  branchIdForUser: vi.fn(),
  downloadCertificate: vi.fn(),
  listCertificates: vi.fn(),
  xpSummary: vi.fn(),
  weeklyLeaderboard: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/features/me/service', () => ({
  getMe: mocks.getMe,
  branchIdForUser: mocks.branchIdForUser,
}));
vi.mock('@/features/certificates/service', () => ({
  downloadCertificate: mocks.downloadCertificate,
  listCertificates: mocks.listCertificates,
  verify: mocks.verify,
}));
vi.mock('@/features/xp/service', () => ({
  xpSummary: mocks.xpSummary,
  weeklyLeaderboard: mocks.weeklyLeaderboard,
}));
vi.mock('@/features/marketing/public-http', () => ({
  checkPublicRateLimit: () => ({ allowed: true, headers: new Headers() }),
  applyPublicResponseHeaders: (response: Response) => response,
}));

import { GET as getMeRoute } from '@/app/api/v1/me/route';
import { GET as getCertificatesRoute } from '@/app/api/v1/me/certificates/route';
import { GET as downloadCertificateRoute } from '@/app/api/v1/me/certificates/[id]/download/route';
import { GET as getXpRoute } from '@/app/api/v1/me/xp/route';
import { GET as getLeaderboardRoute } from '@/app/api/v1/leaderboard/route';
import { GET as getVerificationRoute } from '@/app/api/v1/certificates/verify/[code]/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ id: 'learner-1' });
});

describe('completion API routes', () => {
  it('returns authenticated me, certificate, and XP envelopes', async () => {
    mocks.getMe.mockResolvedValue({ profile: { id: 'learner-1' }, counts: {} });
    mocks.listCertificates.mockResolvedValue([{ id: 'certificate-1' }]);
    mocks.xpSummary.mockResolvedValue({ total: 140, weekly: 40, streak: { current: 3, longest: 5 } });

    const [meResponse, certificateResponse, xpResponse] = await Promise.all([
      getMeRoute(new Request('https://academy.example/api/v1/me')),
      getCertificatesRoute(new Request('https://academy.example/api/v1/me/certificates')),
      getXpRoute(new Request('https://academy.example/api/v1/me/xp')),
    ]);
    await expect(meResponse.json()).resolves.toEqual({ data: { profile: { id: 'learner-1' }, counts: {} } });
    await expect(certificateResponse.json()).resolves.toEqual({ data: [{ id: 'certificate-1' }] });
    await expect(xpResponse.json()).resolves.toEqual({ data: { total: 140, weekly: 40, streak: { current: 3, longest: 5 } } });
  });

  it('uses the signed-in learner branch for branch scope', async () => {
    mocks.branchIdForUser.mockResolvedValue('branch-1');
    mocks.weeklyLeaderboard.mockResolvedValue([{ rank: 1, handle: 'learner-one', displayName: 'Learner One', points: 40 }]);

    const response = await getLeaderboardRoute(new Request('https://academy.example/api/v1/leaderboard?scope=branch'));

    expect(response.status).toBe(200);
    expect(mocks.weeklyLeaderboard).toHaveBeenCalledWith('branch', 'branch-1');
  });

  it('redirects only the signed-in owner to a short-lived certificate download', async () => {
    mocks.downloadCertificate.mockResolvedValue('https://storage.example/signed-certificate');

    const response = await downloadCertificateRoute(
      new Request('https://academy.example/api/v1/me/certificates/certificate-1/download'),
      { params: Promise.resolve({ id: 'certificate-1' }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://storage.example/signed-certificate');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.downloadCertificate).toHaveBeenCalledWith('learner-1', 'certificate-1');
  });

  it('returns a signed PDF URL from public verification only for a valid code', async () => {
    mocks.verify.mockResolvedValue({
      learnerDisplayName: 'Learner One',
      courseTitle: 'AI Foundations',
      issuedAt: '2026-09-03T12:00:00.000Z',
      serial: 'VFA-2026-ABCDEFGH',
      pdfUrl: 'https://storage.example/signed-certificate',
    });

    const response = await getVerificationRoute(
      new Request('https://academy.example/api/v1/certificates/verify/11111111-1111-4111-8111-111111111111'),
      { params: Promise.resolve({ code: '11111111-1111-4111-8111-111111111111' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { pdfUrl: 'https://storage.example/signed-certificate' },
    });
  });

  it('returns a public 404 for an unknown certificate code', async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await getVerificationRoute(
      new Request('https://academy.example/api/v1/certificates/verify/11111111-1111-4111-8111-111111111111'),
      { params: Promise.resolve({ code: '11111111-1111-4111-8111-111111111111' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: 'CERTIFICATE_NOT_FOUND', message: 'Certificate not found' } });
  });
});
