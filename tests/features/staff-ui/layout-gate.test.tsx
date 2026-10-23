// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_FONT_PRELOADS } from '@/features/staff-ui/fonts';
import type { StaffChrome } from '@/features/staff-ui/types';
import { StaffWorkspaceShell } from '@/features/staff-ui/ui/StaffWorkspaceShell';
import { staffShellVariant, uiV2Enabled } from '@/features/workspace/presentation';
import type { StaffWorkspace } from '@/lib/workspaces';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  readStaffChrome: vi.fn(),
  studioPageContext: vi.fn(),
  gradingPageContext: vi.fn(),
  adminWorkspacePageContext: vi.fn(),
  preload: vi.fn(),
  pathname: '/studio',
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), preload: mocks.preload }));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  forbidden: vi.fn(),
}));
vi.mock('@/features/admin/components/AdminSessionGuard', () => ({
  AdminSessionGuard: ({ children, actorId }: { children: ReactNode; actorId: string }) => <div data-testid="session-guard" data-actor={actorId}>{children}</div>,
}));
vi.mock('@/features/staff-ui/chrome.server', () => ({ readStaffChrome: mocks.readStaffChrome }));
vi.mock('@/features/workspace/context', () => ({ studioPageContext: mocks.studioPageContext, gradingPageContext: mocks.gradingPageContext }));
vi.mock('@/features/admin/context', () => ({ adminWorkspacePageContext: mocks.adminWorkspacePageContext }));

import AdminLayout from '@/app/admin/layout';
import GradingLayout from '@/app/grading/layout';
import StudioLayout from '@/app/studio/layout';

const messages = staffUiTestMessages(en, 'en');
const SEARCH = (messages.staffUi.shell as { command: { trigger: string } }).command.trigger;
const identity = { name: 'Nguyễn Thị Thanh Hương', email: 'huong.nguyen@vfuture.test', avatarUrl: null, initials: 'TH' };
const chrome = (overrides: Partial<StaffChrome> = {}): StaffChrome => ({ theme: 'system', sidebarOpen: true, identity, ...overrides });
const entries = { studio: '/studio', grading: '/grading', admin: '/admin' };

const layouts = {
  studio: { Layout: StudioLayout, context: mocks.studioPageContext, pathname: '/studio/courses', permissions: ['course.read', 'course.edit'], navigation: en.common.studioNavigation, link: en.studioNav.courses },
  grading: { Layout: GradingLayout, context: mocks.gradingPageContext, pathname: '/grading/queue', permissions: ['submission.grade'], navigation: en.common.gradingNavigation, link: en.gradingNav.queue },
  admin: { Layout: AdminLayout, context: mocks.adminWorkspacePageContext, pathname: '/admin/users', permissions: ['admin.access', 'member.read'], navigation: en.adminNav.navigation, link: en.adminNav.users },
} satisfies Record<StaffWorkspace, unknown>;

