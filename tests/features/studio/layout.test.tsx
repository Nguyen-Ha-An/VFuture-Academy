// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { StudioShell } from '@/components/StudioShell';
import type { Permission } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  studioPermissions: vi.fn(),
  canAccessStudio: vi.fn(),
  studioPageContext: vi.fn(),
  readStaffChrome: vi.fn(),
  loginDestination: vi.fn(),
  forbidden: vi.fn(() => {
    throw new Error('forbidden:403');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('@/features/admin/components/AdminSessionGuard', () => ({ AdminSessionGuard: ({children}: {children: React.ReactNode}) => children }));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  forbidden: mocks.forbidden,
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/studio',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/workspace/context', () => ({ studioPageContext: mocks.studioPageContext }));
vi.mock('@/features/staff-ui/chrome.server', () => ({ readStaffChrome: mocks.readStaffChrome }));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));

import StudioLayout from '@/app/studio/layout';
import StudioForbiddenPage from '@/app/studio/forbidden';

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}>{children}</NextIntlClientProvider>;
}

describe('Studio layout gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readStaffChrome.mockResolvedValue({ theme: 'system', sidebarOpen: true, identity: { name: 'Editor', email: 'editor@example.test', avatarUrl: null, initials: 'ED' } });
    mocks.studioPageContext.mockResolvedValue({
      actor: { userId: 'editor-1', roles: [] },
      workspace: 'studio', scope: { kind: 'central' }, options: [], branches: [], permissions: ['course.read'],
      entries: { studio: '/studio', grading: null, admin: null },
    });
  });
  afterEach(cleanup);

  it('redirects an unauthenticated visitor to login', async () => {
    mocks.loginDestination.mockResolvedValue('/login?next=%2Fstudio%2Fresources');
    mocks.studioPageContext.mockImplementationOnce(async () => {
      mocks.redirect(await mocks.loginDestination());
    });

    await expect(StudioLayout({ children: <p>Protected</p> })).rejects.toThrow('redirect:/login?next=%2Fstudio%2Fresources');
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fstudio%2Fresources');
  });


  it('renders the bilingual Studio forbidden fallback', () => {
    render(<Provider><StudioForbiddenPage /></Provider>);

    expect(screen.getByRole('heading', { name: 'Studio access required' })).toBeInTheDocument();
    expect(screen.getByText('Bạn không có quyền truy cập Studio.')).toBeInTheDocument();
  });

  it('renders the Studio shell and workspace content for an authorized actor', async () => {
    render(<Provider>{await StudioLayout({ children: <p>Protected</p> })}</Provider>);

    expect(screen.getAllByRole('navigation', { name: 'Studio navigation' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Courses' })[0]).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Question Bank' })).not.toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('shows an existing branch-scoped destination without an invalid unscoped permission check', async () => {
    mocks.studioPageContext.mockResolvedValue({
      workspace: 'studio', actor: { userId: 'lead-1', roles: [] }, scope: { kind: 'branch', branchId: 'vinsmc' }, options: [], branches: [], permissions: ['content.read'],
      entries: { studio: '/studio', grading: '/grading', admin: null },
    });

    render(<Provider>{await StudioLayout({ children: <p>Protected</p> })}</Provider>);

    expect(screen.getAllByRole('link', { name: 'Content library' })[0]).toHaveAttribute('href', '/studio/library');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Studio' }), { button: 0, ctrlKey: false });
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Assessment & grading' })).toHaveAttribute('href', '/grading');
  });

  it('keeps only content destinations for content permissions', () => {
    const contentPermissions: Permission[] = [
      'resource.edit',
      'opportunity.edit',
      'project.edit',
    ];

    render(<Provider><StudioShell permissions={contentPermissions}><p>Protected</p></StudioShell></Provider>);

    expect(screen.getAllByRole('link', { name: 'Content library' })[0]).toHaveAttribute('href', '/studio/library');
    expect(screen.queryByRole('link', { name: 'Grading queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Assessments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Learning reports' })).not.toBeInTheDocument();
  });
});
