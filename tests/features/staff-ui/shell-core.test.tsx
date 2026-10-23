// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { breadcrumbTrail, isNavigationItemActive } from '@/components/ShellPrimitives';
import { navIcons } from '@/features/staff-ui/nav-icons';
import { staffNavigation } from '@/features/staff-ui/navigation';
import type { StaffChrome } from '@/features/staff-ui/types';
import { StaffWorkspaceShell } from '@/features/staff-ui/ui/StaffWorkspaceShell';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { adminNavigation } from '@/lib/admin-navigation';
import { gradingNavigation } from '@/lib/grading-navigation';
import { PERMISSIONS, type Permission } from '@/lib/authorization';
import { studioNavigation } from '@/lib/studio-navigation';
import { shellNavigation, workspaceNavigationFor, type WorkspaceEntries } from '@/lib/workspace-navigation';
import type { StaffWorkspace } from '@/lib/workspaces';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const nav = vi.hoisted(() => ({ pathname: '/studio', push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => nav, useSearchParams: () => new URLSearchParams() }));

// Sibling shell parts belong to other files; stand-ins keep these tests about the core shell.
vi.mock('@/features/staff-ui/ui/WorkspaceScopeSwitcher', () => ({ WorkspaceScopeSwitcher: ({ workspace }: { workspace: string }) => <div data-testid="switcher">{workspace}</div> }));
vi.mock('@/features/staff-ui/ui/StaffUserMenu', () => ({ StaffUserMenu: ({ identity }: { identity: { name: string } }) => <div data-testid="user-menu">{identity.name}</div> }));
vi.mock('@/features/staff-ui/ui/StaffCommandMenu', () => ({ StaffCommandMenu: () => <button type="button">Search</button> }));
vi.mock('@/features/staff-ui/ui/AttentionPopover', () => ({ AttentionPopover: () => null }));
vi.mock('@/features/staff-ui/ui/StaffThemeMenu', () => ({ StaffThemeMenu: ({ theme }: { theme: string }) => <span data-testid="theme-menu">{theme}</span> }));

const messages = staffUiTestMessages(en, 'en');
const TOGGLE = (messages.staffUi.shell as { core: { toggleSidebar: string } }).core.toggleSidebar;
const ALL = PERMISSIONS as readonly Permission[];
const entries: WorkspaceEntries = { studio: '/studio', grading: '/grading', admin: '/admin' };
const chrome = (overrides: Partial<StaffChrome> = {}): StaffChrome => ({
  theme: 'system',
  sidebarOpen: true,
  identity: { name: 'Nguyễn Thị Minh Khai', email: 'khai@example.com', avatarUrl: null, initials: 'NK' },
  ...overrides,
});
const labels = { studio: en.studioNav, grading: en.gradingNav, admin: en.adminNav } as Record<StaffWorkspace, Record<string, string>>;
const navName = { studio: en.common.studioNavigation, grading: en.common.gradingNavigation, admin: en.adminNav.navigation };

function view(workspace: StaffWorkspace, { permissions = ALL, pathname, shellChrome = chrome(), title }: { permissions?: readonly Permission[]; pathname: string; shellChrome?: StaffChrome; title?: string }) {
  nav.pathname = pathname;
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <StaffWorkspaceShell workspace={workspace} chrome={shellChrome} permissions={[...permissions]} entries={entries}>
        <StaffPageHeader title={title ?? 'Page heading'} />
      </StaffWorkspaceShell>
    </NextIntlClientProvider>,
  );
}

/** The top-bar trigger (the edge rail carries the same name but stays out of the tab order). */
function sidebarTrigger(name: string) {
  const trigger = screen.getAllByRole('button', { name }).find((element) => element.dataset.sidebar === 'trigger');
  if (!trigger) throw new Error(`No sidebar trigger named ${name}`);
  return trigger;
}

function clearSidebarCookie() {
  document.cookie = 'sidebar_state=; path=/; max-age=0';
}

