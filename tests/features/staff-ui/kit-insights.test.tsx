// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Users } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import {
  ActivityFeed,
  actorInitials,
  ChartCard,
  FileGrid,
  PipelineStrip,
  ReadinessCard,
  SectionCard,
  StatCard,
  StatGrid,
  TimelineCard,
  type FileGridItem,
} from '@/features/staff-ui/components/insights';
import AreaTrendChart from '@/features/staff-ui/components/charts/AreaTrendChart';
import BarBreakdownChart from '@/features/staff-ui/components/charts/BarBreakdownChart';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { chartNumberFormat, chartNumberLocale, ChartContainer, ChartStyle, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

// next/dynamic resolves the chart body after hydration; here it stays on the loading skeleton,
// which is exactly what a first paint shows.
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => ReactNode }) => function DynamicChart() { return options.loading(); },
}));

// jsdom never reports a size, so the real ResponsiveContainer would hold its children back;
// a pass-through lets the tooltip content render inside the chart context.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="responsive-container">{children}</div> };
});

const enMessages = staffUiTestMessages(en, 'en');
const viMessages = staffUiTestMessages(vi_, 'vi');
const COMPONENTS = join(process.cwd(), 'src/features/staff-ui/components');

function renderEn(ui: ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">{ui}</NextIntlClientProvider>);
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe('StatGrid and StatCard', () => {
  it('renders a description list with one dt/dd pair per card', () => {
    const { container } = renderEn(<StatGrid>
      <StatCard label="Learners" value={1234} icon={Users} hint="Active this term" />
      <StatCard label="Courses" value={12} />
    </StatGrid>);
    const list = container.querySelector('dl')!;
    // Two columns even on phones (KPI values are short); four from xl, three when there are three cards.
    expect(list).toHaveClass('grid-cols-2', 'xl:grid-cols-4');
    expect(list.querySelectorAll('dt')).toHaveLength(2);
    expect(list.querySelectorAll('dd')).toHaveLength(2);
    // dl children are the card wrappers, each holding only its own dt and dd as direct children.
    for (const card of Array.from(list.children)) {
      expect(card.tagName).toBe('DIV');
      expect(Array.from(card.children).map((child) => child.tagName)).toEqual(['DT', 'DD']);
    }
    for (const item of Array.from(list.querySelectorAll('dt, dd'))) {
      expect(item.parentElement?.tagName).toBe('DIV');
      expect(item.parentElement?.parentElement).toBe(list);
    }
    expect(screen.getByText('Learners').closest('dt')).not.toBeNull();
    const value = screen.getByText('1,234');
    expect(value.closest('dd')).not.toBeNull();
    expect(value).toHaveClass('tabular-nums', 'text-2xl', 'font-bold');
    expect(screen.getByText('Active this term')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-users')?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders no delta unless one is provided', () => {
    const { container } = renderEn(<StatGrid><StatCard label="Learners" value={40} /></StatGrid>);
    expect(container.querySelector('[data-slot="stat-delta"]')).toBeNull();
  });

  it('colours a delta by its sign and says the direction to screen readers', () => {
    const { container } = renderEn(<StatGrid>
      <StatCard label="Completions" value={120} delta={{ value: 12.5, unit: '%', label: 'vs previous 30 days' }} />
      <StatCard label="Attempts" value={80} delta={{ value: -4 }} />
      <StatCard label="Waiting to grade" value={9} delta={{ value: -3, goodDirection: 'down' }} />
      <StatCard label="Reviews" value={5} delta={{ value: 0 }} />
    </StatGrid>);
    const deltas = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="stat-delta"]'));
    expect(deltas.map((delta) => delta.dataset.direction)).toEqual(['up', 'down', 'down', 'flat']);
    expect(deltas[0]).toHaveTextContent('+12.5%');
    expect(within(deltas[0]).getByText('Up 12.5%')).toHaveClass('sr-only');
    expect(within(deltas[0]).getByText('vs previous 30 days')).toBeInTheDocument();
    expect(deltas[0].firstElementChild).toHaveClass('text-success-foreground');
    expect(deltas[1]).toHaveTextContent('−4');
    expect(deltas[1].firstElementChild).toHaveClass('text-destructive');
    expect(deltas[2].firstElementChild).toHaveClass('text-success-foreground');
    expect(deltas[3]).toHaveTextContent('No change');
    expect(deltas[3].firstElementChild).toHaveClass('text-muted-foreground');
  });

  it('says Unavailable instead of 0 and drops the delta when the read failed', () => {
    const { container } = renderEn(<StatGrid>
      <StatCard label="Learners" value={null} />
      <StatCard label="Courses" value={0} state="unavailable" delta={{ value: 3 }} />
    </StatGrid>);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(container.querySelector('dl')).not.toHaveTextContent('0');
    expect(container.querySelector('[data-slot="stat-delta"]')).toBeNull();
    expect(container.querySelectorAll('[data-state="unavailable"]')).toHaveLength(2);
  });

  it('translates the unavailable label and accepts an override', () => {
    render(<NextIntlClientProvider locale="vi" messages={viMessages} timeZone="UTC">
      <StatGrid><StatCard label="Học viên" /><StatCard label="Khoá học" value={null} unavailableLabel="Không có quyền" /></StatGrid>
    </NextIntlClientProvider>);
    expect(screen.getByText('Không khả dụng')).toBeInTheDocument();
    expect(screen.getByText('Không có quyền')).toBeInTheDocument();
  });

  it('turns the whole card into one focusable link when given an href', () => {
    const { container } = renderEn(<StatGrid><StatCard label="Pending reviews" value={7} href="/studio/reviews" /></StatGrid>);
    const link = screen.getByRole('link', { name: 'Pending reviews' });
    expect(link).toHaveAttribute('href', '/studio/reviews');
    expect(link.className).toContain('after:absolute');
    link.focus();
    expect(link).toHaveFocus();
    expect(container.querySelector('[data-slot="stat-card"]')!.className).toContain('has-[a:focus-visible]:ring-2');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('PipelineStrip', () => {
  it('keeps stage order in an ordered list with tabular counts', () => {
    renderEn(<PipelineStrip title="Review pipeline" stages={[
      { key: 'draft', label: 'Draft', count: 4, tone: 'neutral' },
      { key: 'pending', label: 'Pending review', count: 1200, tone: 'warning', href: '/studio/reviews?status=pending' },
      { key: 'changes', label: 'Changes requested', count: 2, tone: 'danger' },
      { key: 'approved', label: 'Approved', count: null, tone: 'success' },
    ]} />);
    const list = screen.getByRole('list', { name: 'Review pipeline' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.dataset.stage)).toEqual(['draft', 'pending', 'changes', 'approved']);
    expect(items[0]).toHaveTextContent('4Draft');
    expect(within(items[1]).getByText('1,200')).toHaveClass('tabular-nums');
    expect(within(items[1]).getByRole('link')).toHaveAttribute('href', '/studio/reviews?status=pending');
    expect(items[3]).toHaveTextContent('Unavailable');
    expect(items[3]).not.toHaveTextContent('0');
    expect(screen.getByRole('region', { name: 'Review pipeline' })).toBeInTheDocument();
  });

  it('names the list even without a title', () => {
    renderEn(<PipelineStrip stages={[{ key: 'a', label: 'Waiting', count: 1 }]} />);
    expect(screen.getByRole('list', { name: 'Pipeline' })).toBeInTheDocument();
  });
});

describe('ActivityFeed', () => {
  const now = new Date('2026-09-24T12:00:00Z');

  it('shows who did what with a machine-readable time and an absolute title', () => {
    renderEn(<ActivityFeed now={now} footerHref="/admin/audit" items={[
      { id: '1', actor: { name: 'Nguyễn Hà An' }, action: 'Content published', target: 'Fractions 101', href: '/studio/courses/c1', at: '2026-09-24T10:00:00Z' },
      { id: '2', actor: { name: 'Lan' }, action: 'Role granted', at: 'not a date' },
    ]} />);
    const region = screen.getByRole('region', { name: 'Recent activity' });
    const items = within(region).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Nguyễn Hà An Content published Fractions 101');
    expect(within(items[0]).getByRole('link', { name: 'Fractions 101' })).toHaveAttribute('href', '/studio/courses/c1');
    expect(within(items[0]).getByText('NA')).toBeInTheDocument();
    const time = items[0].querySelector('time')!;
    expect(time).toHaveAttribute('dateTime', '2026-09-24T10:00:00Z');
    expect(time).toHaveTextContent('2 hours ago');
    expect(time.getAttribute('title')).toMatch(/2026/);
    // A bad timestamp is dropped instead of rendering "Invalid Date".
    expect(items[1].querySelector('time')).toBeNull();
    expect(items[1]).not.toHaveTextContent('Invalid');
    expect(within(region).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/admin/audit');
  });

  it('shows an empty state', () => {
    renderEn(<ActivityFeed items={[]} title="Audit" emptyLabel="Nothing logged" />);
    expect(screen.getByRole('region', { name: 'Audit' })).toHaveTextContent('Nothing logged');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('builds initials from the first and last word', () => {
    expect(actorInitials('Nguyễn Hà An')).toBe('NA');
    expect(actorInitials('  ánh ')).toBe('Á');
    expect(actorInitials('')).toBe('?');
  });
});

describe('TimelineCard', () => {
  it('lists events in order with a state pill, time and actor', () => {
    renderEn(<TimelineCard title="Review history" items={[
      { id: 'a', title: 'Submitted for review', status: { tone: 'info', label: 'In progress' }, at: '2026-09-20T08:30:00Z', actor: 'Lan' },
      { id: 'b', title: 'Approved', status: { tone: 'success', label: 'Completed' }, description: 'Looks good', at: 'bad' },
    ]} />);
    const list = screen.getByRole('region', { name: 'Review history' }).querySelector('ol')!;
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('In progress')).toHaveAttribute('data-slot', 'badge');
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', '2026-09-20T08:30:00Z');
    expect(items[0]).toHaveTextContent('by Lan');
    expect(items[1].querySelector('time')).toBeNull();
    expect(items[1]).toHaveTextContent('Looks good');
  });

  it('shows an empty state', () => {
    renderEn(<TimelineCard items={[]} />);
    expect(screen.getByRole('region', { name: 'History' })).toHaveTextContent('No events yet.');
  });
});

describe('ReadinessCard', () => {
  it('reports n/total through the progressbar and labels every check', () => {
    renderEn(<ReadinessCard title="Publish readiness" items={[
      { id: 'outcomes', label: 'Learning outcomes', status: 'pass' },
      { id: 'answers', label: 'Answer keys', status: 'fail', detail: '2 questions have no answer', href: '#answers' },
      { id: 'alt', label: 'Accessibility', status: 'warn' },
      { id: 'links', label: 'Links', status: 'pass' },
      { id: 'age', label: 'Age-appropriate', status: 'manual' },
    ]} />);
    const bar = screen.getByRole('progressbar', { name: 'Publish readiness' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 5 checks passing');
    expect(screen.getByText('2/5')).toBeInTheDocument();
    const answers = screen.getByRole('link', { name: 'Answer keys' });
    expect(answers).toHaveAttribute('href', '#answers');
    expect(answers.closest('li')).toHaveAttribute('data-status', 'fail');
    expect(answers.closest('p')).toHaveTextContent('Answer keys: Failing');
    expect(screen.getByText('2 questions have no answer')).toBeInTheDocument();
    expect(screen.getByText('Age-appropriate').closest('p')).toHaveTextContent('Check manually');
  });

  it('accepts explicit counts', () => {
    renderEn(<ReadinessCard items={[]} done={6} total={6} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
  });
});

describe('ChartCard', () => {
  const data = [
    { day: '2026-09-22', completions: 12, attempts: 4 },
    { day: '2026-09-23', completions: 1500, attempts: null },
  ];

  it('renders an accessible data table next to a fixed-height loading skeleton', () => {
    const { container } = renderEn(<ChartCard
      title="Learning activity, 30 days"
      description="UTC days"
      kind="area"
      data={data}
      categoryKey="day"
      categoryFormat="day"
      categoryLabel="Day"
      series={[{ key: 'completions', label: 'Lesson completions' }, { key: 'attempts', label: 'Attempts' }]}
      actions={<button type="button">Range</button>}
      height={200}
    />);
    const region = screen.getByRole('region', { name: 'Learning activity, 30 days' });
    expect(within(region).getByRole('button', { name: 'Range' })).toBeInTheDocument();
    const table = within(region).getByRole('table', { name: 'Learning activity, 30 days' });
    expect(table).toHaveClass('sr-only');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Day', 'Lesson completions', 'Attempts']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(['Sep 22124', 'Sep 231,500—']);
    const body = container.querySelector<HTMLElement>('[data-slot="chart-body"]')!;
    expect(body).toHaveAttribute('aria-hidden', 'true');
    expect(body.style.height).toBe('200px');
    expect(body.querySelector('[data-slot="chart-skeleton"]')).not.toBeNull();
  });

  it('says the data is unavailable instead of drawing an empty chart', () => {
    renderEn(<ChartCard title="Schools" kind="bar" data={data} categoryKey="day" series={[{ key: 'completions', label: 'Completions' }]} state="unavailable" />);
    expect(screen.getByText('Chart data could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an empty message when there are no rows', () => {
    renderEn(<ChartCard title="Schools" kind="bar" data={[]} categoryKey="name" series={[{ key: 'learners', label: 'Learners' }]} />);
    expect(screen.getByText('No data for this period yet.')).toBeInTheDocument();
  });

  it('never imports recharts statically; only the lazily loaded chart bodies do', () => {
    const card = readFileSync(join(COMPONENTS, 'ChartCard.tsx'), 'utf8');
    const staticImports = Array.from(card.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm), (match) => match[1]);
    expect(staticImports.some((source) => source === 'recharts' || source.includes('components/ui/chart') || source.includes('/charts/'))).toBe(false);
    expect(card).toMatch(/dynamic\(\(\) => import\('\.\/charts\/AreaTrendChart'\), \{ ssr: false/);
    expect(card).toMatch(/dynamic\(\(\) => import\('\.\/charts\/BarBreakdownChart'\), \{ ssr: false/);
    const barrel = readFileSync(join(COMPONENTS, 'insights.ts'), 'utf8');
    expect(barrel).not.toMatch(/from '\.\/charts\//);
    expect(barrel).not.toMatch(/recharts|components\/ui\/chart/);
    for (const body of ['AreaTrendChart.tsx', 'BarBreakdownChart.tsx']) {
      const source = readFileSync(join(COMPONENTS, 'charts', body), 'utf8');
      expect(source).toMatch(/from 'recharts'/);
      expect(source).toMatch(/import type \{ ChartBodyProps \} from '\.\.\/ChartCard'/);
    }
  });

  it('chart bodies render inside a chart container without crashing', () => {
    const rows = [{ label: 'Sep 22', completions: 12 }, { label: 'Sep 23', completions: 3 }];
    const series = [{ key: 'completions', label: 'Completions', color: 'var(--chart-1)' }];
    const { container, unmount } = render(<AreaTrendChart data={rows} series={series} locale="en" />);
    expect(container.querySelector('[data-slot="chart"]')).not.toBeNull();
    unmount();
    const bars = render(<BarBreakdownChart data={rows} series={series} locale="vi" orientation="rows" stacked />);
    expect(bars.container.querySelector('[data-slot="chart"]')).not.toBeNull();
  });
});

describe('SectionCard', () => {
  it('groups fields under a labelled section with a two-column grid and footer actions', () => {
    renderEn(<SectionCard title="Basics" description="Shown to learners" footer={<button type="button">Save</button>}>
      <label>Title<input /></label>
      <label>Code<input /></label>
    </SectionCard>);
    const region = screen.getByRole('region', { name: 'Basics' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Basics' })).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: 'Title' }).closest('.grid')).toHaveClass('md:grid-cols-2');
    expect(within(region).getByRole('button', { name: 'Save' }).parentElement).toHaveClass('justify-end', 'border-t');
  });

  it('supports a single column and h3 headings', () => {
    renderEn(<SectionCard title="Notes" columns={1} headingLevel={3}><p>Body</p></SectionCard>);
    expect(screen.getByRole('heading', { level: 3, name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByText('Body').parentElement).not.toHaveClass('md:grid-cols-2');
  });
});

describe('FileGrid', () => {
  const files: FileGridItem[] = [
    { id: 'f1', name: 'diagram.png', kind: 'image', thumbnailUrl: 'https://example.test/diagram.png', meta: 'PNG · 240 KB' },
    { id: 'f2', name: 'lesson.pdf', kind: 'pdf', status: { tone: 'warning', label: 'Unused' } },
    { id: 'f3', name: 'intro.mp4', kind: 'video' },
  ];

  it('selects tiles on its own and reports the selection', () => {
    const onSelectionChange = vi.fn();
    renderEn(<FileGrid items={files} selectable onSelectionChange={onSelectionChange} />);
    const list = screen.getByRole('list', { name: 'Files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select diagram.png' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select intro.mp4' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['f1', 'f3']);
    expect(screen.getByRole('checkbox', { name: 'Select diagram.png' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select diagram.png' }).closest('li')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('2 files selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select diagram.png' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['f3']);
    expect(screen.getByRole('status')).toHaveTextContent('1 file selected');
  });

  it('follows a controlled selection and opens a file', () => {
    const onOpen = vi.fn();
    const onSelectionChange = vi.fn();
    renderEn(<FileGrid items={files} view="list" selectable selectedIds={['f2']} onSelectionChange={onSelectionChange} onOpen={onOpen} />);
    expect(screen.getByRole('list', { name: 'Files' })).toHaveAttribute('data-view', 'list');
    expect(screen.getByRole('checkbox', { name: 'Select lesson.pdf' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select intro.mp4' }));
    expect(onSelectionChange).toHaveBeenCalledWith(['f2', 'f3']);
    // Controlled: nothing changes until the parent passes new ids.
    expect(screen.getByRole('checkbox', { name: 'Select intro.mp4' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Open lesson.pdf' }));
    expect(onOpen).toHaveBeenCalledWith(files[1]);
    expect(screen.getByText('Unused')).toHaveAttribute('data-slot', 'badge');
    expect(screen.getByText('PNG · 240 KB')).toBeInTheDocument();
    // Without meta, the tile names the file type instead.
    expect(within(screen.getByRole('button', { name: 'Open intro.mp4' })).getByText('Video')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Open lesson.pdf' })).getByText('PDF')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderEn(<FileGrid items={[]} />);
    expect(screen.getByText('No files yet.')).toBeInTheDocument();
  });
});

describe('StaffPageHeader restyle', () => {
  it('keeps the header hook, one h1 and the right-aligned actions', () => {
    renderEn(<div className="vf-staff"><StaffPageHeader title="Members" eyebrow="Admin" description="Everyone in this school" actions={<button type="button">Invite</button>} /></div>);
    const heading = screen.getByRole('heading', { level: 1, name: 'Members' });
    const header = heading.closest('header')!;
    expect(header).toHaveClass('staff-page-header', '[.vf-staff_&]:mb-6', '[.vf-staff_&]:justify-between', '[.vf-staff_&]:flex-wrap');
    expect(heading).toHaveClass('text-2xl', 'tracking-tight', '[.vf-staff_&]:font-bold', '[.vf-staff_&]:sm:text-2xl');
    expect(screen.getByText('Admin')).toHaveClass('[.vf-staff_&]:text-muted-foreground');
    expect(screen.getByText('Everyone in this school')).toHaveClass('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'Invite' }).parentElement).toHaveClass('flex-wrap', 'shrink-0');
  });
});

// Vietnamese diacritics (ỗ, ặ, Ấ) clip below line-height 1.4, so the kit never uses the tighter presets.
const TIGHT_LEADING = /\bleading-(none|tight|snug)\b/;

describe('chart primitives', () => {
  const tooltipPayload = [
    { dataKey: 'completions', name: 'completions', value: 1234.5, color: 'var(--chart-1)', payload: {} },
  ] as unknown as NonNullable<Parameters<typeof ChartTooltipContent>[0]['payload']>;
  const config: ChartConfig = { completions: { label: 'Lượt hoàn thành', color: 'var(--chart-1)' } };

  it('maps next-intl locales to the Intl locale charts format with', () => {
    expect(chartNumberLocale('vi')).toBe('vi-VN');
    expect(chartNumberLocale('en')).toBe('en-US');
    expect(chartNumberLocale(undefined)).toBe('en-US');
    expect(chartNumberFormat('vi').format(1234.5)).toBe('1.234,5');
    expect(chartNumberFormat('en').format(1234.5)).toBe('1,234.5');
    expect(chartNumberFormat('vi', { notation: 'compact', maximumFractionDigits: 1 }).format(1500)).toMatch(/^1,5\sN$/);
  });

  it.each([
    ['vi', '1.234,5'],
    ['en', '1,234.5'],
  ])('formats tooltip values for the %s locale in the sans face with tabular figures', (locale, expected) => {
    render(<ChartContainer config={config} locale={locale}>
      <ChartTooltipContent active payload={tooltipPayload} label="22 thg 9" />
    </ChartContainer>);
    const value = screen.getByText(expected);
    expect(value).toHaveClass('tabular-nums', 'font-medium');
    expect(value).not.toHaveClass('font-mono');
    expect(screen.getByText('Lượt hoàn thành')).toBeInTheDocument();
    const tooltip = value.closest('.grid.min-w-\\[8rem\\]')!;
    expect(tooltip).toHaveClass('leading-normal');
    expect(tooltip.innerHTML).not.toMatch(TIGHT_LEADING);
  });

  it('never formats with toLocaleString or a mono face', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/ui/chart.tsx'), 'utf8');
    expect(source).not.toMatch(/toLocaleString\(/);
    expect(source).not.toMatch(/font-mono/);
    expect(source).not.toMatch(TIGHT_LEADING);
    for (const body of ['AreaTrendChart.tsx', 'BarBreakdownChart.tsx']) {
      const chart = readFileSync(join(COMPONENTS, 'charts', body), 'utf8');
      expect(chart).toMatch(/chartNumberFormat\(locale, \{ notation: 'compact'/);
      expect(chart).toMatch(/<ChartContainer config=\{config\} locale=\{locale\}/);
      expect(chart).not.toMatch(/new Intl\.NumberFormat\(/);
    }
  });

  it('writes theme pairs for an OS-dark system theme and an explicit dark pin, like the staff tokens', () => {
    const { container } = render(<ChartStyle id="chart-t" config={{
      learners: { label: 'Learners', theme: { light: 'hsl(240 5.9% 10%)', dark: 'hsl(0 0% 98%)' } },
      bad: { label: 'Bad', color: 'red; } body { display: none' },
    }} />);
    const css = container.querySelector('style')!.innerHTML;
    expect(css).toContain('[data-chart=chart-t] {\n  --color-learners: hsl(240 5.9% 10%);\n}');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n:root:has\(\.vf-staff:not\(\[data-theme="light"\]\)\) \[data-chart=chart-t\] \{\n  --color-learners: hsl\(0 0% 98%\);\n\}\n\}/);
    expect(css).toContain(':root:has(.vf-staff[data-theme="dark"]) [data-chart=chart-t] {\n  --color-learners: hsl(0 0% 98%);\n}');
    // Light first, then the OS rule, then the explicit pin, so a pinned theme wins.
    expect(css.indexOf('--color-learners: hsl(240')).toBeLessThan(css.indexOf('prefers-color-scheme'));
    expect(css.indexOf('prefers-color-scheme')).toBeLessThan(css.indexOf('[data-theme="dark"]'));
    expect(css).not.toContain('display: none');
  });

  it('writes one rule for plain colours, which the token ramp already themes', () => {
    const { container } = render(<ChartStyle id="chart-p" config={config} />);
    const css = container.querySelector('style')!.innerHTML;
    expect(css).toBe('[data-chart=chart-p] {\n  --color-completions: var(--chart-1);\n}');
  });
});

describe('Vietnamese line heights', () => {
  it('keeps KPI, chart and page titles at line-height 1.4 or more', () => {
    const { container } = render(<NextIntlClientProvider locale="vi" messages={viMessages} timeZone="UTC">
      <div className="vf-staff">
        <StaffPageHeader title="Tổng quan học tập" eyebrow="Quản trị" description="Mọi người trong trường" />
        <StatGrid><StatCard label="Học viên hoạt động" value={1234} hint="Trong học kỳ này" delta={{ value: 3, label: 'so với 30 ngày trước' }} /></StatGrid>
        <ChartCard title="Hoạt động học tập" description="Ngày theo UTC" kind="bar" data={[{ name: 'Lớp 1', learners: 3 }]} categoryKey="name" series={[{ key: 'learners', label: 'Học viên' }]} />
      </div>
    </NextIntlClientProvider>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('[.vf-staff_&]:leading-[1.4]');
    expect(screen.getByText('Quản trị')).toHaveClass('[.vf-staff_&]:leading-normal');
    expect(screen.getByText('Học viên hoạt động').closest('dt')).toHaveClass('leading-normal');
    expect(screen.getByText('1.234')).toHaveClass('leading-[1.4]');
    expect(screen.getByText('Trong học kỳ này')).toHaveClass('leading-normal');
    expect(container.querySelector('[data-slot="stat-delta"]')).toHaveClass('leading-normal');
    expect(screen.getByRole('heading', { level: 2, name: 'Hoạt động học tập' })).toHaveClass('leading-normal');
    expect(screen.getByText('Ngày theo UTC')).toHaveClass('leading-normal');
    expect(container.innerHTML).not.toMatch(TIGHT_LEADING);
  });

  it('keeps tight leading presets out of the kit sources that render Vietnamese text', () => {
    const sources = [
      join(COMPONENTS, 'StatCard.tsx'),
      join(COMPONENTS, 'ChartCard.tsx'),
      join(COMPONENTS, 'charts', 'AreaTrendChart.tsx'),
      join(COMPONENTS, 'charts', 'BarBreakdownChart.tsx'),
      join(process.cwd(), 'src/features/workspace/ui/StaffPageHeader.tsx'),
    ];
    for (const file of sources) expect(readFileSync(file, 'utf8'), file).not.toMatch(TIGHT_LEADING);
  });
});
