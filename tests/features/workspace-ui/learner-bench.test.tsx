// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';

const mocks = vi.hoisted(() => ({
  pathname: '/app',
  push: vi.fn(),
  requireUser: vi.fn(),
  listCatalog: vi.fn(),
  getCourse: vi.fn(),
  readLearnerHome: vi.fn(),
}));

// The dashboard contract strings the page tests assert on ("Resume lesson", "Open exam").
const messages = withBenchMessages({ ...en, learner: { ...en.learner, home: { ...en.learner.home, resume: 'Resume lesson', openExam: 'Open exam' } } }, 'en');

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: mocks.push, refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async (namespace?: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never })),
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/features/catalog/service', () => ({ listCatalog: mocks.listCatalog, getCourse: mocks.getCourse }));
vi.mock('@/features/learner/summary', () => ({ readLearnerHome: mocks.readLearnerHome }));
vi.mock('@/features/me/service', () => ({ branchIdForUser: vi.fn() }));
vi.mock('@/features/skills/service', () => ({ passport: vi.fn(), SKILL_LEVELS: ['exposed', 'applied', 'demonstrated'] }));
vi.mock('@/features/xp/service', () => ({ weeklyLeaderboard: vi.fn() }));

import { AppShell } from '@/components/AppShell';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import LearnerErrorPage from '@/app/app/error';
import ExplorePage from '@/app/app/explore/page';
import LearnerCatalogPage from '@/app/app/courses/page';
import LearnerCoursePage from '@/app/app/courses/[courseId]/page';
import LearnerHomePage from '@/app/app/page';
import Loading from '@/app/app/loading';
import CoursesLoading from '@/app/app/courses/loading';
import CourseLoading from '@/app/app/courses/[courseId]/loading';
import ItemLoading from '@/app/app/courses/[courseId]/items/[itemId]/loading';
import OpportunitiesLoading from '@/app/app/opportunities/loading';
import OpportunityLoading from '@/app/app/opportunities/[id]/loading';
import ProjectsLoading from '@/app/app/projects/loading';
import ProjectLoading from '@/app/app/projects/[id]/loading';
import NewProjectLoading from '@/app/app/projects/new/loading';
import ResourcesLoading from '@/app/app/resources/loading';
import ResourceLoading from '@/app/app/resources/[id]/loading';
import { activityTrace } from '@/features/workspace-ui/learner/activity.server';
import { CatalogBenchView, type CatalogBenchCourse } from '@/features/workspace-ui/learner/CatalogBenchView';
import { buildDashboardData, LearnerDashboardBench } from '@/features/workspace-ui/learner/dashboard.server';
import { ExploreBenchView } from '@/features/workspace-ui/learner/ExploreBenchView';
import { LearnerDashboardView } from '@/features/workspace-ui/learner/LearnerDashboardView';
import { LearnerReadout } from '@/features/workspace-ui/learner/LearnerReadout';
import type { LearnerDashboardData } from '@/features/workspace-ui/learner/model';

const wrap = (children: React.ReactNode) => <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Ho_Chi_Minh">{children}</NextIntlClientProvider>;
const NOW = new Date('2026-09-24T14:14:00Z'); // Thursday, 21:14 ICT, ISO week 39

