// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const messages = withBenchMessages(en, 'en');
const mocks = vi.hoisted(() => ({
  readLearnerRewards: vi.fn(),
  getOwnerProfileEvidence: vi.fn(),
  getProfileSettings: vi.fn(),
  branchIdForUser: vi.fn(),
}));

vi.mock('@/features/workspace-ui/learner/dashboard.server', () => ({ LearnerActivityTrace: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn().mockResolvedValue({ id: 'learner-1' }) }));
vi.mock('@/features/learner/summary', () => ({ readLearnerRewards: mocks.readLearnerRewards }));
vi.mock('@/features/profile/service', () => ({ getOwnerProfileEvidence: mocks.getOwnerProfileEvidence, getProfileSettings: mocks.getProfileSettings }));
vi.mock('@/features/me/service', () => ({ branchIdForUser: mocks.branchIdForUser }));
vi.mock('@/features/learner/ui/ProfileSettings', () => ({ ProfileSettings: () => <section aria-label="Profile identity">Profile identity</section> }));
vi.mock('@/features/profile/ui/ProfileSettings', () => ({ ProfileSettings: () => <section aria-label="Public profile settings">Public profile settings</section> }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getLocale: vi.fn().mockResolvedValue('en'),
    getTranslations: vi.fn(async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never })),
  };
});

import LearnerProfilePage from '@/app/app/profile/page';

const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh">{node}</NextIntlClientProvider>);
const rewards = (certificates: unknown[] = []) => ({
  profile: { displayName: 'Future Builder', handle: 'future_builder', locale: 'en', avatarUrl: null, profilePublic: true },
  xpTotal: 1240,
  streak: { current: 2, longest: 3, lastActiveDate: null },
  certificates,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
  mocks.readLearnerRewards.mockResolvedValue(rewards());
  mocks.getOwnerProfileEvidence.mockResolvedValue({
    skills: [{ id: 'python', name: { en: 'Python', vi: 'Python' }, category: 'technical', level: 'applied', evidence: [] }],
    completedCourses: [{ id: 'py-110', title: { en: 'Python for data engineers', vi: 'Python cho kỹ sư dữ liệu' }, completedAt: '2026-08-14T03:00:00.000Z', currentDestinationAvailable: true }],
    projects: [{ id: 'gateway', title: { en: 'MQTT gateway', vi: 'Cổng MQTT' }, summary: { en: 'A field gateway', vi: 'Cổng hiện trường' }, outputLinks: [] }],
  });
  mocks.getProfileSettings.mockResolvedValue({ handle: 'future_builder', displayName: 'Future Builder', profilePublic: true });
  mocks.branchIdForUser.mockResolvedValue('hcm');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('bench learner profile', () => {
  it('keeps the section order contract and every heading id', async () => {
    const { container } = wrap(await LearnerProfilePage());
    const content = container.textContent ?? '';
    const positions = ['Profile identity', 'Skills Passport', 'Completed courses', 'Showcased projects', 'Certificates', 'Total XP', 'Public profile settings'].map((text) => content.indexOf(text));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const id of ['profile-title', 'completed-courses-heading', 'projects-heading', 'certificates-heading', 'xp-heading']) {
      expect(container.querySelector(`#${id}`)).toBeInTheDocument();
    }
  });

  it('leads with the identity readout: name, handle, branch and public profile link', async () => {
    wrap(await LearnerProfilePage());
    expect(screen.getByRole('heading', { level: 1, name: 'Future Builder' })).toHaveAttribute('id', 'profile-title');
    // The handle shows once, in the head meta line, not again in the identity card.
    expect(screen.getAllByText('@future_builder')).toHaveLength(1);
    expect(screen.getByText('@future_builder').closest('.vf-l-head-meta')).toBeInTheDocument();
    expect(screen.getByText('Learner profile').closest('.vf-page-head')).toBe(screen.getByRole('heading', { level: 1 }).closest('.vf-page-head'));
    expect(screen.getByText('Branch hcm')).toBeVisible();
    expect(screen.getByRole('link', { name: /View public profile/ })).toHaveAttribute('href', '/u/future_builder');
  });

  it('renders skills as labelled level scales, completed courses in spec and the XP total', async () => {
    wrap(await LearnerProfilePage());
    expect(screen.getByRole('img', { name: 'Python: Applied, level 2 of 3' })).toBeVisible();
    const completed = screen.getByRole('region', { name: 'Completed courses' });
    expect(within(completed).getByRole('link', { name: 'Python for data engineers' })).toHaveAttribute('href', '/app/courses/py-110');
    expect(within(completed).getByText('Complete · in spec')).toBeVisible();
    expect(within(completed).getByText('14.08.2026')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Showcased projects' })).getByRole('link', { name: /MQTT gateway/ })).toHaveAttribute('href', '/app/projects/gateway');
    expect(within(screen.getByRole('region', { name: 'Total XP' })).getByText('1,240')).toBeVisible();
  });

  it('renders one calibration certificate per certificate with a real QR', async () => {
    mocks.readLearnerRewards.mockResolvedValue(rewards([
      { id: 'cert-1', courseId: 'py-110', courseTitle: 'Python for data engineers', serial: 'VF-CERT-1', issuedAt: '2026-08-14T03:00:00.000Z', pdfAssetId: 'asset-1', verificationCode: 'K7Q2' },
      { id: 'cert-2', courseId: 'emb-201', courseTitle: '', serial: 'VF-CERT-2', issuedAt: '2026-09-01T03:00:00.000Z', pdfAssetId: null, verificationCode: 'M3X9' },
    ]));
    wrap(await LearnerProfilePage());
    const section = screen.getByRole('region', { name: 'Certificates' });
    expect(within(section).getAllByRole('article')).toHaveLength(2);
    expect(within(section).getByRole('link', { name: 'Verify certificate VF-CERT-1' })).toHaveAttribute('href', '/verify/K7Q2');
    expect(within(section).getByRole('link', { name: 'Verify certificate VF-CERT-2' })).toHaveAttribute('href', '/verify/M3X9');
    expect(within(section).getAllByRole('link', { name: 'View certificate PDF' })).toHaveLength(1);
    expect(within(section).getByRole('heading', { name: 'emb-201' })).toBeVisible();
    expect(within(section).getByText('app.example/verify/K7Q2')).toBeVisible();
    expect(within(section).getByRole('img', { name: 'Verification QR code for certificate VF-CERT-1' }).querySelector('svg')).toBeInTheDocument();
  });

  it('keeps the existing empty copy for certificates with a Browse courses action', async () => {
    mocks.getOwnerProfileEvidence.mockResolvedValue({ skills: [], completedCourses: [], projects: [] });
    wrap(await LearnerProfilePage());
    const section = screen.getByRole('region', { name: 'Certificates' });
    expect(within(section).getByText('No certificates yet.')).toBeVisible();
    expect(within(section).getByRole('link', { name: /Browse courses/ })).toHaveAttribute('href', '/app/courses');
    expect(screen.getAllByText('Nothing to show yet.')).toHaveLength(2);
  });

  it('hides the branch when the lookup fails instead of failing the page', async () => {
    mocks.branchIdForUser.mockRejectedValue(new Error('down'));
    wrap(await LearnerProfilePage());
    expect(screen.getByText('Independent learner')).toBeVisible();
  });
});