/** The item the legacy shells highlight (NavigationList + isNavigationItemActive over the same items). */
function legacyActive(workspace: StaffWorkspace, pathname: string) {
  const items = shellNavigation(workspaceNavigationFor(workspace, ALL), (key) => labels[workspace][key]);
  return items.filter((item) => isNavigationItemActive(pathname, item.href, item.matches)).map((item) => item.key);
}

const ROUTES: Array<[StaffWorkspace, string]> = [
  ['studio', '/studio'],
  ['studio', '/studio/courses'],
  ['studio', '/studio/courses/course-1/notebooks/item-1'],
  ['studio', '/studio/library'],
  ['studio', '/studio/resources/res-1'],
  ['studio', '/studio/media'],
  ['studio', '/studio/bank/q-1'],
  ['studio', '/studio/reviews'],
  ['studio', '/studio/mcp'],
  ['grading', '/grading'],
  ['grading', '/grading/assessments'],
  ['grading', '/grading/queue'],
  ['grading', '/grading/assignments/sub-1'],
  ['grading', '/grading/exams/attempt-1'],
  ['grading', '/grading/reports'],
  ['admin', '/admin'],
  ['admin', '/admin/users'],
  ['admin', '/admin/users/00000000-0000-4000-8000-000000000001'],
  ['admin', '/admin/branches/b-1'],
  ['admin', '/admin/roles'],
  ['admin', '/admin/enrollment-migration'],
  ['admin', '/admin/audit'],
];

beforeEach(() => {
  clearSidebarCookie();
  window.innerWidth = 1280;
});
afterEach(() => {
  cleanup();
  clearSidebarCookie();
});

describe('staff navigation model', () => {
  it.each(ROUTES)('%s %s highlights exactly the legacy owning item', (workspace, pathname) => {
    const model = staffNavigation(workspace, ALL, pathname, { item: (key) => labels[workspace][key], navigation: 'nav' });
    const active = model.groups.flatMap((group) => group.items).filter((item) => item.active).map((item) => item.key);
    expect(active).toHaveLength(1);
    expect(active).toEqual(legacyActive(workspace, pathname));
  });

  it('highlights nothing on a route no item owns, like the legacy shells', () => {
    const model = staffNavigation('studio', ALL, '/studio/unknown', { item: (key) => key, navigation: 'nav' });
    expect(model.groups.flatMap((group) => group.items).some((item) => item.active)).toBe(false);
    expect(legacyActive('studio', '/studio/unknown')).toEqual([]);
  });

  it('groups admin items by their nav group and filters by permission', () => {
    const model = staffNavigation('admin', ['admin.access', 'member.read', 'audit.read'], '/admin', { item: (key) => labels.admin[key], navigation: 'nav' });
    expect(model.groups.map((group) => [group.key, group.label, group.items.map((item) => item.key)])).toEqual([
      ['overview', undefined, ['overview']],
      ['people', en.adminNav.people, ['users']],
      ['system', en.adminNav.system, ['audit']],
    ]);
  });

  it('lists labelled child sections for the command menu', () => {
    const model = staffNavigation('studio', ALL, '/studio', { item: (key) => labels.studio[key], navigation: 'nav' });
    const library = model.groups[0].items.find((item) => item.key === 'library');
    expect(library?.sections?.map((section) => section.label)).toEqual([en.studioNav.resources, en.studioNav.opportunities, en.studioNav.projects, en.studioNav.media]);
  });

  it('has an icon for every nav key and child section', () => {
    const keys = [...studioNavigation, ...gradingNavigation, ...adminNavigation].flatMap((item) => [item.key, ...('matches' in item ? item.matches.flatMap((match) => ('key' in match ? [match.key] : [])) : [])]);
    for (const key of keys) expect(navIcons).toHaveProperty(key);
  });

  it('exposes the legacy breadcrumb trail as a pure helper', () => {
    const items = shellNavigation(workspaceNavigationFor('studio', ALL), (key) => labels.studio[key]);
    expect(breadcrumbTrail('/studio/resources/res-1', items)).toEqual({
      parent: expect.objectContaining({ key: 'library' }),
      crumbs: [{ label: en.studioNav.resources, href: '/studio/resources' }, { label: 'res 1', href: '/studio/resources/res-1' }],
    });
    const grading = shellNavigation(workspaceNavigationFor('grading', ALL), (key) => labels.grading[key]);
    expect(breadcrumbTrail('/grading/assignments/sub-1', grading)?.crumbs).toEqual([{ label: 'sub 1', href: '/grading/assignments/sub-1' }]);
    expect(breadcrumbTrail('/studio/unknown', items)).toBeNull();
  });
});

