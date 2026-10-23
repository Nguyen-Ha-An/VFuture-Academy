// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  service: { get: vi.fn() },
  createBankService: vi.fn(),
  actorPermissionCheck: vi.fn(() => vi.fn()),
  requirePermission: vi.fn().mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] }),
  getActor: vi.fn().mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] }),
  hasPermission: vi.fn().mockReturnValue(false),
}));

const bankRouter = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => bankRouter }));
vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn().mockResolvedValue('en'), getTranslations: vi.fn().mockResolvedValue((key: string) => key) }));
vi.mock('@/features/bank/service', () => ({
  get: mocks.get,
  createBankService: mocks.createBankService,
  actorPermissionCheck: mocks.actorPermissionCheck,
}));
vi.mock('@/lib/permissions', () => ({ getActor: mocks.getActor, can: mocks.hasPermission, requirePermission: mocks.requirePermission }));
vi.mock('@/features/admin/context', () => ({
  adminPageContext: async () => ({ actor: await mocks.requirePermission('bank.edit'), scope: { kind: 'central' } }),
}));
vi.mock('@/features/admin/content-review', () => ({ assertContentAccess: vi.fn() }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: async () => ({ actor: await mocks.requirePermission('bank.edit'), scope: { kind: 'central' } }),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));

import BankQuestionPage from '@/app/studio/bank/[id]/page';

describe('Studio bank detail page', () => {
  it('renders an empty state when a question has no versions', async () => {
    mocks.hasPermission.mockReturnValue(false);
    mocks.createBankService.mockReturnValue(mocks.service);
    mocks.service.get.mockResolvedValue({
      id: 'bank-question',
      status: 'draft',
      currentVersionId: null,
      languages: ['en'],
      latestVersion: null,
    });

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {await BankQuestionPage({ params: Promise.resolve({ id: 'bank-question' }) })}
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'noVersionsTitle' })).toBeInTheDocument();
    expect(screen.getByText('noVersionsDescription')).toBeInTheDocument();
    expect(mocks.requirePermission).toHaveBeenCalledTimes(1);
    expect(mocks.createBankService).toHaveBeenCalledTimes(1);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('preserves published and latest version ids for the review workflow', async () => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.createBankService.mockReturnValue(mocks.service);
    mocks.service.get.mockResolvedValue({
      id: 'bank-question',
      status: 'published',
      currentVersionId: 'version-1',
      languages: ['en'],
      latestVersion: {
        id: 'version-2',
        version: 2,
        payload: { id: 'bank-question', title: { en: 'A readable bank question' }, type: 'true_false', content: { blocks: [] }, correctAnswer: true },
        renders: {},
        grading: { id: 'bank-question', type: 'true_false', correctAnswer: true },
      },
    });

    render(
      <NextIntlClientProvider locale="en" messages={en}>
        {await BankQuestionPage({ params: Promise.resolve({ id: 'bank-question' }) })}
      </NextIntlClientProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Content review workflow' })).toBeInTheDocument();
    const title = screen.getByRole('heading', { level: 1, name: 'A readable bank question' });
    expect(title).toBeInTheDocument();
    expect(title.closest('header')).not.toHaveTextContent('bank-question');
    expect(title.closest('header')?.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'success');
  });
});
