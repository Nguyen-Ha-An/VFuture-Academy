// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ pathname: '/app/courses', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { ActionPanel, DetailPage } from '@/features/workspace-ui/learner/DetailPage';
import { catalogFilterChips, opportunityFilterChips, projectFilterChips, resourceFilterChips } from '@/features/workspace-ui/learner/directory/chips';
import { DirectoryPage } from '@/features/workspace-ui/learner/directory/DirectoryPage';
import { DirectoryPagination } from '@/features/workspace-ui/learner/directory/DirectoryPagination';
import { DirectoryTable, type DirectoryRow } from '@/features/workspace-ui/learner/directory/DirectoryTable';
import { FilterBar, type FilterBarProps, type FilterField } from '@/features/workspace-ui/learner/directory/FilterBar';
import { ResultsHeader } from '@/features/workspace-ui/learner/directory/ResultsHeader';

const wrap = (children: ReactNode) => <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Ho_Chi_Minh">{children}</NextIntlClientProvider>;

type MediaListener = (event: { matches: boolean }) => void;
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<MediaListener>();
  const media = {
    matches,
    media: '(min-width: 760px)',
    addEventListener: (_: string, listener: MediaListener) => listeners.add(listener),
    removeEventListener: (_: string, listener: MediaListener) => listeners.delete(listener),
  };
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
  return { set(next: boolean) { media.matches = next; listeners.forEach(listener => listener({ matches: next })); } };
}

const levelField = (value?: string): FilterField => ({
  kind: 'select', name: 'level', label: 'Level', value, allLabel: 'All',
  options: [{ value: 'foundation', label: 'Foundation' }, { value: 'specialization', label: 'Specialization' }],
});

function bar(props: Partial<FilterBarProps> = {}) {
  const base: FilterBarProps = {
    label: 'Course filters', summary: 'Filters', fields: [levelField()], stateKey: '', activeCount: 0,
    clearHref: '/app/courses?tab=learning', columns: 4, resultsId: 'results', hidden: { tab: 'learning' },
  };
  return wrap(<><FilterBar {...base} {...props} /><p id="results" tabIndex={-1}>3 courses</p></>);
}