beforeEach(() => { mocks.requireUser.mockResolvedValue({ id: 'learner-1', email: 'avery@example.com' }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.pathname = '/app'; });

const dashboard = (overrides: Partial<LearnerDashboardData> = {}): LearnerDashboardData => ({
  now: NOW,
  name: 'Avery',
  state: 'resume',
  resume: { title: 'External interrupts', href: '/app/courses/emb/items/l-4-3', courseTitle: 'Embedded systems', part: 'VF-EMB-201', position: 'M4 · L4.3', minutes: 18, progress: { completed: 7, total: 12, band: null } },
  courses: [
    { id: 'emb', title: 'Embedded systems', part: 'VF-EMB-201', href: '/app/courses/emb', sub: '12 items · 180 min', progress: { completed: 7, total: 12 }, next: { code: 'L4.3', title: 'External interrupts', href: '/app/courses/emb/items/l-4-3' } },
    { id: 'py', title: 'Python for data', part: 'AI', href: '/app/courses/py', sub: '14 items', progress: null, next: null },
  ],
  exam: { title: 'Final exam', courseTitle: 'Python for data', part: 'AI', href: '/app/courses/py/items/exam', openAt: '2026-09-26T01:00:00Z', closeAt: '2026-09-27T01:00:00Z' },
  feedback: { title: 'Lab 3', courseTitle: 'Embedded systems', href: '/app/courses/emb/items/lab-3', decision: 'approved', message: 'Clean interrupt logic.', at: '2026-09-22T01:00:00Z' },
  completion: null,
  ...overrides,
});

describe('bench learner shell', () => {
  it('renders the section-coded bench bar while keeping every landmark and accessible name', () => {
    const { container } = render(wrap(<AppShell theme="dark"><h1>Home</h1></AppShell>));
    expect(container.querySelector('.vf-workspace')).toHaveAttribute('data-density', 'comfortable');
    expect(container.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    const nav = screen.getByRole('navigation', { name: en.common.learnerNavigation });
    expect(within(nav).getByRole('link', { name: 'Learning' })).toHaveAttribute('href', '/app');
    expect(within(nav).getByRole('link', { name: 'Learning' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/app/courses');
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/app/explore');
    expect(within(nav).getAllByText(/^A[123]$/).map(code => code.textContent)).toEqual(['A1', 'A2', 'A3']);
    expect(screen.getByRole('link', { name: en.learner.skipToContent })).toHaveAttribute('href', '#learner-main');
    expect(document.getElementById('learner-main')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('heading', { name: 'Home' })).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
  });

  it('offers the theme as radio items inside the account menu', () => {
    render(wrap(<AppShell theme="dark"><h1>Home</h1></AppShell>));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the account menu items and the mobile drawer contract', () => {
    render(wrap(<AppShell><h1>Home</h1></AppShell>));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menuitem', { name: 'XP' })).toHaveAttribute('href', '/app/profile#xp-heading');
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' }) as HTMLButtonElement;
    expect(signOut.form).toHaveAttribute('action', '/auth/signout');
    expect(signOut).toHaveAttribute('type', 'submit');
    // globals.css makes controls inherit their font, so the menu itself carries the item size.
    expect(screen.getByRole('menu')).toHaveClass('text-sm');
    fireEvent.keyDown(signOut, { key: 'Escape' });
    const trigger = screen.getByRole('button', { name: en.common.menu });
    expect(trigger).toHaveAttribute('aria-controls', 'learner-mobile-navigation');
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: en.common.learnerNavigation });
    expect(drawer).toHaveAttribute('id', 'learner-mobile-navigation');
    expect(within(drawer).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/app/courses');
    expect(within(drawer).getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    const language = within(drawer).getByRole('group', { name: en.common.language });
    expect(within(language).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(language).getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute('lang', 'vi');
    expect(language.compareDocumentPosition(within(drawer).getByRole('group', { name: 'Theme' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Each segmented group has a visible mono label above it that names it, and the 6px drawer segment.
    for (const group of [language, within(drawer).getByRole('group', { name: 'Theme' })]) {
      const label = document.getElementById(group.getAttribute('aria-labelledby')!);
      expect(label).toHaveClass('vf-label');
      expect(label).toBeVisible();
      expect(label!.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(group).not.toHaveAttribute('aria-label');
      expect(group).toHaveClass('vf-l-drawer-seg');
    }
    expect(within(drawer).getByRole('button', { name: 'Sign out' }).closest('.text-sm')).not.toBeNull();
  });

  it('shows the learner identity in the account trigger and menu label', () => {
    mocks.pathname = '/app/profile';
    render(wrap(<AppShell userName="Nguyễn An" initials="NA" handle="an-nguyen"><h1>Profile</h1></AppShell>));
    const trigger = screen.getByRole('button', { name: 'Nguyễn An' });
    expect(trigger).toHaveAttribute('data-active', 'true');
    expect(trigger.querySelector('.vf-l-account-initials')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger.querySelector('.vf-l-account-initials')).toHaveTextContent('NA');
    expect(trigger.querySelector('.vf-l-account-name')).toHaveTextContent('Nguyễn An');
    expect(screen.getByRole('button', { name: en.common.menu })).toHaveClass('min-[760px]:hidden');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('@an-nguyen')).toBeInTheDocument();
    const order = [
      within(menu).getByText('@an-nguyen'),
      within(menu).getByRole('menuitem', { name: 'Leaderboard' }),
      within(menu).getByRole('menuitemradio', { name: 'English' }),
      within(menu).getByRole('menuitemradio', { name: 'Dark' }),
      within(menu).getByRole('menuitem', { name: 'Sign out' }),
    ];
    order.slice(1).forEach((node, index) => expect(order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.queryByRole('combobox', { name: en.common.language })).toBeNull();
  });

  it('leaves the account trigger unmarked outside profile and leaderboard', () => {
    mocks.pathname = '/app/courses';
    render(wrap(<AppShell userName="Avery" initials="A"><h1>Courses</h1></AppShell>));
    expect(screen.getByRole('button', { name: 'Avery' })).not.toHaveAttribute('data-active');
  });

  it('saves the language from the account menu and keeps a failure visible', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(wrap(<AppShell><h1>Home</h1></AppShell>));
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
      expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('menuitemradio', { name: 'Tiếng Việt' })).toHaveAttribute('lang', 'vi');
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tiếng Việt' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/profile/locale', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale: 'vi' }) })));
      expect(await screen.findByRole('alert')).toHaveTextContent(en.locale.updateError);
      expect(screen.getByRole('menu')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('jumps between sections with g then 1/2/3, but never while typing', async () => {
    render(wrap(<AppShell><h1>Home</h1><input aria-label="Search" /></AppShell>));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith('/app/courses'));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: '3' });
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith('/app/explore'));
    mocks.push.mockClear();
    fireEvent.keyDown(window, { key: '1' });
    const input = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.keyDown(input, { key: 'g' });
    fireEvent.keyDown(input, { key: '1' });
    fireEvent.keyDown(window, { key: 'g', metaKey: true });
    fireEvent.keyDown(window, { key: '1' });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps a pending g across a re-render, and ignores the shortcut while a modal has focus', async () => {
    const shell = (children: React.ReactNode) => wrap(<AppShell><h1>Home</h1>{children}</AppShell>);
    const view = render(shell(<p>First render</p>));
    fireEvent.keyDown(window, { key: 'g' });
    // A re-render between the prefix and the digit (new children, a new router object in this mock).
    view.rerender(shell(<p>Second render</p>));
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith('/app/courses'));

    mocks.push.mockClear();
    view.rerender(shell(<div role="dialog" aria-modal="true" aria-label="Confirm"><button type="button">Stay</button></div>));
    screen.getByRole('button', { name: 'Stay' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'g' });
    fireEvent.keyDown(document.activeElement!, { key: '3' });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('asks the navigation guard before a g-shortcut pushes, and stays put when it refuses', async () => {
    const calls: string[] = [];
    let allow = false;
    const unregister = registerNavigationGuard(async () => { calls.push('guard'); return allow; });
    mocks.push.mockImplementation(() => { calls.push('push'); });
    try {
      render(wrap(<AppShell><h1>Home</h1></AppShell>));
      fireEvent.keyDown(window, { key: 'g' });
      fireEvent.keyDown(window, { key: '2' });
      await waitFor(() => expect(calls).toEqual(['guard']));
      await act(async () => { await Promise.resolve(); });
      expect(mocks.push).not.toHaveBeenCalled();

      allow = true;
      fireEvent.keyDown(window, { key: 'g' });
      fireEvent.keyDown(window, { key: '3' });
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/explore'));
      expect(calls).toEqual(['guard', 'guard', 'push']);
    } finally {
      unregister();
      mocks.push.mockReset();
    }
  });

  it('keeps focus routes free of the bench bar, and leaves breadcrumbs to the page (DESIGN D3)', async () => {
    mocks.pathname = '/app/courses/ai/items/lesson-1';
    const focus = render(wrap(<AppShell><h1>Lesson</h1></AppShell>));
    expect(screen.queryByRole('navigation', { name: en.common.learnerNavigation })).toBeNull();
    expect(screen.queryByRole('navigation', { name: en.common.breadcrumbs })).toBeNull();
    focus.unmount();

    mocks.pathname = '/app/courses/ai';
    const bare = render(wrap(<AppShell><h1>AI Foundations</h1></AppShell>));
    expect(screen.queryByRole('navigation', { name: en.common.breadcrumbs })).toBeNull();
    bare.unmount();

    mocks.getCourse.mockResolvedValue({
      id: 'ai', meta: { title: 'AI Foundations', summary: 'Start here.', pathway: 'ai-emerging-technology', code: 'VF-AI-101', learningOutcomes: [] },
      enrollment: null, skills: [], completion: { requirements: [] }, progress: { completedItems: 0, totalItems: 0 }, outline: { modules: [] },
    });
    const page = await LearnerCoursePage({ params: Promise.resolve({ courseId: 'ai' }), searchParams: Promise.resolve({ tab: 'discover' }) });
    render(wrap(<AppShell>{page}</AppShell>));
    const crumbs = screen.getAllByRole('navigation', { name: en.common.breadcrumbs });
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].closest('.vf-page-head')).toBeInTheDocument();
    expect(crumbs[0].querySelector('ol')).toHaveClass('vf-crumbs');
    expect(within(crumbs[0]).getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/app/courses?tab=discover');
    expect(within(crumbs[0]).getByText('AI Foundations')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('VF-AI-101 · AI & Emerging Technology')).toBeInTheDocument();
  });
});

describe('bench learner dashboard', () => {
  it('anchors on the current lesson as the h1 and keeps every dashboard contract', () => {
    const readout = <LearnerReadout locale="en" deadline={null} xp={{ ok: true, value: { week: 140, previous: 100, values: [0, 10, 0, 40, 0, 0, 20, 0, 0, 30, 0, 40, 30, 40] } }} rank={{ ok: true, value: { rank: 23, total: 142 } }} skills={{ ok: true, value: [{ id: 'c', name: 'Embedded C', level: 3, levelKey: 'demonstrated' }] }} />;
    render(wrap(<AppShell><LearnerDashboardView data={dashboard()} trace={<p>trace</p>} readout={readout} /></AppShell>));
    const resume = screen.getByRole('region', { name: 'Continue learning' });
    expect(document.querySelector('#learner-main h1')).toHaveTextContent('External interrupts');
    expect(within(resume).getByRole('heading', { level: 1 })).toHaveTextContent('External interrupts');
    expect(resume).toHaveTextContent('Hi Avery');
    expect(resume).toHaveTextContent('WK 39');
    expect(resume).toHaveTextContent('24.09.2026');
    expect(resume).toHaveTextContent('21:14 ICT');
    expect(resume).toHaveTextContent('Opens T−1d 10h');
    expect(within(resume).getByRole('img', { name: 'Embedded systems: 7 of 12 items complete, 58%' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume lesson' })).toHaveAttribute('href', '/app/courses/emb/items/l-4-3');
    const active = screen.getByRole('region', { name: 'Active courses' });
    expect(active).toHaveAttribute('aria-labelledby', 'active-courses-heading');
    expect(active.querySelector('table.vf-spec[data-stack]')).toBeInTheDocument();
    expect(within(active).getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(within(active).queryByRole('columnheader', { name: 'Depends on' })).toBeNull();
    expect(within(active).getByRole('link', { name: 'Next: External interrupts' })).toHaveAttribute('href', '/app/courses/emb/items/l-4-3');
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/app/courses?tab=learning');
    expect(screen.getByRole('link', { name: 'Open exam' })).toHaveAttribute('href', '/app/courses/py/items/exam');
    expect(screen.getByRole('link', { name: 'Open feedback' })).toHaveAttribute('href', '/app/courses/emb/items/lab-3');
    expect(screen.getByText('Clean interrupt logic.').closest('blockquote')).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'Readout' });
    expect(aside).toHaveTextContent('140');
    expect(within(aside).getByText('▲ 40')).toBeInTheDocument();
    expect(within(aside).getByRole('img', { name: /XP per day over the last 14 days: 210 in total/ })).toBeInTheDocument();
    expect(within(aside).getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/app/leaderboard?scope=branch');
    expect(within(aside).getByRole('img', { name: 'Embedded C: level 3 of 3, demonstrated' })).toBeInTheDocument();
  });

  it('renders first run, the completion strip and per-cell readout faults', () => {
    render(wrap(<LearnerDashboardView data={dashboard({ state: 'first-run', resume: null, courses: [], exam: null, feedback: null, completion: { courseTitle: 'Embedded systems', part: 'VF-EMB-201' } })}
      readout={<LearnerReadout locale="en" deadline={null} xp={{ ok: false }} rank={{ ok: true, value: { rank: null, reason: 'no-xp' } }} skills={{ ok: true, value: [] }} />} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start your first course');
    expect(screen.getByRole('link', { name: 'Browse courses' })).toHaveAttribute('href', '/app/courses?tab=discover');
    expect(screen.queryByRole('region', { name: 'Active courses' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open feedback' })).toBeNull();
    expect(screen.getByRole('link', { name: 'View certificate' })).toHaveAttribute('href', '/app/profile#certificates-heading');
    expect(screen.getByText('VF-EMB-201 Embedded systems calibrated · certificate issued')).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'Readout' });
    expect(aside).toHaveTextContent('XP · this week unavailable');
    expect(aside).toHaveTextContent('Earn XP to enter');
    expect(aside).toHaveTextContent('None scheduled');
    expect(aside).toHaveTextContent('No skill evidence yet');
  });

  it('builds the resume anchor, progress and next items from the existing loaders', async () => {
    const summary = {
      rewards: { profile: { displayName: 'Avery', handle: 'avery' }, certificates: [{ id: 'cert', courseId: 'done', courseTitle: 'Done course', issuedAt: '2026-09-21T01:00:00Z' }] },
      continueLearning: { courseId: 'emb', courseTitle: 'Embedded systems', itemId: 'l-2', itemTitle: 'Timers', kind: 'lesson' },
      nextRequired: null,
      upcomingExam: { courseId: 'emb', courseTitle: 'Embedded systems', itemId: 'exam', itemTitle: 'Final exam', kind: 'exam', openAt: null, closeAt: '2026-09-30T01:00:00Z' },
      feedback: null,
    };
    const catalog = [
      { id: 'emb', title: 'Embedded systems', code: 'VF-EMB-201', pathway: 'ai-emerging-technology', level: 'foundation', estimatedMinutes: 180, enrollment: { status: 'active' } },
      { id: 'done', title: 'Done course', pathway: 'fintech-economics', level: 'foundation', enrollment: { status: 'completed' } },
    ];
    mocks.getCourse.mockResolvedValue({
      id: 'emb',
      enrollment: { enrolledAt: '2026-09-14T01:00:00Z' },
      progress: { completedItems: 1, totalItems: 4 },
      outline: { modules: [{ id: 'm1', title: 'M1', items: [
        { id: 'l-1', type: 'lesson', title: 'Intro', required: true, status: 'completed' },
        { id: 'l-2', type: 'lesson', title: 'Timers', required: true, status: 'in_progress', estimatedMinutes: 18 },
        { id: 'exam', type: 'exam', title: 'Final exam', required: true, status: 'not_started' },
      ] }] },
    });
    const data = await buildDashboardData({ actor: { userId: 'learner-1', roles: [] }, locale: 'en', summary: summary as never, catalog: catalog as never, name: 'Avery', now: NOW });
    expect(data.state).toBe('resume');
    expect(data.resume).toMatchObject({ title: 'Timers', part: 'VF-EMB-201', position: 'M1 · L1.2', minutes: 18, progress: { completed: 1, total: 4, due: '2026-09-30T01:00:00Z' } });
    const expected = ((NOW.getTime() - Date.parse('2026-09-14T01:00:00Z')) / (Date.parse('2026-09-30T01:00:00Z') - Date.parse('2026-09-14T01:00:00Z'))) * 100;
    expect(data.resume?.progress?.band).toEqual([expected - 10, expected + 10]);
    expect(data.courses).toEqual([expect.objectContaining({ part: 'VF-EMB-201', sub: '4 items · 180 min · Foundation', next: { code: 'L1.2', title: 'Timers', href: '/app/courses/emb/items/l-2' } })]);
    expect(data.completion).toEqual({ courseTitle: 'Done course', part: 'FE' });
    expect(mocks.getCourse).toHaveBeenCalledTimes(1);

    mocks.getCourse.mockRejectedValue(new Error('course unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const degraded = await buildDashboardData({ actor: { userId: 'learner-1', roles: [] }, locale: 'en', summary: summary as never, catalog: catalog as never, name: 'Avery', now: NOW });
    expect(degraded.resume).toMatchObject({ title: 'Timers', progress: null });
    expect(degraded.courses[0]).toMatchObject({ progress: null, next: null });
    errorLog.mockRestore();

    const firstRun = await buildDashboardData({ actor: { userId: 'learner-1', roles: [] }, locale: 'en', summary: { ...summary, continueLearning: null, upcomingExam: null, rewards: { ...summary.rewards, certificates: [] } } as never, catalog: [], name: '', now: NOW });
    expect(firstRun).toMatchObject({ state: 'first-run', resume: null, courses: [], completion: null });
  });

  it('renders the /app page through the bench dashboard', async () => {
    mocks.readLearnerHome.mockResolvedValue({ continueLearning: null, nextRequired: null, upcomingExam: null, feedback: null, rewards: { profile: { displayName: 'Avery', handle: null }, xpTotal: 0, streak: { current: 0 }, certificates: [] } });
    mocks.listCatalog.mockResolvedValue([]);
    const element = await LearnerHomePage();
    expect(element.type).toBe(LearnerDashboardBench);
    expect(element.props).toMatchObject({ name: 'Avery', locale: 'en', actor: { userId: 'learner-1' } });
  });
});

describe('bench activity series', () => {
  it('groups xp events by Vietnam day, marks milestones and compares week to date', () => {
    const series = activityTrace([
      { kind: 'lesson_completed', points: 10, createdAt: '2026-09-24T17:30:00Z' }, // 25.09 ICT, outside the window
      { kind: 'lesson_completed', points: 10, createdAt: '2026-09-23T18:00:00Z' }, // 24.09 01:00 ICT, today
      { kind: 'exam_passed', points: 50, createdAt: '2026-09-24T02:00:00Z' },
      { kind: 'lesson_completed', points: 10, createdAt: '2026-09-15T03:00:00Z' }, // Tue 15.09, last week
      { kind: 'lesson_completed', points: Number.NaN, createdAt: 'nope' },
    ], NOW, { points: points => `+${points} XP`, kind: kind => kind });
    expect(series.days).toHaveLength(14);
    expect(series.days[13]).toEqual({ date: '2026-09-24', value: 60, readout: '+60 XP' });
    expect(series.values.reduce((sum, value) => sum + value, 0)).toBe(70);
    expect(series.events).toEqual([{ dayIndex: 13, tone: 'signal', label: 'exam_passed · +60 XP' }]);
    expect(series.week).toEqual({ current: 60, previous: 10 });
  });
});

describe('bench learner catalog', () => {
  const course = (id: string, status: string | null, extra: Partial<CatalogBenchCourse> = {}): CatalogBenchCourse => ({ id, title: id, level: 'foundation', difficulty: 'beginner', pathway: 'ai-emerging-technology', languages: ['en'], enrollment: status ? { status } : null, ...extra });

  it('keeps the tab, filter form and region contracts on the spec sheet', () => {
    render(wrap(<CatalogBenchView tab="learning" filters={{}} courses={[course('active-course', 'active', { code: 'VF-C-101' }), course('completed-course', 'completed'), course('available-course', null)]} />));
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('id', 'catalog-title');
    expect(screen.getByText('A2 / Courses')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Courses' });
    expect(within(tabs).getByRole('link', { name: 'Learning' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/app/courses?tab=discover');
    const form = screen.getByRole('form', { name: 'Course filters' });
    expect(form).toHaveAttribute('data-cols', '4');
    expect(form.querySelector('input[name="tab"]')).toHaveValue('learning');
    expect(within(form).getAllByRole('combobox').map(select => select.getAttribute('name'))).toEqual(['level', 'pathway', 'difficulty', 'language']);
    expect(within(form).getByRole('combobox', { name: 'Language' })).toHaveValue('');
    expect(within(form).getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/app/courses?tab=learning');
    // The count is the results header: a focus target paragraph, not a second h2, and not live
    // (the filter bar moves focus there, so a live region would announce it twice).
    const count = document.getElementById('catalog-results');
    expect(count).toHaveTextContent('2 courses');
    expect(count?.tagName).toBe('P');
    expect(count).toHaveAttribute('tabindex', '-1');
    expect(count).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('heading', { name: '2 courses' })).toBeNull();
    expect(screen.getByRole('region', { name: '2 courses' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    const yours = screen.getByRole('region', { name: 'Your courses' });
    expect(within(yours).getByRole('heading', { level: 2, name: 'Your courses' })).toHaveAttribute('id', 'your-courses-heading');
    expect(within(yours).getByRole('heading', { level: 3, name: 'active-course' })).toBeInTheDocument();
    expect(within(yours).queryByRole('heading', { name: 'completed-course' })).toBeNull();
    expect(within(yours).getByText('Enrolled', { exact: true }).closest('td')).toHaveAttribute('data-slot', 'status');
    expect(within(yours).getByText('VF-C-101').closest('td')).toHaveAttribute('data-slot', 'lead');
    expect(within(yours).queryByRole('columnheader', { name: 'Depends on' })).toBeNull();
    const row = within(yours).getByRole('row', { name: /active-course/ });
    expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(row.querySelector('p.vf-meta')).toHaveTextContent('Foundation · Beginner · EN');
    expect(within(yours).getByRole('link', { name: 'Open active-course' })).toHaveAttribute('href', '/app/courses/active-course?tab=learning');
    const completed = document.querySelector('details.vf-l-disclosure:not(.vf-l-filters)');
    expect(completed?.querySelector('summary')).toHaveTextContent('Completed (1)');
    expect(within(completed as HTMLElement).getByRole('heading', { name: 'completed-course' })).toBeInTheDocument();
  });

  it('resets a filter select when the applied filters clear on the same mounted page (F2)', () => {
    const courses = [course('active-course', 'active')];
    const view = render(wrap(<CatalogBenchView tab="learning" filters={{ level: 'specialization' }} courses={courses} />));
    const level = () => within(screen.getByRole('form', { name: 'Course filters' })).getByRole('combobox', { name: 'Level' });
    expect(level()).toHaveValue('specialization');
    expect(screen.getByRole('link', { name: 'Remove filter Specialization' })).toHaveAttribute('href', '/app/courses?tab=learning');
    view.rerender(wrap(<CatalogBenchView tab="learning" filters={{}} courses={courses} />));
    expect(level()).toHaveValue('');
    expect(document.activeElement).toBe(document.getElementById('catalog-results'));
  });

  it('shows available courses with unmet prerequisites and the empty filter state', () => {
    const discover = render(wrap(<CatalogBenchView tab="discover" filters={{ language: 'en' }} courses={[course('available-course', null, { unmetPrerequisites: ['VF-C-101'] })]} />));
    const available = screen.getByRole('region', { name: 'Available courses' });
    expect(within(available).getByText('Not enrolled', { exact: true })).toBeInTheDocument();
    expect(within(available).getByText('Needs VF-C-101')).toBeInTheDocument();
    expect(within(available).getByRole('columnheader', { name: 'Depends on' })).toBeInTheDocument();
    expect(within(available).getByText('Needs VF-C-101')).toHaveAttribute('data-tone', 'pending');
    expect(within(available).getByText('Needs VF-C-101').closest('td')).toHaveAttribute('data-col', 'hide-sm');
    expect(screen.getByRole('form', { name: 'Course filters' }).querySelector('input[name="tab"]')).toHaveValue('discover');
    expect(within(screen.getByRole('list', { name: 'Active filters' })).getByRole('link', { name: 'Remove filter English' })).toHaveAttribute('href', '/app/courses?tab=discover');
    discover.unmount();

    render(wrap(<CatalogBenchView tab="discover" filters={{ level: 'specialization' }} courses={[]} />));
    // No list renders, so the empty-state title is the h2 under the page h1 (no skipped level).
    expect(screen.getByRole('heading', { name: 'No courses match these filters', level: 2 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Clear filters' }).every(link => link.getAttribute('href') === '/app/courses?tab=discover')).toBe(true);
  });

  it('titles the unfiltered empty state as an h2 on both tabs', () => {
    for (const tab of ['learning', 'discover'] as const) {
      const view = render(wrap(<CatalogBenchView tab={tab} filters={{}} courses={[]} />));
      const headings = screen.getAllByRole('heading').map(heading => heading.tagName);
      expect(headings).toEqual(['H1', 'H2']);
      view.unmount();
    }
  });

  it('routes the catalog page through the bench view', async () => {
    mocks.listCatalog.mockResolvedValue([course('available-course', null)]);
    render(wrap(await LearnerCatalogPage({ searchParams: Promise.resolve({ tab: 'discover' }) })));
    expect(screen.getByRole('region', { name: 'Available courses' })).toBeInTheDocument();
    expect(document.querySelector('.vf-seg')).toBeInTheDocument();
  });

  it('counts only selected-tab courses and keeps normalized filters in tab, course and clear links', async () => {
    mocks.listCatalog.mockResolvedValue([course('active', 'active'), course('available', null)]);
    render(wrap(await LearnerCatalogPage({ searchParams: Promise.resolve({ tab: 'discover', level: 'foundation', pathway: ['ai-emerging-technology', 'invalid'], difficulty: 'invalid', language: 'en' }) })));
    expect(document.getElementById('catalog-results')).toHaveTextContent('1 course');
    expect(within(screen.getByRole('navigation', { name: 'Courses' })).getByRole('link', { name: 'Learning' })).toHaveAttribute('href', '/app/courses?tab=learning&level=foundation&language=en');
    expect(screen.getByRole('link', { name: 'Open available' })).toHaveAttribute('href', '/app/courses/available?tab=discover&level=foundation&language=en');
    expect(screen.getAllByRole('link', { name: 'Clear filters' }).every(link => link.getAttribute('href') === '/app/courses?tab=discover')).toBe(true);
  });
});

describe('bench learner explore', () => {
  it('offers exactly the four existing destinations as coded cells', async () => {
    render(wrap(await ExplorePage()));
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/app/courses?tab=discover', '/app/resources', '/app/opportunities', '/app/projects']);
    expect(screen.getByRole('link', { name: 'Resources Find guides and templates.' })).toHaveAttribute('href', '/app/resources');
    expect(screen.getByRole('heading', { level: 2, name: 'Resources' }).closest('a')).toHaveAttribute('href', '/app/resources');
    expect(screen.getByRole('list')).toHaveClass('vf-l-explore');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('X4')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('A3 / Explore')).toBeInTheDocument();
  });

  it('renders any destination list it is given without extra links', () => {
    render(wrap(<ExploreBenchView destinations={[{ href: '/app/resources', label: 'Resources', description: 'Guides.' }]} />));
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('bench learner loading and error states', () => {
  it('uses the hairline bench skeleton', async () => {
    const { container } = render(await Loading());
    expect(screen.getByRole('status')).toHaveTextContent(en.learner.focus.loading);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('data-variant', 'home');
    expect(container.querySelector('.motion-safe\\:animate-pulse, .vf-sweep')).toBeNull();
    expect(container.querySelector('.vf-skel')).toBeInTheDocument();
  });

  it('gives every route type a static skeleton that mirrors its layout', async () => {
    const routes = [
      ['courses', 'directory', CoursesLoading], ['resources', 'directory', ResourcesLoading], ['opportunities', 'directory', OpportunitiesLoading], ['projects', 'directory', ProjectsLoading],
      ['course', 'detail', CourseLoading], ['resource', 'detail', ResourceLoading], ['opportunity', 'detail', OpportunityLoading], ['project', 'detail', ProjectLoading], ['new project', 'detail', NewProjectLoading],
      ['item', 'activity', ItemLoading],
    ] as const;
    for (const [route, variant, RouteLoading] of routes) {
      const { container, unmount } = render(await RouteLoading());
      const status = screen.getByRole('status');
      expect(status, route).toHaveAttribute('data-variant', variant);
      expect(status).toHaveAttribute('aria-busy', 'true');
      expect(status).toHaveTextContent(en.learner.focus.loading);
      expect(container.querySelector('.vf-skel')).toBeInTheDocument();
      expect(container.querySelector('.vf-sweep, [class*="animate-"]')).toBeNull();
      unmount();
    }
  });

  it('renders the bench fault panel for every route error', async () => {
    const reset = vi.fn();
    await act(async () => { render(wrap(<LearnerErrorPage error={Object.assign(new Error('x'), { digest: 'abc123' })} reset={reset} />)); });
    expect(screen.getByRole('heading', { name: messages.bench.shared.errorTitle })).toBeInTheDocument();
    expect(screen.getByText('Fault')).toBeInTheDocument();
    expect(screen.getByText('Ref abc123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Go to Learning' })).toHaveAttribute('href', '/app');
  });
});
