// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PATHWAYS } from '@/content-engine/schema/course';

const mocks = vi.hoisted(() => ({ list: vi.fn(), query: '' }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://labs.example.test' } }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`.split('.').reduce<unknown>((entry, segment) => typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)[segment] : undefined, en) as string,
}));
vi.mock('@/features/marketing/public-discovery', () => ({ listPublicResources: mocks.list }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/resources',
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ push: vi.fn() }),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));

import ResourcesPage, { generateMetadata } from '@/app/(public)/resources/page';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = '';
  mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
});

describe('public resource library controls', () => {
  it('offers the canonical pathways with human labels in a native GET form', async () => {
    mocks.query = 'pathway=research-innovation&search=robot&lang=en';
    render(await ResourcesPage({ searchParams: Promise.resolve({ pathway: 'research-innovation', search: 'robot', lang: 'en' }) }));
    const form = screen.getByRole('search');
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/resources');
    expect(form.querySelectorAll('input[name="lang"]')).toHaveLength(1);
    expect(form.querySelector('input[name="page"]')).toBeNull();
    expect((screen.getByRole('searchbox', { name: 'Search resources' }) as HTMLInputElement).value).toBe('robot');
    const pathway = screen.getByRole('combobox', { name: 'Pathway' }) as HTMLSelectElement;
    expect(Array.from(pathway.options).map((option) => option.value)).toEqual(['', ...PATHWAYS]);
    expect(pathway.value).toBe('research-innovation');
    expect(screen.getByRole('option', { name: 'AI & emerging technology' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter' }).closest('label')).toBeNull();
    expect(mocks.list).toHaveBeenCalledWith('en', { pathway: 'research-innovation', search: 'robot', page: 1, pageSize: 12 });
  });

  it('does not forward invalid enum values or extra query parameters to the loader', async () => {
    render(await ResourcesPage({ searchParams: Promise.resolve({ pathway: 'private-track', type: 'internal', page: '-5', returnTo: '/app/admin', owner: 'private-user' }) }));
    expect(mocks.list).toHaveBeenCalledWith('en', { page: 1, pageSize: 12 });
    expect(document.body.textContent).not.toContain('private-user');
  });

  it('keeps filtered catalogs out of the index and preserves unfiltered page canonicals', async () => {
    const filtered = await generateMetadata({ searchParams: Promise.resolve({ search: 'robot', page: '2' }) });
    expect(filtered.robots).toEqual({ index: false, follow: true });
    expect(filtered.alternates?.canonical).toBe('https://labs.example.test/resources?lang=en');
    const unfiltered = await generateMetadata({ searchParams: Promise.resolve({ page: '2' }) });
    expect(unfiltered.robots).toEqual({ index: true, follow: true });
    expect(unfiltered.alternates?.canonical).toBe('https://labs.example.test/resources?lang=en&page=2');
  });
});
