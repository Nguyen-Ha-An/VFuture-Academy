// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicFilterForm, PublicLink, PublicNavigationProvider } from '@/features/public-site/PublicNavigation';

const state = vi.hoisted(() => ({ path: '/resources', query: 'lang=en', push: vi.fn(), replace: vi.fn(), track: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => state.path, useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ push: state.push, replace: state.replace }) }));
vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
vi.mock('@/lib/analytics-client', () => ({ track: state.track }));
vi.mock('next/link', () => ({ default: ({ href, children, scroll: _scroll, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode; scroll?: boolean }) => <a href={href} {...props} onClick={(event) => { onClick?.(event); event.preventDefault(); }}>{children}</a> }));

function browsing() {
  return <PublicNavigationProvider>
    <PublicFilterForm aria-label="Resource filters">
      <input aria-label="Search" name="search" />
      <select aria-label="Type" name="type"><option value="">All</option><option value="guide">Guide</option></select>
      <input aria-label="Open now" name="openNow" type="checkbox" value="true" />
      <input name="page" type="hidden" value="8" />
      <button>Filter</button>
    </PublicFilterForm>
    <p data-public-results-focus tabIndex={-1}>3 results</p>
    <button>Unrelated control</button>
  </PublicNavigationProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.path = '/resources';
  state.query = 'lang=en';
  window.history.replaceState(null, '', '/resources?lang=en');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('public progressive navigation', () => {
  it('keeps native GET markup and a locale input while enhanced submits reset pagination without leaking search into analytics', async () => {
    render(browsing());
    const form = screen.getByRole('form');
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/resources');
    expect(form.querySelector('input[name="lang"]')?.getAttribute('value')).toBe('en');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'private search words' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'guide' } });
    fireEvent.submit(form);
    expect(state.push).toHaveBeenCalledWith('/resources?search=private+search+words&type=guide&lang=en', { scroll: false });
    expect(state.track).toHaveBeenCalledWith('public.filters_applied', expect.objectContaining({ route: 'resources', hasSearch: true, hasType: true }));
    expect(JSON.stringify(state.track.mock.calls)).not.toContain('private search words');
  });

  it('focuses and announces only an explicitly committed result navigation', async () => {
    const { rerender } = render(browsing());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'robot' } });
    fireEvent.submit(screen.getByRole('form'));
    state.query = 'search=robot&lang=en';
    window.history.pushState(null, '', `/resources?${state.query}`);
    rerender(browsing());
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-public-results-focus]')));
    expect(screen.getByRole('status').textContent).toBe('3 results');
    screen.getByRole('button', { name: 'Unrelated control' }).focus();
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    state.query = 'lang=en';
    window.history.replaceState(null, '', '/resources?lang=en');
    rerender(browsing());
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(''));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unrelated control' }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('clears the previous result announcement on ordinary navigation without stealing focus', async () => {
    const { rerender } = render(browsing());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'robot' } });
    fireEvent.submit(screen.getByRole('form'));
    state.query = 'search=robot&lang=en';
    window.history.pushState(null, '', `/resources?${state.query}`);
    rerender(browsing());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('3 results'));
    screen.getByRole('button', { name: 'Unrelated control' }).focus();
    state.path = '/projects';
    state.query = 'lang=en';
    window.history.pushState(null, '', '/projects?lang=en');
    rerender(browsing());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unrelated control' }));
  });

  it('restores text, select and checkbox state from query changes and history', () => {
    state.query = 'search=robot&type=guide&openNow=true&lang=en';
    const { rerender } = render(browsing());
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('robot');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('guide');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    state.query = 'lang=en';
    rerender(browsing());
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('propagates public locale while preserving protected, external and explicit locale destinations', () => {
    render(<><PublicLink href="/courses?pathway=ai">Courses</PublicLink><PublicLink href="/courses?lang=vi">Vietnamese</PublicLink><PublicLink href="/login?next=%2Fapp%2Fcourses%2Fone">Login</PublicLink><PublicLink href="/app/resources/one">Private resource</PublicLink><PublicLink href="https://example.test/projects">External</PublicLink></>);
    expect(screen.getByText('Courses').getAttribute('href')).toBe('/courses?pathway=ai&lang=en');
    expect(screen.getByText('Vietnamese').getAttribute('href')).toBe('/courses?lang=vi');
    expect(screen.getByText('Login').getAttribute('href')).toBe('/login?next=%2Fapp%2Fcourses%2Fone');
    expect(screen.getByText('Private resource').getAttribute('href')).toBe('/app/resources/one');
    expect(screen.getByText('External').getAttribute('href')).toBe('https://example.test/projects');
  });

  it('runs explicit pagination through the transition without scrolling and honors replacement links', () => {
    render(<PublicNavigationProvider><PublicLink href="/resources?page=2" resultNavigation>Next page</PublicLink><PublicLink href="/resources" resultNavigation replace>Reset</PublicLink></PublicNavigationProvider>);
    fireEvent.click(screen.getByText('Next page'));
    expect(state.push).toHaveBeenCalledWith('/resources?page=2&lang=en', { scroll: false });
    expect(state.track).toHaveBeenCalledWith('public.pagination_clicked', { route: 'resources', page: 2 });
    state.track.mockClear();
    fireEvent.click(screen.getByText('Reset'));
    expect(state.replace).toHaveBeenCalledWith('/resources?lang=en', { scroll: false });
    expect(state.track).not.toHaveBeenCalledWith('public.pagination_clicked', expect.anything());
  });

  it('does not take over modified link clicks or analytics', () => {
    render(<PublicLink href="/resources?page=2" resultNavigation analytics={{ name: 'public.cta_clicked', props: { route: 'resources' } }}>Next</PublicLink>);
    fireEvent.click(screen.getByText('Next'), { ctrlKey: true });
    expect(state.track).not.toHaveBeenCalled();
    expect(state.push).not.toHaveBeenCalled();
  });
});