beforeEach(() => {
  mocks.pathname = '/app/courses';
  mocks.push.mockReset();
  mockMatchMedia(false);
  window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

describe('FilterBar', () => {
  it('resets a select when the applied filters clear (F2 remount)', () => {
    const view = render(bar({ fields: [levelField('specialization')], stateKey: 'level=specialization', activeCount: 1 }));
    expect(screen.getByRole('combobox', { name: 'Level' })).toHaveValue('specialization');
    view.rerender(bar({ fields: [levelField(undefined)], stateKey: '', activeCount: 0 }));
    expect(screen.getByRole('combobox', { name: 'Level' })).toHaveValue('');
  });

  it('pushes a compact query without empty keys or page', () => {
    render(bar({
      hidden: { tab: 'learning', page: '3' },
      fields: [
        levelField(),
        { kind: 'select', name: 'pathway', label: 'Pathway', allLabel: 'All', options: [{ value: 'fintech-economics', label: 'Fintech' }] },
        { kind: 'search', name: 'search', label: 'Search', wide: true },
        { kind: 'checks', legend: 'Show', items: [{ name: 'openNow', label: 'Open now' }, { name: 'featured', label: 'Featured only' }] },
      ],
    }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: 'foundation' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open now' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
    expect(mocks.push).toHaveBeenCalledWith('/app/courses?tab=learning&level=foundation&openNow=true');
  });

  it('lets a checked box replace a carried fallback of the same name', () => {
    const checks: FilterField = { kind: 'checks', legend: 'Show', items: [{ name: 'featured', label: 'Featured only' }] };
    render(bar({ hidden: { tab: 'learning', featured: 'false' }, fields: [levelField(), checks] }));
    const form = screen.getByRole('form', { name: 'Course filters' });
    // The fallback renders after the fields, so a native GET sends the box's value first.
    const named = [...form.querySelectorAll('input[name="featured"]')].map(input => (input as HTMLInputElement).type);
    expect(named).toEqual(['checkbox', 'hidden']);
    fireEvent.submit(form);
    expect(mocks.push).toHaveBeenLastCalledWith('/app/courses?tab=learning&featured=false');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Featured only' }));
    fireEvent.submit(form);
    expect(mocks.push).toHaveBeenLastCalledWith('/app/courses?tab=learning&featured=true');
  });

  it('submits to the given action and drops the query when nothing is set', () => {
    render(bar({ action: '/app/resources', hidden: undefined }));
    fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
    expect(mocks.push).toHaveBeenCalledWith('/app/resources');
    expect(screen.getByRole('form', { name: 'Course filters' })).toHaveAttribute('method', 'get');
  });

  it('moves focus to the results header after a filter change, not on first mount', () => {
    const view = render(bar({ stateKey: '' }));
    expect(document.activeElement).not.toBe(document.getElementById('results'));
    view.rerender(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
    expect(document.activeElement).toBe(document.getElementById('results'));
  });

  it('focuses the results header when the page remounts the bar after Apply', () => {
    const first = render(bar());
    fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: 'foundation' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
    expect(mocks.push).toHaveBeenCalledWith('/app/courses?tab=learning&level=foundation');
    first.unmount();
    window.history.replaceState({}, '', '/app/courses?tab=learning&level=foundation');
    render(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
    expect(document.activeElement).toBe(document.getElementById('results'));
  });

  it('never moves focus on a later ordinary mount after a submit that changed nothing', () => {
    window.history.replaceState({}, '', '/app/courses?tab=learning&level=foundation');
    const first = render(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
    fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
    // Same URL: nothing remounts, so focus moves at once rather than staying pending.
    expect(document.activeElement).toBe(document.getElementById('results'));
    first.unmount();
    (document.activeElement as HTMLElement | null)?.blur();
    render(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
    expect(document.activeElement).not.toBe(document.getElementById('results'));
  });

  it('drops a pending focus hand-off that has expired', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = render(bar());
      fireEvent.change(screen.getByRole('combobox', { name: 'Level' }), { target: { value: 'foundation' } });
      fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
      first.unmount();
      vi.setSystemTime(Date.now() + 60_000);
      window.history.replaceState({}, '', '/app/courses?tab=learning&level=foundation');
      render(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
      expect(document.activeElement).not.toBe(document.getElementById('results'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a modified Clear click alone', () => {
    window.history.replaceState({}, '', '/app/courses?tab=learning&level=foundation');
    const first = render(bar({ fields: [levelField('foundation')], stateKey: 'level=foundation', activeCount: 1 }));
    // jsdom cannot open a new tab; stop the default after the link's own handler has run.
    document.addEventListener('click', event => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('link', { name: 'Clear filters' }), { metaKey: true });
    first.unmount();
    window.history.replaceState({}, '', '/app/courses?tab=learning');
    render(bar());
    expect(document.activeElement).not.toBe(document.getElementById('results'));
  });

  it('drops whitespace-only search text from the pushed query', () => {
    render(bar({ hidden: undefined, fields: [{ kind: 'search', name: 'search', label: 'Search' }] }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Course filters' }));
    expect(mocks.push).toHaveBeenCalledWith('/app/courses');
  });

  it('keeps the disclosure open at 760px and wider when the filters clear', () => {
    mockMatchMedia(true);
    const view = render(bar({ stateKey: 'level=foundation', activeCount: 1 }));
    const details = document.querySelector('details.vf-l-filters') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    view.rerender(bar({ stateKey: '', activeCount: 0 }));
    expect(details.open).toBe(true);
    expect(details).not.toHaveAttribute('open', 'false');
  });

  it('opens on phones only while filters apply, and follows the media query', () => {
    const media = mockMatchMedia(false);
    const view = render(bar({ stateKey: 'level=foundation', activeCount: 1 }));
    const details = document.querySelector('details.vf-l-filters') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    view.rerender(bar({ stateKey: '', activeCount: 0 }));
    expect(details.open).toBe(false);
    media.set(true);
    expect(details.open).toBe(true);
  });

  it('Clear resets the form when the URL is already clean', () => {
    window.history.replaceState({}, '', '/app/courses?tab=learning');
    render(bar());
    const select = screen.getByRole('combobox', { name: 'Level' });
    fireEvent.change(select, { target: { value: 'foundation' } });
    expect(select).toHaveValue('foundation');
    const clear = screen.getByRole('link', { name: 'Clear filters' });
    expect(clear).toHaveAttribute('href', '/app/courses?tab=learning');
    fireEvent.click(clear);
    expect(select).toHaveValue('');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('renders hidden values, a wide search and the column count', () => {
    render(bar({ columns: 5, fields: [{ kind: 'search', name: 'search', label: 'Search', value: 'robot', wide: true }], applyLabel: 'Filter' }));
    const form = screen.getByRole('form', { name: 'Course filters' });
    expect(form).toHaveAttribute('data-cols', '5');
    expect(form.style.getPropertyValue('--vf-filter-cols')).toBe('5');
    expect(form.querySelector('input[type="hidden"][name="tab"]')).toHaveValue('learning');
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('robot');
    expect(screen.getByRole('searchbox', { name: 'Search' }).closest('label')).toHaveAttribute('data-wide');
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('type', 'submit');
  });
});

const rows: DirectoryRow[] = [
  { id: 'a', lead: 'VF-F01', title: 'Robotics 101', summary: 'Build a rover.', meta: ['Foundation', 'Beginner'], status: { tone: 'signal', label: 'Enrolled' }, href: '/app/courses/a', cta: 'Open', ctaLabel: 'Open Robotics 101' },
  { id: 'b', lead: 'VF-S02', title: 'Model risk', status: null, extra: 'Needs VF-F01', href: '/app/courses/b', cta: 'Open', ctaLabel: 'Open Model risk' },
];

describe('DirectoryTable', () => {
  it('renders one link per row, the title as a heading and the stacked slots in order', () => {
    render(<DirectoryTable caption="Available courses" columns={{ lead: 'Part', title: 'Course', extra: 'Depends on', status: 'Status', cta: 'Next' }} rows={rows} />);
    const table = screen.getByRole('table', { name: 'Available courses' });
    expect(table).toHaveAttribute('data-stack');
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(2);
    bodyRows.forEach(row => expect(within(row).getAllByRole('link')).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Open Robotics 101' })).toHaveAttribute('href', '/app/courses/a');
    expect(screen.getByRole('heading', { level: 3, name: 'Robotics 101' })).toBeInTheDocument();
    expect(bodyRows[0].querySelector('p.vf-meta')).toHaveTextContent('Foundation · Beginner');
    expect(within(bodyRows[0]).getByText('Enrolled')).toHaveClass('vf-tag');
    const slots = [...bodyRows[1].querySelectorAll('td')].map(cell => cell.getAttribute('data-slot') ?? cell.getAttribute('data-col'));
    expect(slots).toEqual(['lead', 'body', 'hide-sm', 'status', 'trail']);
    expect(within(bodyRows[1]).getByText('Needs VF-F01')).toBeInTheDocument();
  });

  it('omits the optional columns and supports h2 titles', () => {
    render(<DirectoryTable caption="Resources" titleAs="h2" columns={{ lead: 'Type', title: 'Resource', cta: 'Open' }} rows={[rows[0]]} />);
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Type', 'Resource', 'Open']);
    expect(screen.getByRole('heading', { level: 2, name: 'Robotics 101' })).toBeInTheDocument();
    expect(document.querySelector('td[data-slot="status"]')).toBeNull();
  });

  it('stacks rows with grid areas instead of order', () => {
    const css = readFileSync('src/features/workspace-ui/workspace.css', 'utf8');
    const stacked = css.slice(css.indexOf('.vf-spec[data-stack] thead'), css.indexOf('.vf-spec-dense'));
    expect(stacked).toContain('grid-template-areas: "lead status" "body body" "meter meter" "trail trail"');
    for (const slot of ['lead', 'status', 'body', 'meter', 'trail']) expect(stacked).toContain(`td[data-slot="${slot}"] { grid-area: ${slot};`);
    expect(stacked).not.toMatch(/[\s;{]order:/);
    expect(stacked).toContain('.vf-spec[data-stack]:not(:has(td[data-slot="status"])) td[data-slot="trail"] { grid-area: status;');
  });
});

describe('DirectoryPagination', () => {
  it('renders nothing on a single page', () => {
    const { container } = render(wrap(<DirectoryPagination page={1} pageSize={50} total={50} href={page => `/app/resources?page=${page}`} />));
    expect(container).toBeEmptyDOMElement();
  });

  it('links to the neighbouring pages with a mono summary', () => {
    render(wrap(<DirectoryPagination page={2} pageSize={50} total={120} href={page => `/app/resources?type=guide&page=${page}`} />));
    const nav = screen.getByRole('navigation', { name: 'Result pages' });
    expect(within(nav).getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/app/resources?type=guide&page=1');
    expect(within(nav).getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/app/resources?type=guide&page=3');
    expect(within(nav).getByText('Page 2 of 3')).toHaveClass('vf-meta');
  });

  it('has no previous link on the first page and no next link on the last', () => {
    const view = render(wrap(<DirectoryPagination page={1} pageSize={50} total={120} href={page => `?page=${page}`} />));
    expect(screen.queryByRole('link', { name: /Previous/ })).toBeNull();
    view.rerender(wrap(<DirectoryPagination page={9} pageSize={50} total={120} href={page => `?page=${page}`} />));
    expect(screen.queryByRole('link', { name: /Next/ })).toBeNull();
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('moves focus to the results header after a page change, even when the activated link is gone', () => {
    const pager = (page: number) => wrap(<>
      <p id="results" tabIndex={-1}>120 resources</p>
      <DirectoryPagination page={page} pageSize={50} total={120} href={next => `/app/resources?page=${next}`} resultsId="results" />
    </>);
    window.history.replaceState({}, '', '/app/resources?page=2');
    const view = render(pager(2));
    const next = screen.getByRole('link', { name: /Next/ });
    next.focus();
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    window.addEventListener('click', stopNavigation);
    fireEvent.click(next);
    window.removeEventListener('click', stopNavigation);
    // Same tree, new page (no remount): the last page has no Next link to hold focus.
    window.history.replaceState({}, '', '/app/resources?page=3');
    view.rerender(pager(3));
    expect(screen.queryByRole('link', { name: /Next/ })).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('results'));
  });

  it('does not move focus on an ordinary visit to a paged URL', () => {
    window.history.replaceState({}, '', '/app/resources?page=2');
    render(wrap(<>
      <p id="results" tabIndex={-1}>120 resources</p>
      <DirectoryPagination page={2} pageSize={50} total={120} href={next => `/app/resources?page=${next}`} resultsId="results" />
    </>));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('ResultsHeader and DirectoryPage', () => {
  it('renders the count as a focus target and removable chips', () => {
    render(<ResultsHeader id="resource-results" count="2 resources" chipsLabel="Active filters" removeLabel={label => `Remove filter ${label}`} chips={[{ key: 'type', label: 'Guide', href: '/app/resources?page=1' }]} />);
    const count = screen.getByText('2 resources');
    expect(count).toHaveAttribute('id', 'resource-results');
    expect(count).toHaveAttribute('tabindex', '-1');
    expect(count).toHaveAttribute('aria-live', 'polite');
    const list = screen.getByRole('list', { name: 'Active filters' });
    expect(within(list).getByRole('link', { name: 'Remove filter Guide' })).toHaveAttribute('href', '/app/resources?page=1');
  });

  it('shows the empty state instead of the list and pager', () => {
    const results = { id: 'r', count: '0 courses', chipsLabel: 'Active filters', removeLabel: (label: string) => label };
    const pagination = { page: 1, pageSize: 1, total: 3, href: (page: number) => `?page=${page}` };
    const view = render(wrap(<DirectoryPage header={<h1>Courses</h1>} results={results} empty={<p>Nothing here</p>} pagination={pagination}><p>list</p></DirectoryPage>));
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByText('list')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
    view.rerender(wrap(<DirectoryPage header={<h1>Courses</h1>} results={results} pagination={pagination} filters={{ label: 'Course filters', summary: 'Filters', fields: [levelField()], stateKey: '', activeCount: 0, clearHref: '/app/courses' }}><p>list</p></DirectoryPage>));
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Result pages' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '0 courses' })).toBeInTheDocument();
  });

  it('keeps the count live only when no filter bar moves focus to it', () => {
    const results = { id: 'r', count: '2 courses', chipsLabel: 'Active filters', removeLabel: (label: string) => label };
    const filters = { label: 'Course filters', summary: 'Filters', fields: [levelField()], stateKey: '', activeCount: 0, clearHref: '/app/courses' };
    const view = render(wrap(<DirectoryPage header={<h1>Courses</h1>} results={results}><p>list</p></DirectoryPage>));
    expect(document.getElementById('r')).toHaveAttribute('aria-live', 'polite');
    view.rerender(wrap(<DirectoryPage header={<h1>Courses</h1>} results={results} filters={filters}><p>list</p></DirectoryPage>));
    expect(document.getElementById('r')).not.toHaveAttribute('aria-live');
    view.rerender(wrap(<DirectoryPage header={<h1>Courses</h1>} results={{ ...results, live: true }} filters={filters}><p>list</p></DirectoryPage>));
    expect(document.getElementById('r')).toHaveAttribute('aria-live', 'polite');
  });

  it('hands focus to the results header after a chip link, even when the page remounts the bar', () => {
    const page = (level?: string) => wrap(<DirectoryPage
      header={<h1>Courses</h1>}
      filters={{ label: 'Course filters', summary: 'Filters', fields: [levelField(level)], stateKey: level ? `level=${level}` : '', activeCount: level ? 1 : 0, clearHref: '/app/courses' }}
      results={{ id: 'r', count: '2 courses', chipsLabel: 'Active filters', removeLabel: label => `Remove filter ${label}`, chips: level ? [{ key: 'level', label: 'Foundation', href: '/app/courses' }] : [] }}
    ><p>list</p></DirectoryPage>);
    const stayOnPage = () => document.addEventListener('click', event => event.preventDefault(), { once: true });

    // A modified click opens a new tab: nothing is handed off.
    window.history.replaceState({}, '', '/app/courses?level=foundation');
    let view = render(page('foundation'));
    stayOnPage();
    fireEvent.click(screen.getByRole('link', { name: 'Remove filter Foundation' }), { metaKey: true });
    view.unmount();
    window.history.replaceState({}, '', '/app/courses');
    view = render(page());
    expect(document.activeElement).not.toBe(document.getElementById('r'));
    view.unmount();

    window.history.replaceState({}, '', '/app/courses?level=foundation');
    view = render(page('foundation'));
    stayOnPage();
    fireEvent.click(screen.getByRole('link', { name: 'Remove filter Foundation' }));
    view.unmount();
    window.history.replaceState({}, '', '/app/courses');
    render(page());
    expect(document.activeElement).toBe(document.getElementById('r'));
  });

  it('treats empty={false} as a non-empty list', () => {
    const results = { id: 'r', count: '2 courses', chipsLabel: 'Active filters', removeLabel: (label: string) => label };
    const rowsShown = 2 as number;
    render(wrap(<DirectoryPage header={<h1>Courses</h1>} results={results} empty={rowsShown === 0 && <p>Nothing here</p>}><p>list</p></DirectoryPage>));
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).toBeNull();
  });
});

describe('filter chip builders', () => {
  const echo = (key: string) => `[${key}]`;

  it('ports the resource and opportunity chips unchanged', () => {
    expect(resourceFilterChips({ search: 'robot', type: 'guide', page: 3 }, echo)).toEqual([
      { key: 'search', label: '[search]: robot', href: '/app/resources?type=guide&page=1' },
      { key: 'type', label: '[types.guide]', href: '/app/resources?search=robot&page=1' },
    ]);
    expect(opportunityFilterChips({ featured: false }, echo)).toEqual([
      { key: 'featured', label: '[notFeatured]', href: '/app/opportunities?page=1' },
    ]);
    expect(opportunityFilterChips({ type: 'hackathon', openNow: true }, echo).map(chip => chip.key)).toEqual(['type', 'openNow']);
  });

  it('builds catalog chips that keep the tab', () => {
    const enums = createTranslator({ locale: 'en', messages: en, namespace: 'learner.enums' }) as unknown as (key: string) => string;
    expect(catalogFilterChips({ level: 'foundation', language: 'vi' }, 'discover', enums)).toEqual([
      { key: 'level', label: 'Foundation', href: '/app/courses?tab=discover&language=vi' },
      { key: 'language', label: 'Vietnamese', href: '/app/courses?tab=discover&level=foundation' },
    ]);
    expect(catalogFilterChips({}, 'learning', enums)).toEqual([]);
  });

  it('builds project chips with resolved names', () => {
    const build = createTranslator({ locale: 'en', messages: en, namespace: 'build' }) as unknown as (key: string) => string;
    const chips = projectFilterChips({ status: 'active', skill: 'data-literacy', course: 'ai-101' }, build, { skills: new Map([['data-literacy', 'Data literacy']]) });
    expect(chips.map(chip => chip.label)).toEqual([build('status.active'), 'Skill: Data literacy', 'Course: ai-101']);
    expect(chips[0].href).toBe('/app/projects?skill=data-literacy&course=ai-101');
  });
});

describe('DetailPage', () => {
  it('renders the split areas with an aside and an action panel', () => {
    render(<DetailPage header={<h1>Robotics grant</h1>} action={{ title: 'Next step', body: <p>Apply by Friday.</p>, status: { tone: 'signal', label: 'Open' }, action: <a href="/apply" className="vf-btn">Apply</a>, note: 'Closes 30.09.2026 ICT' }} aside={<p>Tags</p>}><p>Body</p></DetailPage>);
    const article = screen.getByRole('article');
    expect(article).toHaveClass('vf-l-frame', 'vf-l-split');
    expect(article).toHaveAttribute('data-aside', '');
    expect([...article.children].map(child => child.getAttribute('data-area'))).toEqual(['head', 'action', 'main', 'aside']);
    const panel = screen.getByRole('region', { name: 'Next step' });
    expect(panel).toHaveClass('vf-l-action');
    expect(within(panel).getByRole('link', { name: 'Apply' })).toBeInTheDocument();
    expect(within(panel).getByText('Open')).toHaveClass('vf-tag');
  });

  it('sets data-aside only with an aside or an action', () => {
    const view = render(<DetailPage header={<h1>Guide</h1>}><p>Body</p></DetailPage>);
    let article = screen.getByRole('article');
    expect(article).not.toHaveAttribute('data-aside');
    expect([...article.children].map(child => child.getAttribute('data-area'))).toEqual(['head', 'main']);
    view.rerender(<DetailPage header={<h1>Guide</h1>} aside={<p>Files</p>}><p>Body</p></DetailPage>);
    article = screen.getByRole('article');
    expect(article).toHaveAttribute('data-aside', '');
    expect([...article.children].map(child => child.getAttribute('data-area'))).toEqual(['head', 'main', 'aside']);
  });

  it('labels a standalone ActionPanel by its title id', () => {
    render(<ActionPanel title="Interest" titleId="interest-title" action={<button type="button">I am interested</button>} />);
    expect(screen.getByRole('region', { name: 'Interest' })).toHaveAttribute('aria-labelledby', 'interest-title');
  });
});
