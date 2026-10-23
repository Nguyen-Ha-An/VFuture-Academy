// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import Link from 'next/link';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { withBenchMessages } from '@/messages/bench';
import { ictTime, intlLocale } from '@/features/workspace-ui/format';
import { BenchState, PageSkeleton } from '@/features/workspace-ui/ui/BenchState';
import { Crumbs, PageHeader } from '@/features/workspace-ui/ui/PageHeader';
import { Card, EmptyBench } from '@/features/workspace-ui/ui/primitives';
import { SectionBoundary } from '@/features/workspace-ui/ui/SectionBoundary';
import { Segmented } from '@/features/workspace-ui/ui/Segmented';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const messages = withBenchMessages(en, 'en');
const wrap = (node: ReactNode, locale: 'en' | 'vi' = 'en') => render(<NextIntlClientProvider locale={locale} messages={locale === 'vi' ? withBenchMessages(viMessages, 'vi') : messages} timeZone="Asia/Ho_Chi_Minh">{node}</NextIntlClientProvider>);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('PageHeader', () => {
  it('renders crumbs first inside the head, marks the last crumb current and keeps one action slot', () => {
    const { container } = wrap(<PageHeader
      crumbs={[{ label: 'Explore', href: '/app/explore' }, { label: 'Resources', href: '/app/resources?type=guide' }, { label: 'Guide one' }]}
      kicker="A3 / Resources"
      title="Guide one"
      titleId="guide-title"
      lead="A useful guide"
      meta={['Hanoi', null, 'Online']}
      actions={<a href="/apply">Apply</a>}
    />);
    const head = container.querySelector('.vf-page-head')!;
    const crumbs = screen.getByRole('navigation', { name: en.common.breadcrumbs });
    expect(head.firstElementChild).toBe(crumbs);
    expect(crumbs.querySelector('ol')).toHaveClass('vf-crumbs');
    expect(within(crumbs).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/app/explore');
    expect(within(crumbs).getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/app/resources?type=guide');
    expect(within(crumbs).queryByRole('link', { name: 'Guide one' })).toBeNull();
    expect(within(crumbs).getByText('Guide one')).toHaveAttribute('aria-current', 'page');
    expect(within(crumbs).getAllByText('/')).toHaveLength(2);
    expect(within(crumbs).getAllByText('/').every(separator => separator.getAttribute('aria-hidden') === 'true')).toBe(true);

    expect(screen.getByRole('heading', { level: 1, name: 'Guide one' })).toHaveAttribute('id', 'guide-title');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('vf-title');
    expect(screen.getByText('A3 / Resources')).toHaveClass('vf-kicker');
    expect(screen.getByText('A useful guide')).toHaveClass('vf-l-lead');
    const meta = container.querySelector('.vf-l-head-meta')!;
    expect([...meta.children].map(child => child.textContent)).toEqual(['Hanoi', 'Online']);
    const actions = container.querySelectorAll('[data-slot="action"]');
    expect(actions).toHaveLength(1);
    expect(within(actions[0] as HTMLElement).getByRole('link', { name: 'Apply' })).toBeInTheDocument();
  });

  it('renders no crumbs nav without crumbs, labels a section head and sizes anchor titles', () => {
    const { container } = wrap(<PageHeader as="section" kicker="A2 / Courses" title="Courses" titleId="catalog-title" titleSize="anchor" />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('[data-slot="action"]')).toBeNull();
    expect(screen.getByRole('region', { name: 'Courses' })).toHaveClass('vf-page-head');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('vf-title-sm');
  });

  it('localizes the breadcrumbs label and renders nothing for an empty trail', () => {
    const { container } = wrap(<Crumbs items={[]} />, 'vi');
    expect(container).toBeEmptyDOMElement();
    wrap(<Crumbs items={[{ label: 'Khoá học', href: '/app/courses' }, { label: 'AI' }]} />, 'vi');
    expect(screen.getByRole('navigation', { name: viMessages.common.breadcrumbs })).toBeInTheDocument();
  });
});

describe('Segmented', () => {
  it('is a labelled nav of links with the current one marked', () => {
    render(<Segmented label="Courses" items={[{ key: 'learning', label: 'Learning', href: '/app/courses?tab=learning', current: false }, { key: 'discover', label: 'Discover', href: '/app/courses?tab=discover', current: true }]} />);
    const nav = screen.getByRole('navigation', { name: 'Courses' });
    expect(nav).toHaveClass('vf-seg');
    expect(within(nav).getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Learning' })).not.toHaveAttribute('aria-current');
  });
});

describe('BenchState', () => {
  it.each([
    ['empty', 'vf-empty', 'status', true],
    ['filtered', 'vf-empty', 'status', true],
    ['not-found', 'vf-empty', null, false],
    ['fault', 'vf-l-fault', null, false],
  ] as const)('renders the %s kind', (kind, className, role, grid) => {
    const { container } = render(<BenchState kind={kind} kicker="Kicker" title="Title" body="Body" meta="Ref 1" actions={<button type="button">Act</button>} />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('data-kind', kind);
    expect(root).toHaveClass(className);
    expect(root.classList.contains('vf-grid-bg')).toBe(grid);
    expect(root.getAttribute('role')).toBe(role);
    expect(screen.getByRole('heading', { level: 3, name: 'Title' })).toHaveClass('vf-empty-title');
    expect(screen.getByText('Body').tagName).toBe('P');
    expect(screen.getByText('Ref 1')).toHaveClass('vf-meta');
    expect(screen.getByRole('button', { name: 'Act' }).parentElement).toHaveClass('vf-state-actions');
  });

  it('labels a page-level state by its h1', () => {
    render(<BenchState kind="not-found" kicker="404" title="Not here" titleAs="h1" titleId="missing-title" />);
    expect(screen.getByRole('region', { name: 'Not here' })).toHaveAttribute('data-kind', 'not-found');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('vf-title-sm');
  });

  it('keeps EmptyBench a status region with its heading level and action', () => {
    render(<EmptyBench kicker="None" title="Nothing yet" description="Come back later." headingLevel={2} action={<Link href="/app/courses">Browse</Link>} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-kind', 'empty');
    expect(within(status).getByRole('heading', { level: 2, name: 'Nothing yet' })).toBeInTheDocument();
    expect(within(status).getByText('Come back later.')).toBeInTheDocument();
    expect(within(status).getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/app/courses');
  });

  it.each(['home', 'directory', 'detail', 'activity'] as const)('draws a static %s skeleton', (variant) => {
    const { container } = render(<PageSkeleton variant={variant} label="Loading content…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('data-variant', variant);
    expect(status).toHaveTextContent('Loading content…');
    expect(container.querySelector('.vf-l-skeleton-body')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.vf-skel').length).toBeGreaterThan(2);
    expect(container.querySelector('.vf-sweep, [class*="animate-"]')).toBeNull();
  });
});

describe('Card', () => {
  it('names a card region by its title and flags flush cards', () => {
    render(<><Card title="Outcomes" titleId="outcomes-heading"><p>Explain</p></Card><Card as="div" flush aria-label="Table card"><table /></Card></>);
    const card = screen.getByRole('region', { name: 'Outcomes' });
    expect(card).toHaveClass('vf-card');
    expect(within(card).getByRole('heading', { level: 2, name: 'Outcomes' })).toHaveAttribute('id', 'outcomes-heading');
    expect(screen.getByLabelText('Table card')).toHaveAttribute('data-flush', 'true');
  });
});

describe('locale formatting', () => {
  it('maps the app locale to Intl locales and keeps ICT 24-hour times', () => {
    expect(intlLocale('vi')).toBe('vi-VN');
    expect(intlLocale('en')).toBe('en-US');
    const at = new Date('2026-09-24T14:05:00Z');
    expect(ictTime(at, 'vi')).toBe('21:05');
    expect(ictTime(at, 'en')).toBe('21:05');
    expect(ictTime(at)).toBe('21:05');
  });

  it('stamps a section fault in ICT with the app locale', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T17:05:00Z'));
    const Broken = () => { throw new Error('boom'); };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(<SectionBoundary label="Trace"><Broken /></SectionBoundary>, 'vi');
    expect(screen.getByRole('alert')).toHaveTextContent('00:05 ICT');
    errorLog.mockRestore();
  });
});
