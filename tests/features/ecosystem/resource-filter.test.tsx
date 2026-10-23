// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listPage: vi.fn(async () => ({ items: [] as Array<Record<string, unknown>>, total: 0, page: 1, pageSize: 50 })),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('not_found'); }),
  redirect: vi.fn(),
  usePathname: () => '/app/resources',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/components/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => ({ id: 'learner-1' })) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/ecosystem/context', () => ({ learnerContext: vi.fn(async () => ({ userId: 'learner-1', branchId: null, locale: 'en' })) }));
vi.mock('@/features/resources/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/resources/service')>();
  return { ...actual, createResourceService: vi.fn(() => ({ get: mocks.get, listPage: mocks.listPage })) };
});
vi.mock('@/features/ecosystem/ui/StaticRichContent', () => ({ StaticRichContent: () => <div>Resource body</div> }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace: string) => (key: string) => {
    const path = `${namespace}.${key}`.split('.');
    return path.reduce<unknown>((value, segment) => (
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[segment] : undefined
    ), en) as string;
  }),
}));

import ResourcesPage from '@/app/app/resources/page';
import ResourceDetailPage from '@/app/app/resources/[id]/page';

// Page-owned breadcrumbs read common.breadcrumbs through next-intl, so pages render inside a provider.
const render = (ui: ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);

afterEach(cleanup);

describe('resource filter form', () => {
  it('labels every control, localizes option labels, and keeps the submit button outside labels', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('searchbox', { name: 'Search resources' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Resource type' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Pathway' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Tag' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Guide' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'AI & emerging technology' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply filters' }).closest('label')).toBeNull();
  });

  it('shows a validation message for invalid page filters', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({ page: '0' }) }));

    expect(screen.getByRole('alert')).toHaveTextContent('Check the resource filters and try again.');
  });

  it('retains only normalized filters in the resource detail link and back link', async () => {
    mocks.listPage.mockResolvedValueOnce({
      items: [{ id: 'guide-1', title: 'Guide one', summary: 'Summary', resourceType: 'guide', tags: [], skills: [], pathways: [], body: { blocks: [] }, attachments: [], publishedAt: null }],
      total: 51,
      page: 2,
      pageSize: 50,
    });
    const context = { type: 'guide', search: 'climate', pathway: 'invalid', page: '2' };
    const list = render(await ResourcesPage({ searchParams: Promise.resolve(context) }));
    expect(screen.getByRole('link', { name: 'Open Guide one' })).toHaveAttribute('href', '/app/resources/guide-1?type=guide&search=climate&page=2');
    list.unmount();

    mocks.get.mockResolvedValueOnce({ id: 'guide-1', title: 'Guide one', summary: 'Summary', resourceType: 'guide', tags: [], skills: [], pathways: [], body: { blocks: [] }, attachments: [], publishedAt: null });
    render(await ResourceDetailPage({
      params: Promise.resolve({ id: 'guide-1' }),
      searchParams: Promise.resolve(context),
    } as Parameters<typeof ResourceDetailPage>[0]));
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumbs' })).getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/app/resources?type=guide&search=climate&page=2');
  });
});