function Provider({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
}

async function renderLayout(workspace: StaffWorkspace) {
  const { Layout, pathname } = layouts[workspace];
  mocks.pathname = pathname;
  return render(<Provider>{await Layout({ children: <h1>Protected page</h1> })}</Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unset uses the refined signed-in default. Tests for rollback set an explicit empty list.
  vi.stubEnv('UI_V2_SURFACES', undefined);
  vi.stubEnv('STAFF_UI_V2_WORKSPACES', undefined);
  mocks.readStaffChrome.mockResolvedValue(chrome());
  for (const workspace of Object.keys(layouts) as StaffWorkspace[]) {
    layouts[workspace].context.mockResolvedValue({
      workspace,
      actor: { userId: `${workspace}-operator`, roles: [] },
      scope: { kind: 'central' },
      options: [{ scope: { kind: 'central' }, label: 'Central', permissions: layouts[workspace].permissions }],
      branches: [],
      permissions: layouts[workspace].permissions,
      entries,
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('staff shell flag precedence', () => {
  it('renders Catmin by default with neither flag set', () => {
    expect(staffShellVariant('studio', {})).toBe('catmin');
    expect(uiV2Enabled('studio', {})).toBe(true);
  });

  it('never combines a converted staff page with a legacy shell', () => {
    expect(staffShellVariant('grading', { UI_V2_SURFACES: '', STAFF_UI_V2_WORKSPACES: 'admin, grading' })).toBe('catmin');
    expect(staffShellVariant('studio', { UI_V2_SURFACES: '', STAFF_UI_V2_WORKSPACES: 'admin, grading' })).toBe('catmin');
  });

  it('keeps all staff workspaces on Catmin regardless of older flag values', () => {
    const env = { UI_V2_SURFACES: 'auth, learner, studio', STAFF_UI_V2_WORKSPACES: 'studio,admin' };
    expect(staffShellVariant('studio', env)).toBe('catmin');
    expect(staffShellVariant('admin', env)).toBe('catmin');
    expect(staffShellVariant('grading', env)).toBe('catmin');
    expect(staffShellVariant('grading', { UI_V2_SURFACES: 'studio,grading,admin' })).toBe('catmin');
  });

  it('reads process.env by default (vi.stubEnv)', () => {
    vi.stubEnv('UI_V2_SURFACES', 'admin');
    vi.stubEnv('STAFF_UI_V2_WORKSPACES', 'admin,studio');
    expect(staffShellVariant('admin')).toBe('catmin');
    expect(staffShellVariant('studio')).toBe('catmin');
  });
});

describe.each(Object.keys(layouts) as StaffWorkspace[])('%s layout gate', (workspace) => {
  const { navigation, link } = layouts[workspace];

  it('renders Catmin when the env is unset', async () => {
    const { container } = await renderLayout(workspace);
    expect(container.querySelector('.vf-staff')).not.toBeNull();
    expect(mocks.readStaffChrome).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Protected page' })).toBeInTheDocument();
  });

  it('keeps Catmin shell and page together after a learner rollback', async () => {
    vi.stubEnv('UI_V2_SURFACES', '');
    const { container } = await renderLayout(workspace);

    expect(container.querySelector('.vf-staff')).not.toBeNull();
    expect(container.querySelector('.staff-workspace')).toBeNull();
    expect(screen.getAllByRole('navigation', { name: navigation }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: link }).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Protected page' })).toBeInTheDocument();
    expect(mocks.readStaffChrome).toHaveBeenCalledTimes(1);
    expect(mocks.preload).toHaveBeenCalledTimes(STAFF_FONT_PRELOADS.length);
  });

  it('ignores the retired legacy refreshed shell flag', async () => {
    vi.stubEnv('UI_V2_SURFACES', '');
    vi.stubEnv('STAFF_UI_V2_WORKSPACES', workspace);
    const { container } = await renderLayout(workspace);

    expect(container.querySelector('.staff-workspace')).toBeNull();
    expect(container.querySelector('.vf-staff')).not.toBeNull();
    expect(mocks.readStaffChrome).toHaveBeenCalledTimes(1);
  });

  it('stays Catmin when UI_V2_SURFACES lists only other surfaces', async () => {
    vi.stubEnv('UI_V2_SURFACES', ['auth', 'learner', 'studio', 'grading', 'admin'].filter((surface) => surface !== workspace).join(','));
    const { container } = await renderLayout(workspace);

    expect(container.querySelector('.vf-staff')).not.toBeNull();
    expect(mocks.readStaffChrome).toHaveBeenCalledTimes(1);
  });

  it('renders StaffWorkspaceShell inside the session guard when UI_V2_SURFACES lists it, even with STAFF_UI_V2_WORKSPACES', async () => {
    vi.stubEnv('UI_V2_SURFACES', `auth,learner,${workspace}`);
    vi.stubEnv('STAFF_UI_V2_WORKSPACES', workspace);
    mocks.readStaffChrome.mockResolvedValue(chrome({ theme: 'dark', sidebarOpen: false }));
    const { container } = await renderLayout(workspace);

    const root = container.querySelector<HTMLElement>('.vf-staff');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-workspace', workspace);
    expect(root).toHaveAttribute('data-theme', 'dark');
    expect(root?.closest('[data-testid="session-guard"]')).toHaveAttribute('data-actor', `${workspace}-operator`);
    expect(container.querySelector('.staff-workspace')).toBeNull();
    expect(mocks.readStaffChrome).toHaveBeenCalledTimes(1);

    // Real shell parts, wired together: navigation, main landmark, user menu identity, ⌘K trigger.
    const nav = screen.getByRole('navigation', { name: navigation });
    expect(within(nav).getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveAttribute('id', `${workspace}-main`);
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Protected page' })).toBeInTheDocument();
    expect(screen.getAllByText('Nguyễn Thị Thanh Hương').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: SEARCH })).toBeInTheDocument();
  });

  it('preloads the Inter latin and vietnamese files only for the new shell', async () => {
    vi.stubEnv('UI_V2_SURFACES', workspace);
    await renderLayout(workspace);

    expect(mocks.preload).toHaveBeenCalledTimes(STAFF_FONT_PRELOADS.length);
    for (const href of STAFF_FONT_PRELOADS) {
      expect(mocks.preload).toHaveBeenCalledWith(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
    }
    expect(STAFF_FONT_PRELOADS.some((href) => href.includes('inter-var-latin.'))).toBe(true);
    expect(STAFF_FONT_PRELOADS.some((href) => href.includes('inter-var-vietnamese.'))).toBe(true);
  });
});

describe('StaffWorkspaceShell server render (no theme or rail flash)', () => {
  function ssr(shellChrome: StaffChrome, pathname = '/grading/queue') {
    mocks.pathname = pathname;
    const html = renderToString(
      <Provider>
        <StaffWorkspaceShell workspace="grading" chrome={shellChrome} permissions={['submission.grade']} entries={entries}>
          <h1>Queue</h1>
        </StaffWorkspaceShell>
      </Provider>,
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    return { root: document.querySelector('.vf-staff'), sidebar: document.querySelector('[data-slot="sidebar"][data-state]') };
  }

  it.each([['dark', 'dark'], ['light', 'light'], ['system', null]] as const)('theme %s renders data-theme=%s', (theme, attribute) => {
    const { root } = ssr(chrome({ theme }));
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-theme')).toBe(attribute);
  });

  it.each([[true, 'expanded'], [false, 'collapsed']] as const)('sidebarOpen %s renders data-state=%s', (sidebarOpen, state) => {
    const { root, sidebar } = ssr(chrome({ sidebarOpen }));
    expect(root?.getAttribute('data-state')).toBe(state);
    expect(sidebar?.getAttribute('data-state')).toBe(state);
  });
});