describe('StaffWorkspaceShell', () => {
  it('renders the landmarks, skip link and a themed .vf-staff root', () => {
    const { container } = view('studio', { pathname: '/studio/library', shellChrome: chrome({ theme: 'dark' }) });
    const root = container.querySelector('.vf-staff');
    expect(root).toHaveAttribute('data-theme', 'dark');
    // StaffPageHeader renders a <header> inside <main>; the shell's banner is the one outside it.
    const banners = screen.getAllByRole('banner').filter((element) => !element.closest('main'));
    expect(banners).toHaveLength(1);
    const banner = banners[0];
    expect(banner).toHaveClass('h-14');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'studio-main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: en.common.skipToContent })).toHaveAttribute('href', '#studio-main');
    expect(screen.getByRole('navigation', { name: en.common.studioNavigation })).toBeInTheDocument();
    expect(screen.getByTestId('switcher')).toHaveTextContent('studio');
    expect(screen.getByTestId('user-menu')).toHaveTextContent('Nguyễn Thị Minh Khai');
  });

  it('server-renders the saved rail state and theme so the first paint matches', () => {
    nav.pathname = '/admin/users';
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={messages}>
        <StaffWorkspaceShell workspace="admin" chrome={chrome({ theme: 'light', sidebarOpen: false })} permissions={[...ALL]} entries={entries}>x</StaffWorkspaceShell>
      </NextIntlClientProvider>,
    );
    const root = new DOMParser().parseFromString(html, 'text/html').querySelector('.vf-staff');
    expect(root?.getAttribute('data-theme')).toBe('light');
    expect(root?.getAttribute('data-state')).toBe('collapsed');
  });

  it('leaves data-theme off for the system theme', () => {
    const { container } = view('grading', { pathname: '/grading' });
    expect(container.querySelector('.vf-staff')).not.toHaveAttribute('data-theme');
  });

  it.each(ROUTES)('%s %s marks exactly one nav link as the current page', (workspace, pathname) => {
    view(workspace, { pathname });
    const navigation = screen.getByRole('navigation', { name: navName[workspace] });
    const current = within(navigation).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(labels[workspace][legacyActive(workspace, pathname)[0]]);
  });

  it('moves focus to the page heading on navigation, but not on the first render', () => {
    const { rerender } = view('grading', { pathname: '/grading' });
    expect(screen.getByRole('heading', { level: 1, name: 'Page heading' })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
    nav.pathname = '/grading/queue';
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <StaffWorkspaceShell workspace="grading" chrome={chrome()} permissions={[...ALL]} entries={entries}><StaffPageHeader title="Queue" /></StaffWorkspaceShell>
      </NextIntlClientProvider>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Queue' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('ends the breadcrumbs with the registered record title, never the raw ID', () => {
    view('admin', { pathname: '/admin/users/00000000-0000-4000-8000-000000000001', title: 'Trần Văn Bảo' });
    const crumbs = screen.getByRole('navigation', { name: en.common.breadcrumbs });
    expect(within(crumbs).getByRole('link', { name: en.adminNav.users })).toHaveAttribute('href', '/admin/users');
    expect(within(crumbs).getByText('Trần Văn Bảo')).toHaveAttribute('aria-current', 'page');
    expect(crumbs.textContent).not.toContain('00000000');
  });

  it('persists desktop toggles to the sidebar_state cookie', async () => {
    const user = userEvent.setup();
    const { container } = view('studio', { pathname: '/studio' });
    const trigger = sidebarTrigger(TOGGLE);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    expect(document.cookie).toContain('sidebar_state=false');
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(document.cookie).toContain('sidebar_state=true');
  });

  it('keeps accessible link names in the collapsed rail', () => {
    const { container } = view('studio', { pathname: '/studio/courses', shellChrome: chrome({ sidebarOpen: false }) });
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-collapsible', 'icon');
    const navigation = screen.getByRole('navigation', { name: en.common.studioNavigation });
    for (const key of ['home', 'courses', 'library', 'questionBank', 'reviews', 'mcp']) {
      expect(within(navigation).getByRole('link', { name: labels.studio[key] })).toBeInTheDocument();
    }
  });

  it('forces the rail collapsed in the course editor without writing the cookie; the trail ends with the course title', async () => {
    const user = userEvent.setup();
    const { container } = view('studio', { pathname: '/studio/courses/course-1', title: 'Khóa học tối giản' });
    const sidebar = () => container.querySelector('[data-slot="sidebar"]');
    expect(sidebar()).toHaveAttribute('data-state', 'collapsed');
    const crumbs = screen.getByRole('navigation', { name: en.common.breadcrumbs });
    expect(within(crumbs).getByRole('link', { name: en.studioNav.courses })).toHaveAttribute('href', '/studio/courses');
    expect(within(crumbs).getByText('Khóa học tối giản')).toHaveAttribute('aria-current', 'page');
    expect(crumbs.textContent).not.toContain('course-1');
    expect(container.querySelector('.vf-staff-course-editor')).not.toBeNull();
    await user.click(sidebarTrigger(TOGGLE));
    expect(sidebar()).toHaveAttribute('data-state', 'expanded');
    expect(document.cookie).not.toContain('sidebar_state');
  });

  it('restores the saved rail state when leaving the editor', () => {
    const shellChrome = chrome();
    const { container, rerender } = view('studio', { pathname: '/studio/courses/course-1/notebooks/item-1', shellChrome });
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
    expect(container.querySelector('.vf-staff-course-editor')).toBeNull();
    nav.pathname = '/studio/courses';
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <StaffWorkspaceShell workspace="studio" chrome={shellChrome} permissions={[...ALL]} entries={entries}><StaffPageHeader title="Courses" /></StaffWorkspaceShell>
      </NextIntlClientProvider>,
    );
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByRole('navigation', { name: en.common.breadcrumbs })).toBeInTheDocument();
    expect(document.cookie).not.toContain('sidebar_state');
  });

  describe('on a phone', () => {
    beforeEach(() => {
      window.innerWidth = 375;
    });

    it('opens the drawer from "Open menu"; Escape closes it and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      view('grading', { pathname: '/grading/queue' });
      const trigger = screen.getByRole('button', { name: en.common.menu });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await user.click(trigger);
      const drawer = screen.getByRole('dialog', { name: en.common.gradingNavigation });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(within(drawer).getByRole('link', { name: en.gradingNav.queue })).toHaveAttribute('aria-current', 'page');
      expect(within(drawer).getByTestId('switcher')).toBeInTheDocument();
      expect(within(drawer).getByRole('button', { name: en.common.close })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(document.cookie).not.toContain('sidebar_state');
    });

    it('closes the drawer with the localized close button', async () => {
      const user = userEvent.setup();
      view('studio', { pathname: '/studio' });
      await user.click(screen.getByRole('button', { name: en.common.menu }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.common.close }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('button', { name: en.common.menu })).toHaveFocus());
    });

    it('closes the drawer on navigation and focuses the new page heading', async () => {
      const user = userEvent.setup();
      const { rerender } = view('studio', { pathname: '/studio' });
      await user.click(screen.getByRole('button', { name: en.common.menu }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      nav.pathname = '/studio/courses';
      await act(async () => {
        rerender(
          <NextIntlClientProvider locale="en" messages={messages}>
            <StaffWorkspaceShell workspace="studio" chrome={chrome()} permissions={[...ALL]} entries={entries}><StaffPageHeader title="Courses" /></StaffWorkspaceShell>
          </NextIntlClientProvider>,
        );
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Courses' })).toHaveFocus());
    });
  });
});
